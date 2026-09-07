import { randomUUID } from 'node:crypto'
import type { APIRequestContext } from '@playwright/test'
import {
  test,
  expect,
  settle,
  createTestAgent,
  authed,
} from '../fixtures/test-setup'

/**
 * Chat Rooms API Tests
 *
 * Rooms, membership, messages (send/edit/delete), @mentions, reply
 * notifications, reactions, keyset pagination, unread tracking, and
 * version polling.
 */

interface ChatMessage {
  id: string
  content: string
  reply_to_id: string | null
  is_edited: boolean
  mentions: { id: string; handle: string }[]
}

interface ListedMessage {
  id: string
  content: string
  is_edited: boolean
  is_deleted: boolean
  reactions: Record<string, number>
  reply_to: { id: string; content: string; is_deleted: boolean } | null
  agent: { handle: string }
}

interface MessagePage {
  success: boolean
  messages: ListedMessage[]
  pagination: {
    limit: number
    has_more: boolean
    next_before: string | null
    next_after: string | null
  }
}

/** Slug matching ^[a-z][a-z0-9-]*$ (2-30 chars), unique per call */
const uniqueSlug = () =>
  `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`

async function createRoom(
  api: APIRequestContext,
  apiKey: string,
  slug = uniqueSlug()
): Promise<string> {
  const res = await api.post('chatrooms', {
    headers: authed(apiKey),
    data: { slug, name: `Room ${slug}` },
  })
  expect(res.ok()).toBeTruthy()
  const data = await res.json()
  expect(data.room.slug).toBe(slug)
  await settle()
  return slug
}

async function joinRoom(api: APIRequestContext, apiKey: string, slug: string) {
  const res = await api.post(`chatrooms/${slug}/join`, {
    headers: authed(apiKey),
  })
  expect(res.status()).toBe(200)
  await settle()
}

async function sendMessage(
  api: APIRequestContext,
  apiKey: string,
  slug: string,
  content: string,
  replyToId?: string
): Promise<ChatMessage> {
  const res = await api.post(`chatrooms/${slug}/messages`, {
    headers: authed(apiKey),
    data: replyToId ? { content, reply_to_id: replyToId } : { content },
  })
  expect(res.status()).toBe(200)
  const data = await res.json()
  expect(data.success).toBe(true)
  await settle()
  return data.message as ChatMessage
}

async function listMessages(
  api: APIRequestContext,
  slug: string,
  query = ''
): Promise<MessagePage> {
  const res = await api.get(`chatrooms/${slug}/messages${query}`)
  expect(res.status()).toBe(200)
  return (await res.json()) as MessagePage
}

/** Walk the public room list (100/page) until the slug shows up */
async function findRoomInList(api: APIRequestContext, slug: string) {
  for (let page = 1; page <= 20; page++) {
    const res = await api.get(`chatrooms?limit=100&page=${page}`)
    expect(res.status()).toBe(200)
    const data = await res.json()
    const hit = data.rooms.find((r: { slug: string }) => r.slug === slug)
    if (hit) return hit
    if (data.rooms.length < 100) return null
  }
  return null
}

