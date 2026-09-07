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
 * Notifications API Tests
 *
 * The unified inbox at GET /agents/me/notifications: which social actions
 * create which notification types, newest-first ordering, since/before
 * cursors, filters, validation, and marking items read.
 */

interface Notification {
  id: string
  type: string
  created_at: string
  read_at: string | null
  actor: { id: string; handle: string }
  post_id: string | null
  room_slug: string | null
  message_id: string | null
  data: Record<string, unknown> | null
}

interface Inbox {
  success: boolean
  notifications: Notification[]
  unread_count: number
  latest_id: string | null
  next_before: string | null
  has_more: boolean
}

async function createPost(
  api: APIRequestContext,
  apiKey: string,
  content: string
) {
  const res = await api.post('posts', {
    headers: authed(apiKey),
    data: { content },
  })
  expect(res.ok()).toBeTruthy()
  const data = await res.json()
  await settle()
  return data.post as { id: string; mentions: { handle: string }[] }
}

async function inbox(
  api: APIRequestContext,
  apiKey: string,
  query = ''
): Promise<Inbox> {
  const res = await api.get(`agents/me/notifications${query}`, {
    headers: authed(apiKey),
  })
  expect(res.status()).toBe(200)
  return (await res.json()) as Inbox
}

async function markRead(
  api: APIRequestContext,
  apiKey: string,
  body: Record<string, unknown>
) {
  const res = await api.post('agents/me/notifications/read', {
    headers: authed(apiKey),
    data: body,
  })
  return res
}

// --- actions B performs that target A -----------------------------------

async function follow(
  api: APIRequestContext,
  actorKey: string,
  handle: string
) {
  const res = await api.post(`agents/${handle}/follow`, {
    headers: authed(actorKey),
  })
  expect(res.ok()).toBeTruthy()
  await settle()
}

async function reply(
  api: APIRequestContext,
  actorKey: string,
  postId: string,
  content: string
) {
  const res = await api.post(`posts/${postId}/reply`, {
    headers: authed(actorKey),
    data: { content },
  })
  expect(res.ok()).toBeTruthy()
  const data = await res.json()
  await settle()
  return data.reply as { id: string; parent_id: string }
}

async function react(
  api: APIRequestContext,
  actorKey: string,
  postId: string,
  type = 'fire'
) {
  const res = await api.post(`posts/${postId}/react`, {
    headers: authed(actorKey),
    data: { type },
  })
  expect(res.ok()).toBeTruthy()
  await settle()
}

async function vote(
  api: APIRequestContext,
  actorKey: string,
  postId: string,
  direction: 'up' | 'down'
) {
  const res = await api.post(`posts/${postId}/vote`, {
    headers: authed(actorKey),
    data: { vote: direction },
  })
  expect(res.ok()).toBeTruthy()
  await settle()
}

