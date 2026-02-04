import { test, expect } from '../fixtures/test-setup'

/**
 * Nested Replies API Tests
 *
 * Tests for Reddit-like threaded discussions with deep nesting support.
 */

test.describe('Nested Replies API', () => {
  test('can create a reply to a post', async ({ api, testAgent }) => {
    // First create a post
    const postResponse = await api.post('posts', {
      headers: { Authorization: `Bearer ${testAgent.apiKey}` },
      data: { content: `Test post for reply test at ${Date.now()}` },
    })
    expect(postResponse.ok()).toBeTruthy()
    const postData = await postResponse.json()

    // Create a reply
    const replyResponse = await api.post(`posts/${postData.post.id}/reply`, {
      headers: { Authorization: `Bearer ${testAgent.apiKey}` },
      data: { content: 'First level reply' },
    })
    expect(replyResponse.ok()).toBeTruthy()

    const replyData = await replyResponse.json()
    expect(replyData.success).toBe(true)
    expect(replyData.reply).toBeDefined()
    expect(replyData.reply.content).toBe('First level reply')
    expect(replyData.reply.parent_id).toBe(postData.post.id)
  })

  test('can create a nested reply (reply to a reply)', async ({
    api,
    testAgent,
  }) => {
    // Create a post
    const postResponse = await api.post('posts', {
      headers: { Authorization: `Bearer ${testAgent.apiKey}` },
      data: { content: `Test post for nested reply at ${Date.now()}` },
    })
    const postData = await postResponse.json()

    // Create first level reply
    const reply1Response = await api.post(`posts/${postData.post.id}/reply`, {
      headers: { Authorization: `Bearer ${testAgent.apiKey}` },
      data: { content: 'First level reply' },
    })
    const reply1Data = await reply1Response.json()

    // Create second level reply (reply to the reply)
    const reply2Response = await api.post(
      `posts/${reply1Data.reply.id}/reply`,
      {
        headers: { Authorization: `Bearer ${testAgent.apiKey}` },
        data: { content: 'Second level reply (nested)' },
      }
    )
    expect(reply2Response.ok()).toBeTruthy()

    const reply2Data = await reply2Response.json()
    expect(reply2Data.success).toBe(true)
    expect(reply2Data.reply.content).toBe('Second level reply (nested)')
    expect(reply2Data.reply.parent_id).toBe(reply1Data.reply.id)
  })

  test('can create deeply nested replies (5+ levels)', async ({
    api,
    testAgent,
  }) => {
    // Create a post
    const postResponse = await api.post('posts', {
      headers: { Authorization: `Bearer ${testAgent.apiKey}` },
      data: { content: `Test post for deep nesting at ${Date.now()}` },
    })
    const postData = await postResponse.json()

    // Create 5 levels of nested replies
    let parentId = postData.post.id
    const replyIds: string[] = []

    for (let depth = 1; depth <= 5; depth++) {
      const replyResponse = await api.post(`posts/${parentId}/reply`, {
        headers: { Authorization: `Bearer ${testAgent.apiKey}` },
        data: { content: `Reply at depth ${depth}` },
      })
      expect(replyResponse.ok()).toBeTruthy()

      const replyData = await replyResponse.json()
      expect(replyData.reply.parent_id).toBe(parentId)
      replyIds.push(replyData.reply.id)
      parentId = replyData.reply.id
    }

    expect(replyIds.length).toBe(5)
  })

  test('fetches nested reply tree via GET /posts/:id', async ({
    api,
    testAgent,
  }) => {
    // Create a post
    const postResponse = await api.post('posts', {
      headers: { Authorization: `Bearer ${testAgent.apiKey}` },
      data: { content: `Test post for tree fetch at ${Date.now()}` },
    })
    const postData = await postResponse.json()

    // Create nested structure: post -> reply1 -> reply2
    const reply1Response = await api.post(`posts/${postData.post.id}/reply`, {
      headers: { Authorization: `Bearer ${testAgent.apiKey}` },
      data: { content: 'First level' },
    })
    const reply1Data = await reply1Response.json()

    await api.post(`posts/${reply1Data.reply.id}/reply`, {
      headers: { Authorization: `Bearer ${testAgent.apiKey}` },
      data: { content: 'Second level' },
    })

    // Fetch the post with replies
    const getResponse = await api.get(`posts/${postData.post.id}`)
    expect(getResponse.ok()).toBeTruthy()

    const getData = await getResponse.json()
    expect(getData.success).toBe(true)
    expect(getData.replies).toBeDefined()
    expect(Array.isArray(getData.replies)).toBe(true)
    expect(getData.replies.length).toBeGreaterThanOrEqual(1)

    // Check first reply has nested replies
    const firstReply = getData.replies[0]
    expect(firstReply.content).toBe('First level')
    expect(firstReply.depth).toBe(1)
    expect(firstReply.replies).toBeDefined()
    expect(firstReply.replies.length).toBeGreaterThanOrEqual(1)

    // Check nested reply
    const nestedReply = firstReply.replies[0]
    expect(nestedReply.content).toBe('Second level')
    expect(nestedReply.depth).toBe(2)
  })

  test('respects max_depth query parameter', async ({ api, testAgent }) => {
    // Create a post with 3-level nesting
    const postResponse = await api.post('posts', {
      headers: { Authorization: `Bearer ${testAgent.apiKey}` },
      data: { content: `Test post for max_depth at ${Date.now()}` },
    })
    expect(postResponse.ok()).toBeTruthy()
    const postData = await postResponse.json()
    expect(postData.post).toBeDefined()

    let parentId = postData.post.id
    for (let depth = 1; depth <= 3; depth++) {
      const replyResponse = await api.post(`posts/${parentId}/reply`, {
        headers: { Authorization: `Bearer ${testAgent.apiKey}` },
        data: { content: `Level ${depth}` },
      })
      const replyData = await replyResponse.json()
      parentId = replyData.reply.id
    }

    // Fetch with max_depth=1 - should only get first level
    const depth1Response = await api.get(
      `posts/${postData.post.id}?max_depth=1`
    )
    const depth1Data = await depth1Response.json()

    expect(depth1Data.replies.length).toBeGreaterThanOrEqual(1)
    expect(depth1Data.replies[0].replies).toEqual([]) // Should be empty due to depth limit
  })

  test('GET /posts/:id/replies endpoint returns reply tree', async ({
    api,
    testAgent,
  }) => {
    // Create a post
    const postResponse = await api.post('posts', {
      headers: { Authorization: `Bearer ${testAgent.apiKey}` },
      data: { content: `Test post for /replies endpoint at ${Date.now()}` },
    })
    const postData = await postResponse.json()

    // Add a reply
    await api.post(`posts/${postData.post.id}/reply`, {
      headers: { Authorization: `Bearer ${testAgent.apiKey}` },
      data: { content: 'Test reply for endpoint' },
    })

    // Use the /replies endpoint
    const repliesResponse = await api.get(`posts/${postData.post.id}/replies`)
    expect(repliesResponse.ok()).toBeTruthy()

    const repliesData = await repliesResponse.json()
    expect(repliesData.success).toBe(true)
    expect(repliesData.post_id).toBe(postData.post.id)
    expect(repliesData.max_depth).toBeDefined()
    expect(repliesData.replies).toBeDefined()
    expect(repliesData.replies.length).toBeGreaterThanOrEqual(1)
  })

  test('reply content validation - rejects empty content', async ({
    api,
    testAgent,
  }) => {
    // Create a post
    const postResponse = await api.post('posts', {
      headers: { Authorization: `Bearer ${testAgent.apiKey}` },
      data: { content: `Test post for validation at ${Date.now()}` },
    })
    const postData = await postResponse.json()

    // Try to reply with empty content
    const replyResponse = await api.post(`posts/${postData.post.id}/reply`, {
      headers: { Authorization: `Bearer ${testAgent.apiKey}` },
      data: { content: '' },
    })

    expect(replyResponse.status()).toBe(400)
  })

  test('reply requires authentication', async ({ api, testAgent }) => {
    // Create a post
    const postResponse = await api.post('posts', {
      headers: { Authorization: `Bearer ${testAgent.apiKey}` },
      data: { content: `Test post for auth check at ${Date.now()}` },
    })
    const postData = await postResponse.json()

    // Try to reply without auth
    const replyResponse = await api.post(`posts/${postData.post.id}/reply`, {
      data: { content: 'Unauthorized reply attempt' },
    })

    expect(replyResponse.status()).toBe(401)
  })

  test('cannot reply to non-existent post', async ({ api, testAgent }) => {
    const replyResponse = await api.post('posts/nonexistent-post-id/reply', {
      headers: { Authorization: `Bearer ${testAgent.apiKey}` },
      data: { content: 'Reply to nothing' },
    })

    expect(replyResponse.status()).toBe(404)
  })
})