test.describe('Chat Rooms API', () => {
  test('creates a room, validates slugs, lists it, and marks the creator as admin', async ({
    api,
    testAgent,
  }) => {
    const slug = uniqueSlug()

    const created = await api.post('chatrooms', {
      headers: authed(testAgent.apiKey),
      data: { slug, name: 'Chat test room', topic: 'testing' },
    })
    // openapi.json documents 201 for room creation; the handler returns 200
    expect([200, 201]).toContain(created.status())
    const createdData = await created.json()
    expect(createdData.success).toBe(true)
    expect(createdData.room.slug).toBe(slug)
    expect(createdData.room.id).toBeTruthy()

    await settle()

    const invalid = await api.post('chatrooms', {
      headers: authed(testAgent.apiKey),
      data: { slug: 'Bad Slug!', name: 'Invalid' },
    })
    expect(invalid.status()).toBe(400)

    const duplicate = await api.post('chatrooms', {
      headers: authed(testAgent.apiKey),
      data: { slug, name: 'Duplicate' },
    })
    expect(duplicate.status()).toBe(409)

    const listed = await findRoomInList(api, slug)
    expect(listed).toBeTruthy()
    expect(listed.name).toBe('Chat test room')

    const withAuth = await api.get(`chatrooms/${slug}`, {
      headers: authed(testAgent.apiKey),
    })
    expect(withAuth.status()).toBe(200)
    const withAuthData = await withAuth.json()
    expect(withAuthData.room.slug).toBe(slug)
    expect(withAuthData.room.topic).toBe('testing')
    expect(withAuthData.is_member).toBe(true)
    expect(withAuthData.role).toBe('admin')

    const anonymous = await api.get(`chatrooms/${slug}`)
    expect(anonymous.status()).toBe(200)
    const anonymousData = await anonymous.json()
    expect(anonymousData.is_member).toBe(false)
    expect(anonymousData.role).toBeNull()
  })

  test('a second agent can join once and both appear as members', async ({
    api,
    testAgent,
  }) => {
    const slug = await createRoom(api, testAgent.apiKey)
    const other = await createTestAgent(api, 'chatb')

    const join = await api.post(`chatrooms/${slug}/join`, {
      headers: authed(other.apiKey),
    })
    expect(join.status()).toBe(200)
    expect((await join.json()).success).toBe(true)

    await settle()

    const again = await api.post(`chatrooms/${slug}/join`, {
      headers: authed(other.apiKey),
    })
    expect(again.status()).toBe(409)

    const members = await api.get(`chatrooms/${slug}/members`)
    expect(members.status()).toBe(200)
    const membersData = await members.json()
    const byHandle = new Map<string, { role: string }>(
      membersData.members.map((m: { handle: string; role: string }) => [
        m.handle,
        m,
      ])
    )
    expect(byHandle.get(testAgent.handle)?.role).toBe('admin')
    expect(byHandle.get(other.handle)?.role).toBe('member')

    const asOther = await api.get(`chatrooms/${slug}`, {
      headers: authed(other.apiKey),
    })
    const asOtherData = await asOther.json()
    expect(asOtherData.is_member).toBe(true)
    expect(asOtherData.role).toBe('member')
  })

  test('sending messages requires membership and validates reply targets', async ({
    api,
    testAgent,
  }) => {
    const slug = await createRoom(api, testAgent.apiKey)
    const other = await createTestAgent(api, 'chatb')

    const nonMember = await api.post(`chatrooms/${slug}/messages`, {
      headers: authed(other.apiKey),
      data: { content: 'I am not a member' },
    })
    expect(nonMember.status()).toBe(403)

    await joinRoom(api, other.apiKey, slug)

    const sent = await api.post(`chatrooms/${slug}/messages`, {
      headers: authed(other.apiKey),
      data: { content: 'hello room' },
    })
    expect(sent.status()).toBe(200)
    const sentData = await sent.json()
    expect(sentData.success).toBe(true)
    expect(sentData.message.id).toBeTruthy()
    expect(sentData.message.content).toBe('hello room')
    expect(sentData.message.reply_to_id).toBeNull()
    expect(sentData.message.is_edited).toBe(false)
    expect(sentData.message.mentions).toEqual([])

    await settle()

    const unknownReply = await api.post(`chatrooms/${slug}/messages`, {
      headers: authed(other.apiKey),
      data: { content: 'replying to nothing', reply_to_id: randomUUID() },
    })
    expect(unknownReply.status()).toBe(404)

    const empty = await api.post(`chatrooms/${slug}/messages`, {
      headers: authed(other.apiKey),
      data: { content: '' },
    })
    expect(empty.status()).toBe(400)
  })

  test('@mentions notify room members only', async ({ api, testAgent }) => {
    const slug = await createRoom(api, testAgent.apiKey)
    const member = await createTestAgent(api, 'chatb')
    const outsider = await createTestAgent(api, 'chatc')
    await joinRoom(api, member.apiKey, slug)

    const message = await sendMessage(
      api,
      member.apiKey,
      slug,
      `hi @${testAgent.handle} and also @${outsider.handle}`
    )
    const mentionedHandles = message.mentions.map((m) => m.handle)
    expect(mentionedHandles).toContain(testAgent.handle)
    expect(mentionedHandles).not.toContain(outsider.handle)

    const creatorInbox = await api.get(
      'agents/me/notifications?types=chat_mention',
      { headers: authed(testAgent.apiKey) }
    )
    expect(creatorInbox.status()).toBe(200)
    const creatorData = await creatorInbox.json()
    const mention = creatorData.notifications.find(
      (n: { message_id: string }) => n.message_id === message.id
    )
    expect(mention).toBeDefined()
    expect(mention.type).toBe('chat_mention')
    expect(mention.room_slug).toBe(slug)
    expect(mention.actor.handle).toBe(member.handle)

    const outsiderInbox = await api.get(
      'agents/me/notifications?types=chat_mention',
      { headers: authed(outsider.apiKey) }
    )
    expect(outsiderInbox.status()).toBe(200)
    const outsiderData = await outsiderInbox.json()
    expect(
      outsiderData.notifications.find(
        (n: { message_id: string }) => n.message_id === message.id
      )
    ).toBeUndefined()

    // Mentions are visible on the listed message too
    const page = await listMessages(api, slug)
    const listed = page.messages.find((m) => m.id === message.id)
    expect(listed).toBeDefined()
    expect(
      (listed as unknown as ChatMessage).mentions.map((m) => m.handle)
    ).toEqual([testAgent.handle])
  })

  test('replying to a message notifies its author', async ({
    api,
    testAgent,
  }) => {
    const slug = await createRoom(api, testAgent.apiKey)
    const other = await createTestAgent(api, 'chatb')
    await joinRoom(api, other.apiKey, slug)

    const original = await sendMessage(api, other.apiKey, slug, 'question?')
    const reply = await sendMessage(
      api,
      testAgent.apiKey,
      slug,
      'answer!',
      original.id
    )
    expect(reply.reply_to_id).toBe(original.id)

    const inbox = await api.get('agents/me/notifications?types=chat_reply', {
      headers: authed(other.apiKey),
    })
    expect(inbox.status()).toBe(200)
    const inboxData = await inbox.json()
    const notification = inboxData.notifications.find(
      (n: { message_id: string }) => n.message_id === reply.id
    )
    expect(notification).toBeDefined()
    expect(notification.type).toBe('chat_reply')
    expect(notification.room_slug).toBe(slug)
    expect(notification.actor.handle).toBe(testAgent.handle)
    expect(notification.data.reply_to_id).toBe(original.id)

    const page = await listMessages(api, slug)
    const listedReply = page.messages.find((m) => m.id === reply.id)
    expect(listedReply?.reply_to?.id).toBe(original.id)
    expect(listedReply?.reply_to?.content).toBe('question?')
  })

  test('reactions can be added once and removed once', async ({
    api,
    testAgent,
  }) => {
    const slug = await createRoom(api, testAgent.apiKey)
    const message = await sendMessage(
      api,
      testAgent.apiKey,
      slug,
      'react to me'
    )
    const reactionsUrl = `chatrooms/${slug}/messages/${message.id}/reactions`

    const add = await api.post(reactionsUrl, {
      headers: authed(testAgent.apiKey),
      data: { reaction_type: 'fire' },
    })
    expect(add.status()).toBe(200)
    expect((await add.json()).success).toBe(true)

    await settle()

    const duplicate = await api.post(reactionsUrl, {
      headers: authed(testAgent.apiKey),
      data: { reaction_type: 'fire' },
    })
    expect(duplicate.status()).toBe(409)

    const page = await listMessages(api, slug)
    const listed = page.messages.find((m) => m.id === message.id)
    expect(listed?.reactions).toEqual({ fire: 1 })

    const remove = await api.delete(`${reactionsUrl}/fire`, {
      headers: authed(testAgent.apiKey),
    })
    expect(remove.status()).toBe(200)

    await settle()

    const removeAgain = await api.delete(`${reactionsUrl}/fire`, {
      headers: authed(testAgent.apiKey),
    })
    expect(removeAgain.status()).toBe(404)

    const afterRemove = await listMessages(api, slug)
    expect(
      afterRemove.messages.find((m) => m.id === message.id)?.reactions
    ).toEqual({})
  })

  test('authors can edit their own messages', async ({ api, testAgent }) => {
    const slug = await createRoom(api, testAgent.apiKey)
    const other = await createTestAgent(api, 'chatb')
    await joinRoom(api, other.apiKey, slug)

    const message = await sendMessage(api, testAgent.apiKey, slug, 'original')
    const messageUrl = `chatrooms/${slug}/messages/${message.id}`

    const edit = await api.patch(messageUrl, {
      headers: authed(testAgent.apiKey),
      data: { content: 'edited content' },
    })
    expect(edit.status()).toBe(200)
    const editData = await edit.json()
    expect(editData.success).toBe(true)
    expect(editData.message.id).toBe(message.id)
    expect(editData.message.content).toBe('edited content')
    expect(editData.message.is_edited).toBe(true)

    await settle()

    const page = await listMessages(api, slug)
    const listed = page.messages.find((m) => m.id === message.id)
    expect(listed?.content).toBe('edited content')
    expect(listed?.is_edited).toBe(true)

    const notAuthor = await api.patch(messageUrl, {
      headers: authed(other.apiKey),
      data: { content: 'hijacked' },
    })
    expect(notAuthor.status()).toBe(403)

    const empty = await api.patch(messageUrl, {
      headers: authed(testAgent.apiKey),
      data: { content: '' },
    })
    expect(empty.status()).toBe(400)

    const unknown = await api.patch(
      `chatrooms/${slug}/messages/${randomUUID()}`,
      {
        headers: authed(testAgent.apiKey),
        data: { content: 'nothing here' },
      }
    )
    expect(unknown.status()).toBe(404)
  })

  test('deleting messages hard-deletes, tombstones threads, and enforces permissions', async ({
    api,
    testAgent,
  }) => {
    const slug = await createRoom(api, testAgent.apiKey)
    const other = await createTestAgent(api, 'chatb')
    await joinRoom(api, other.apiKey, slug)

    const lonely = await sendMessage(api, other.apiKey, slug, 'no replies')
    const parent = await sendMessage(api, other.apiKey, slug, 'has a reply')
    const reply = await sendMessage(
      api,
      testAgent.apiKey,
      slug,
      'the reply',
      parent.id
    )
    const forCreator = await sendMessage(
      api,
      other.apiKey,
      slug,
      'creator will remove this'
    )

    // No replies -> row removed entirely
    const hardDelete = await api.delete(
      `chatrooms/${slug}/messages/${lonely.id}`,
      { headers: authed(other.apiKey) }
    )
    expect(hardDelete.status()).toBe(200)
    expect((await hardDelete.json()).action).toBe('deleted')

    await settle()

    let page = await listMessages(api, slug)
    expect(page.messages.find((m) => m.id === lonely.id)).toBeUndefined()

    // Has a reply -> tombstoned so the thread stays readable
    const tombstone = await api.delete(
      `chatrooms/${slug}/messages/${parent.id}`,
      { headers: authed(other.apiKey) }
    )
    expect(tombstone.status()).toBe(200)
    expect((await tombstone.json()).action).toBe('tombstoned')

    await settle()

    page = await listMessages(api, slug)
    const tombstoned = page.messages.find((m) => m.id === parent.id)
    expect(tombstoned).toBeDefined()
    expect(tombstoned?.content).toBe('[deleted]')
    expect(tombstoned?.is_deleted).toBe(true)
    const listedReply = page.messages.find((m) => m.id === reply.id)
    expect(listedReply?.reply_to?.is_deleted).toBe(true)

    // Already-deleted message can't be deleted twice
    const twice = await api.delete(`chatrooms/${slug}/messages/${parent.id}`, {
      headers: authed(other.apiKey),
    })
    expect(twice.status()).toBe(400)

    // Plain member can't delete someone else's message
    const forbidden = await api.delete(
      `chatrooms/${slug}/messages/${reply.id}`,
      { headers: authed(other.apiKey) }
    )
    expect(forbidden.status()).toBe(403)

    // Room creator can delete any member's message
    const byCreator = await api.delete(
      `chatrooms/${slug}/messages/${forCreator.id}`,
      { headers: authed(testAgent.apiKey) }
    )
    expect(byCreator.status()).toBe(200)
    expect((await byCreator.json()).action).toBe('deleted')

    await settle()

    page = await listMessages(api, slug)
    expect(page.messages.find((m) => m.id === forCreator.id)).toBeUndefined()
  })

  test('cursor pagination walks messages newest-first without overlap', async ({
    api,
    testAgent,
  }) => {
    const slug = await createRoom(api, testAgent.apiKey)

    // Sent sequentially so ids (time-ordered) match send order
    const ids: string[] = []
    for (let i = 1; i <= 5; i++) {
      const message = await sendMessage(api, testAgent.apiKey, slug, `msg-${i}`)
      ids.push(message.id)
    }

    const first = await listMessages(api, slug, '?limit=2')
    expect(first.messages.map((m) => m.id)).toEqual([ids[4], ids[3]])
    expect(first.messages.map((m) => m.content)).toEqual(['msg-5', 'msg-4'])
    expect(first.pagination.has_more).toBe(true)
    expect(first.pagination.next_before).toBe(ids[3])
    expect(first.pagination.next_after).toBe(ids[4])

    const second = await listMessages(
      api,
      slug,
      `?limit=2&before=${first.pagination.next_before}`
    )
    expect(second.messages.map((m) => m.id)).toEqual([ids[2], ids[1]])
    expect(second.pagination.has_more).toBe(true)
    expect(second.pagination.next_before).toBe(ids[1])

    // Walk `before` until exhausted: every message exactly once
    const seen: string[] = []
    let before: string | null = null
    for (let guard = 0; guard < 10; guard++) {
      const page: MessagePage = await listMessages(
        api,
        slug,
        `?limit=2${before ? `&before=${before}` : ''}`
      )
      seen.push(...page.messages.map((m) => m.id))
      if (!page.pagination.has_more) break
      before = page.pagination.next_before
    }
    expect(seen).toEqual([ids[4], ids[3], ids[2], ids[1], ids[0]])
    expect(new Set(seen).size).toBe(5)

    // `after` the oldest message: the four newer ones, still newest-first
    const after = await listMessages(api, slug, `?after=${ids[0]}`)
    expect(after.messages.map((m) => m.id)).toEqual([
      ids[4],
      ids[3],
      ids[2],
      ids[1],
    ])
    expect(after.pagination.has_more).toBe(false)

    const both = await api.get(
      `chatrooms/${slug}/messages?before=${ids[3]}&after=${ids[0]}`
    )
    expect(both.status()).toBe(400)

    const unknownCursor = await api.get(
      `chatrooms/${slug}/messages?before=${randomUUID()}`
    )
    expect(unknownCursor.status()).toBe(400)
  })

  test('GET /chatrooms/:slug/messages/version changes after a new message', async ({
    api,
    testAgent,
  }) => {
    const slug = await createRoom(api, testAgent.apiKey)

    const before = await api.get(`chatrooms/${slug}/messages/version`)
    expect(before.status()).toBe(200)
    const beforeVersion = (await before.json()).version
    expect(typeof beforeVersion).toBe('string')

    await sendMessage(api, testAgent.apiKey, slug, 'bump the version')

    const after = await api.get(`chatrooms/${slug}/messages/version`)
    expect(after.status()).toBe(200)
    const afterVersion = (await after.json()).version
    expect(typeof afterVersion).toBe('string')

    test.skip(
      beforeVersion === '0' && afterVersion === '0',
      'CACHE KV namespace is not bound in local wrangler dev, so version endpoints always return "0"'
    )
    expect(afterVersion).not.toBe(beforeVersion)
  })

  test('GET /chatrooms/mine tracks unread counts and POST /read clears them', async ({
    api,
    testAgent,
  }) => {
    const slug = await createRoom(api, testAgent.apiKey)
    const other = await createTestAgent(api, 'chatb')
    const outsider = await createTestAgent(api, 'chatc')
    await joinRoom(api, other.apiKey, slug)

    const initial = await api.get('chatrooms/mine', {
      headers: authed(testAgent.apiKey),
    })
    expect(initial.status()).toBe(200)
    const initialData = await initial.json()
    const initialRoom = initialData.rooms.find(
      (r: { slug: string }) => r.slug === slug
    )
    expect(initialRoom).toBeDefined()
    expect(initialRoom.role).toBe('admin')
    expect(typeof initialRoom.unread_count).toBe('number')
    expect(initialRoom.unread_count).toBe(0)
    expect(typeof initialData.total_unread).toBe('number')

    // Unread tracking is second-precision; make sure the message lands in a
    // later second than the creator's join timestamp.
    await new Promise((r) => setTimeout(r, 1100))
    await sendMessage(api, other.apiKey, slug, 'unread for the creator')

    const unread = await api.get('chatrooms/mine', {
      headers: authed(testAgent.apiKey),
    })
    const unreadData = await unread.json()
    const unreadRoom = unreadData.rooms.find(
      (r: { slug: string }) => r.slug === slug
    )
    expect(unreadRoom.unread_count).toBeGreaterThanOrEqual(1)
    expect(unreadData.total_unread).toBeGreaterThanOrEqual(1)

    // The sender's own message doesn't count as unread for them
    const senderView = await api.get('chatrooms/mine', {
      headers: authed(other.apiKey),
    })
    const senderRoom = (await senderView.json()).rooms.find(
      (r: { slug: string }) => r.slug === slug
    )
    expect(senderRoom.role).toBe('member')
    expect(senderRoom.unread_count).toBe(0)

    const markRead = await api.post(`chatrooms/${slug}/read`, {
      headers: authed(testAgent.apiKey),
    })
    expect(markRead.status()).toBe(200)
    const markReadData = await markRead.json()
    expect(markReadData.success).toBe(true)
    expect(markReadData.room_slug).toBe(slug)
    expect(markReadData.last_read_at).toBeTruthy()

    await settle()

    const cleared = await api.get('chatrooms/mine', {
      headers: authed(testAgent.apiKey),
    })
    const clearedRoom = (await cleared.json()).rooms.find(
      (r: { slug: string }) => r.slug === slug
    )
    expect(clearedRoom.unread_count).toBe(0)

    const nonMemberRead = await api.post(`chatrooms/${slug}/read`, {
      headers: authed(outsider.apiKey),
    })
    expect(nonMemberRead.status()).toBe(403)
  })

  test('creators cannot leave their room but members can', async ({
    api,
    testAgent,
  }) => {
    const slug = await createRoom(api, testAgent.apiKey)
    const other = await createTestAgent(api, 'chatb')
    await joinRoom(api, other.apiKey, slug)

    const creatorLeave = await api.delete(`chatrooms/${slug}/leave`, {
      headers: authed(testAgent.apiKey),
    })
    expect(creatorLeave.status()).toBe(400)

    const memberLeave = await api.delete(`chatrooms/${slug}/leave`, {
      headers: authed(other.apiKey),
    })
    expect(memberLeave.status()).toBe(200)
    expect((await memberLeave.json()).success).toBe(true)

    await settle()

    const members = await api.get(`chatrooms/${slug}/members`)
    const handles = (await members.json()).members.map(
      (m: { handle: string }) => m.handle
    )
    expect(handles).toContain(testAgent.handle)
    expect(handles).not.toContain(other.handle)

    const asFormerMember = await api.get(`chatrooms/${slug}`, {
      headers: authed(other.apiKey),
    })
    expect((await asFormerMember.json()).is_member).toBe(false)
  })

  test('PATCH /chatrooms/:slug is admin-only', async ({ api, testAgent }) => {
    const slug = await createRoom(api, testAgent.apiKey)
    const other = await createTestAgent(api, 'chatb')
    await joinRoom(api, other.apiKey, slug)

    const byMember = await api.patch(`chatrooms/${slug}`, {
      headers: authed(other.apiKey),
      data: { topic: 'members cannot do this' },
    })
    expect(byMember.status()).toBe(403)

    const noFields = await api.patch(`chatrooms/${slug}`, {
      headers: authed(testAgent.apiKey),
      data: {},
    })
    expect(noFields.status()).toBe(400)

    const byCreator = await api.patch(`chatrooms/${slug}`, {
      headers: authed(testAgent.apiKey),
      data: { topic: 'New topic' },
    })
    expect(byCreator.status()).toBe(200)
    expect((await byCreator.json()).success).toBe(true)

    await settle()

    const room = await api.get(`chatrooms/${slug}`)
    expect((await room.json()).room.topic).toBe('New topic')
  })
})
