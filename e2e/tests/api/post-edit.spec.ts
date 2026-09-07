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
 * Post Editing API Tests
 *
 * PATCH /posts/:id — ownership, validation, edited_at propagation, reply
 * limits, mention notifications on edit, tombstones, and feed versioning.
 */

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
  return data.post as { id: string }
}

async function createReply(
  api: APIRequestContext,
  apiKey: string,
  postId: string,
  content: string
) {
  const res = await api.post(`posts/${postId}/reply`, {
    headers: authed(apiKey),
    data: { content },
  })
  expect(res.ok()).toBeTruthy()
  const data = await res.json()
  await settle()
  return data.reply as { id: string; parent_id: string }
}

test.describe('Post Edit API', () => {
  test('owner can edit a post and edited_at shows up everywhere', async ({
    api,
    testAgent,
  }) => {
    const post = await createPost(api, testAgent.apiKey, 'original content')

    const edit = await api.patch(`posts/${post.id}`, {
      headers: authed(testAgent.apiKey),
      data: { content: 'edited content' },
    })
    expect(edit.status()).toBe(200)
    const editData = await edit.json()
    expect(editData.success).toBe(true)
    expect(editData.post.id).toBe(post.id)
    expect(editData.post.content).toBe('edited content')
    expect(editData.post.edited_at).toBeTruthy()
    expect(editData.post.parent_id).toBeNull()
    expect(Array.isArray(editData.post.mentions)).toBe(true)

    await settle()

    const single = await api.get(`posts/${post.id}`)
    expect(single.status()).toBe(200)
    const singleData = await single.json()
    expect(singleData.post.content).toBe('edited content')
    expect(singleData.post.edited_at).not.toBeNull()

    const list = await api.get('posts?sort=new&limit=50')
    expect(list.status()).toBe(200)
    const listed = (await list.json()).posts.find(
      (p: { id: string }) => p.id === post.id
    )
    expect(listed).toBeDefined()
    expect(listed.content).toBe('edited content')
    expect(listed.edited_at).not.toBeNull()
  })

  test('rejects edits from non-owners, unknown posts, empty bodies, and oversized content', async ({
    api,
    testAgent,
  }) => {
    const other = await createTestAgent(api, 'editb')
    const post = await createPost(api, testAgent.apiKey, 'protected content')

    const notOwner = await api.patch(`posts/${post.id}`, {
      headers: authed(other.apiKey),
      data: { content: 'hijacked' },
    })
    expect(notOwner.status()).toBe(403)

    const unknown = await api.patch(`posts/${randomUUID()}`, {
      headers: authed(testAgent.apiKey),
      data: { content: 'nothing here' },
    })
    expect(unknown.status()).toBe(404)

    const emptyBody = await api.patch(`posts/${post.id}`, {
      headers: authed(testAgent.apiKey),
      data: {},
    })
    expect(emptyBody.status()).toBe(400)

    const emptyContent = await api.patch(`posts/${post.id}`, {
      headers: authed(testAgent.apiKey),
      data: { content: '' },
    })
    expect(emptyContent.status()).toBe(400)

    const tooLong = await api.patch(`posts/${post.id}`, {
      headers: authed(testAgent.apiKey),
      data: { content: 'x'.repeat(10001) },
    })
    expect(tooLong.status()).toBe(400)

    const unauthenticated = await api.patch(`posts/${post.id}`, {
      data: { content: 'no auth' },
    })
    expect(unauthenticated.status()).toBe(401)

    await settle()

    // None of the rejected edits touched the post
    const check = await api.get(`posts/${post.id}`)
    const checkData = await check.json()
    expect(checkData.post.content).toBe('protected content')
    expect(checkData.post.edited_at).toBeNull()
  })

  test('replies can be edited, with a 5000 character limit', async ({
    api,
    testAgent,
  }) => {
    const post = await createPost(api, testAgent.apiKey, 'root for reply edit')
    const reply = await createReply(
      api,
      testAgent.apiKey,
      post.id,
      'original reply'
    )

    const edit = await api.patch(`posts/${reply.id}`, {
      headers: authed(testAgent.apiKey),
      data: { content: 'edited reply' },
    })
    expect(edit.status()).toBe(200)
    const editData = await edit.json()
    expect(editData.post.id).toBe(reply.id)
    expect(editData.post.content).toBe('edited reply')
    expect(editData.post.parent_id).toBe(post.id)
    expect(editData.post.edited_at).toBeTruthy()

    await settle()

    const fetched = await api.get(`posts/${reply.id}`)
    const fetchedData = await fetched.json()
    expect(fetchedData.post.content).toBe('edited reply')
    expect(fetchedData.post.edited_at).not.toBeNull()

    const tree = await api.get(`posts/${post.id}`)
    const treeReply = (await tree.json()).replies.find(
      (r: { id: string }) => r.id === reply.id
    )
    expect(treeReply.content).toBe('edited reply')
    expect(treeReply.edited_at).not.toBeNull()

    const tooLong = await api.patch(`posts/${reply.id}`, {
      headers: authed(testAgent.apiKey),
      data: { content: 'y'.repeat(5001) },
    })
    expect(tooLong.status()).toBe(400)

    const atLimit = await api.patch(`posts/${reply.id}`, {
      headers: authed(testAgent.apiKey),
      data: { content: 'z'.repeat(5000) },
    })
    expect(atLimit.status()).toBe(200)
  })

  test('adding a mention in an edit notifies that agent exactly once', async ({
    api,
    testAgent,
  }) => {
    const other = await createTestAgent(api, 'editb')
    const post = await createPost(api, testAgent.apiKey, 'no mentions yet')

    const firstEdit = await api.patch(`posts/${post.id}`, {
      headers: authed(testAgent.apiKey),
      data: { content: `pinging @${other.handle}` },
    })
    expect(firstEdit.status()).toBe(200)
    const firstData = await firstEdit.json()
    expect(
      firstData.post.mentions.map((m: { handle: string }) => m.handle)
    ).toEqual([other.handle])

    await settle()

    const secondEdit = await api.patch(`posts/${post.id}`, {
      headers: authed(testAgent.apiKey),
      data: { content: `pinging @${other.handle} again` },
    })
    expect(secondEdit.status()).toBe(200)
    const secondData = await secondEdit.json()
    expect(
      secondData.post.mentions.map((m: { handle: string }) => m.handle)
    ).toEqual([other.handle])

    await settle()

    const inbox = await api.get('agents/me/notifications?types=mention', {
      headers: authed(other.apiKey),
    })
    expect(inbox.status()).toBe(200)
    const inboxData = await inbox.json()
    const forThisPost = inboxData.notifications.filter(
      (n: { post_id: string }) => n.post_id === post.id
    )
    expect(forThisPost).toHaveLength(1)
    expect(forThisPost[0].type).toBe('mention')
    expect(forThisPost[0].actor.handle).toBe(testAgent.handle)
  })

  test('tombstoned posts cannot be edited', async ({ api, testAgent }) => {
    const other = await createTestAgent(api, 'editb')
    const post = await createPost(api, testAgent.apiKey, 'will be tombstoned')
    await createReply(api, other.apiKey, post.id, 'keeps the thread alive')

    const remove = await api.delete(`posts/${post.id}`, {
      headers: authed(testAgent.apiKey),
    })
    expect(remove.status()).toBe(200)
    expect((await remove.json()).action).toBe('tombstoned')

    await settle()

    const fetched = await api.get(`posts/${post.id}`)
    expect((await fetched.json()).post.content).toBe('[deleted]')

    const edit = await api.patch(`posts/${post.id}`, {
      headers: authed(testAgent.apiKey),
      data: { content: 'resurrected?' },
    })
    expect(edit.status()).toBe(400)
  })

  test('GET /feed/version changes after an edit', async ({
    api,
    testAgent,
  }) => {
    const post = await createPost(api, testAgent.apiKey, 'version probe')

    const before = await api.get('feed/version')
    expect(before.status()).toBe(200)
    const beforeVersion = (await before.json()).version
    expect(typeof beforeVersion).toBe('string')

    const edit = await api.patch(`posts/${post.id}`, {
      headers: authed(testAgent.apiKey),
      data: { content: 'version probe edited' },
    })
    expect(edit.status()).toBe(200)

    await settle()

    const after = await api.get('feed/version')
    expect(after.status()).toBe(200)
    const afterVersion = (await after.json()).version
    expect(typeof afterVersion).toBe('string')

    test.skip(
      beforeVersion === '0' && afterVersion === '0',
      'CACHE KV namespace is not bound in local wrangler dev, so version endpoints always return "0"'
    )
    expect(afterVersion).not.toBe(beforeVersion)
  })
})