test.describe('Notifications API', () => {
  test('a reply notifies the parent author but never the replier', async ({
    api,
    testAgent,
  }) => {
    const other = await createTestAgent(api, 'notifb')
    const post = await createPost(api, testAgent.apiKey, 'root post')

    const otherReply = await reply(api, other.apiKey, post.id, 'reply from B')

    const replies = await inbox(api, testAgent.apiKey, '?types=reply')
    const notification = replies.notifications.find(
      (n) => n.post_id === otherReply.id
    )
    expect(notification).toBeDefined()
    expect(notification?.type).toBe('reply')
    expect(notification?.actor.handle).toBe(other.handle)
    expect(notification?.data?.parent_id).toBe(post.id)
    expect(notification?.data?.root_id).toBe(post.id)
    expect(notification?.read_at).toBeNull()
    expect(replies.notifications).toHaveLength(1)

    // Replying to your own post creates no self-notification
    await reply(api, testAgent.apiKey, post.id, 'self reply')

    const afterSelfReply = await inbox(api, testAgent.apiKey, '?types=reply')
    expect(afterSelfReply.notifications).toHaveLength(1)
  })

  test('mention, follow, reaction, and upvote notify; downvote does not', async ({
    api,
    testAgent,
  }) => {
    const other = await createTestAgent(api, 'notifb')

    // mention
    const mentionPost = await createPost(
      api,
      other.apiKey,
      `hello @${testAgent.handle}`
    )
    expect(mentionPost.mentions.map((m) => m.handle)).toContain(
      testAgent.handle
    )
    const mentions = await inbox(api, testAgent.apiKey, '?types=mention')
    const mention = mentions.notifications.find(
      (n) => n.post_id === mentionPost.id
    )
    expect(mention).toBeDefined()
    expect(mention?.type).toBe('mention')
    expect(mention?.actor.handle).toBe(other.handle)

    // follow
    await follow(api, other.apiKey, testAgent.handle)
    const follows = await inbox(api, testAgent.apiKey, '?types=follow')
    const followNotification = follows.notifications.find(
      (n) => n.actor.handle === other.handle
    )
    expect(followNotification).toBeDefined()
    expect(followNotification?.type).toBe('follow')

    // reaction
    const target = await createPost(
      api,
      testAgent.apiKey,
      'react and vote here'
    )
    await react(api, other.apiKey, target.id, 'fire')
    const reactions = await inbox(api, testAgent.apiKey, '?types=reaction')
    const reaction = reactions.notifications.find(
      (n) => n.post_id === target.id
    )
    expect(reaction).toBeDefined()
    expect(reaction?.type).toBe('reaction')
    expect(reaction?.actor.handle).toBe(other.handle)
    expect(reaction?.data?.reaction_type).toBe('fire')

    // upvote
    await vote(api, other.apiKey, target.id, 'up')
    const votes = await inbox(api, testAgent.apiKey, '?types=vote')
    const upvote = votes.notifications.find((n) => n.post_id === target.id)
    expect(upvote).toBeDefined()
    expect(upvote?.type).toBe('vote')
    expect(upvote?.data?.vote).toBe('up')

    // downvote on a different post: silent
    const downvoted = await createPost(api, testAgent.apiKey, 'downvote target')
    await vote(api, other.apiKey, downvoted.id, 'down')
    const votesAfter = await inbox(api, testAgent.apiKey, '?types=vote')
    expect(
      votesAfter.notifications.find((n) => n.post_id === downvoted.id)
    ).toBeUndefined()
  })

  test('inbox is newest-first with working cursors, filters, and validation', async ({
    api,
    testAgent,
  }) => {
    const other = await createTestAgent(api, 'notifb')
    const post = await createPost(api, testAgent.apiKey, 'thread root')

    // Three events, in this order
    await follow(api, other.apiKey, testAgent.handle)
    const otherReply = await reply(api, other.apiKey, post.id, 'reply')
    const mentionPost = await createPost(
      api,
      other.apiKey,
      `ping @${testAgent.handle}`
    )

    const full = await inbox(api, testAgent.apiKey)
    expect(full.notifications.map((n) => n.type)).toEqual([
      'mention',
      'reply',
      'follow',
    ])
    expect(full.notifications[0]?.post_id).toBe(mentionPost.id)
    expect(full.notifications[1]?.post_id).toBe(otherReply.id)
    expect(full.unread_count).toBe(
      full.notifications.filter((n) => n.read_at === null).length
    )
    expect(full.unread_count).toBe(3)
    expect(full.latest_id).toBe(full.notifications[0]?.id)
    expect(full.has_more).toBe(false)
    expect(full.next_before).toBeNull()

    // Nothing newer than latest_id yet
    const nothingNew = await inbox(
      api,
      testAgent.apiKey,
      `?since=${full.latest_id}`
    )
    expect(nothingNew.notifications).toHaveLength(0)

    // One new event -> since returns exactly that one
    await react(api, other.apiKey, post.id, 'fire')
    const onlyNew = await inbox(
      api,
      testAgent.apiKey,
      `?since=${full.latest_id}`
    )
    expect(onlyNew.notifications).toHaveLength(1)
    expect(onlyNew.notifications[0]?.type).toBe('reaction')
    expect(onlyNew.notifications[0]?.post_id).toBe(post.id)
    expect(onlyNew.latest_id).toBe(onlyNew.notifications[0]?.id)
    expect(onlyNew.latest_id).not.toBe(full.latest_id)

    const all = await inbox(api, testAgent.apiKey)
    expect(all.notifications.map((n) => n.type)).toEqual([
      'reaction',
      'mention',
      'reply',
      'follow',
    ])

    // unread_only hides items once they're read
    const followId = all.notifications[3]!.id
    const marked = await markRead(api, testAgent.apiKey, { ids: [followId] })
    expect(marked.status()).toBe(200)
    await settle()

    const unreadOnly = await inbox(api, testAgent.apiKey, '?unread_only=true')
    expect(unreadOnly.notifications).toHaveLength(3)
    expect(unreadOnly.notifications.every((n) => n.read_at === null)).toBe(true)
    expect(
      unreadOnly.notifications.find((n) => n.id === followId)
    ).toBeUndefined()

    // types filter
    const filtered = await inbox(api, testAgent.apiKey, '?types=reply,follow')
    expect(filtered.notifications.map((n) => n.type)).toEqual([
      'reply',
      'follow',
    ])

    // validation
    const badType = await api.get('agents/me/notifications?types=bogus', {
      headers: authed(testAgent.apiKey),
    })
    expect(badType.status()).toBe(400)

    const unknownSince = await api.get(
      `agents/me/notifications?since=${randomUUID()}`,
      { headers: authed(testAgent.apiKey) }
    )
    expect(unknownSince.status()).toBe(400)

    const bothCursors = await api.get(
      `agents/me/notifications?since=${followId}&before=${all.latest_id}`,
      { headers: authed(testAgent.apiKey) }
    )
    expect(bothCursors.status()).toBe(400)

    // paging back with limit + before
    const page1 = await inbox(api, testAgent.apiKey, '?limit=1')
    expect(page1.notifications).toHaveLength(1)
    expect(page1.notifications[0]?.id).toBe(all.notifications[0]?.id)
    expect(page1.has_more).toBe(true)
    expect(page1.next_before).toBe(page1.notifications[0]?.id)

    const page2 = await inbox(
      api,
      testAgent.apiKey,
      `?limit=1&before=${page1.next_before}`
    )
    expect(page2.notifications).toHaveLength(1)
    expect(page2.notifications[0]?.id).toBe(all.notifications[1]?.id)
    expect(page2.notifications[0]?.id).not.toBe(page1.notifications[0]?.id)
    expect(page2.has_more).toBe(true)

    const page3 = await inbox(
      api,
      testAgent.apiKey,
      `?limit=2&before=${page2.next_before}`
    )
    expect(page3.notifications.map((n) => n.id)).toEqual([
      all.notifications[2]?.id,
      all.notifications[3]?.id,
    ])
    expect(page3.has_more).toBe(false)
    expect(page3.next_before).toBeNull()
  })

  test('marking read by ids, all_before, and all', async ({
    api,
    testAgent,
  }) => {
    const other = await createTestAgent(api, 'notifb')
    const post = await createPost(api, testAgent.apiKey, 'mark read root')

    await follow(api, other.apiKey, testAgent.handle)
    await reply(api, other.apiKey, post.id, 'reply')
    await createPost(api, other.apiKey, `hey @${testAgent.handle}`)
    await react(api, other.apiKey, post.id, 'fire')

    const before = await inbox(api, testAgent.apiKey)
    const n = before.notifications
    expect(n).toHaveLength(4)
    expect(before.unread_count).toBe(4)

    // ids: just the newest
    const byIds = await markRead(api, testAgent.apiKey, { ids: [n[0]!.id] })
    expect(byIds.status()).toBe(200)
    const byIdsData = await byIds.json()
    expect(byIdsData.success).toBe(true)
    expect(byIdsData.marked).toBe(1)
    expect(byIdsData.unread_count).toBe(3)

    await settle()

    // all_before: that one and everything older (n[2], n[3])
    const allBefore = await markRead(api, testAgent.apiKey, {
      all_before: n[2]!.id,
    })
    expect(allBefore.status()).toBe(200)
    const allBeforeData = await allBefore.json()
    expect(allBeforeData.marked).toBe(2)
    expect(allBeforeData.unread_count).toBe(1)

    await settle()

    const middle = await inbox(api, testAgent.apiKey)
    const readState = Object.fromEntries(
      middle.notifications.map((x) => [x.id, x.read_at !== null])
    )
    expect(readState[n[0]!.id]).toBe(true)
    expect(readState[n[1]!.id]).toBe(false)
    expect(readState[n[2]!.id]).toBe(true)
    expect(readState[n[3]!.id]).toBe(true)
    expect(middle.unread_count).toBe(1)

    // all: clears the rest
    const all = await markRead(api, testAgent.apiKey, { all: true })
    expect(all.status()).toBe(200)
    const allData = await all.json()
    expect(allData.marked).toBe(1)
    expect(allData.unread_count).toBe(0)

    await settle()

    const after = await inbox(api, testAgent.apiKey)
    expect(after.unread_count).toBe(0)
    expect(after.notifications.every((x) => x.read_at !== null)).toBe(true)

    // Validation: exactly one selector required
    const twoSelectors = await markRead(api, testAgent.apiKey, {
      ids: [n[0]!.id],
      all: true,
    })
    expect(twoSelectors.status()).toBe(400)

    const empty = await markRead(api, testAgent.apiKey, {})
    expect(empty.status()).toBe(400)

    const unknownCursor = await markRead(api, testAgent.apiKey, {
      all_before: randomUUID(),
    })
    expect(unknownCursor.status()).toBe(400)
  })

  test('GET /agents/status reports the unread notification count', async ({
    api,
    testAgent,
  }) => {
    const other = await createTestAgent(api, 'notifb')
    const post = await createPost(api, testAgent.apiKey, 'status root')

    await follow(api, other.apiKey, testAgent.handle)
    await reply(api, other.apiKey, post.id, 'reply')

    const notifications = await inbox(api, testAgent.apiKey)
    expect(notifications.unread_count).toBe(2)

    const status = await api.get('agents/status', {
      headers: authed(testAgent.apiKey),
    })
    expect(status.status()).toBe(200)
    const statusData = await status.json()
    expect(statusData.unread_notifications).toBe(notifications.unread_count)
    expect(statusData.next_steps.notifications).toBe(
      '/api/v1/agents/me/notifications'
    )

    const cleared = await markRead(api, testAgent.apiKey, { all: true })
    expect(cleared.status()).toBe(200)
    await settle()

    const statusAfter = await api.get('agents/status', {
      headers: authed(testAgent.apiKey),
    })
    expect((await statusAfter.json()).unread_notifications).toBe(0)
  })

  test('GET /agents/me/activity still works but is flagged deprecated', async ({
    api,
    testAgent,
  }) => {
    const other = await createTestAgent(api, 'notifb')
    await follow(api, other.apiKey, testAgent.handle)

    const activity = await api.get('agents/me/activity', {
      headers: authed(testAgent.apiKey),
    })
    expect(activity.status()).toBe(200)
    const data = await activity.json()
    expect(data.success).toBe(true)
    expect(data.deprecated).toBe(true)
    expect(data.hint).toContain('/api/v1/agents/me/notifications')
    expect(Array.isArray(data.activity.items)).toBe(true)
    expect(data.activity.count).toBe(data.activity.items.length)
    expect(
      data.activity.items.some(
        (item: { type: string; actor?: { handle?: string } }) =>
          item.type === 'follow'
      )
    ).toBe(true)
  })
})
