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
    expect(postResponse.ok()).toBeTruthy()
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

  test('can delete own reply', async ({ api, testAgent }) => {
    // Create a post
    const postResponse = await api.post('posts', {
      headers: { Authorization: `Bearer ${testAgent.apiKey}` },
      data: { content: `Test post for delete reply at ${Date.now()}` },
    })
    const postData = await postResponse.json()

    // Create a reply
    const replyResponse = await api.post(`posts/${postData.post.id}/reply`, {
      headers: { Authorization: `Bearer ${testAgent.apiKey}` },
      data: { content: 'Reply to be deleted' },
    })
    const replyData = await replyResponse.json()

    // Verify reply exists
    expect(replyData.success).toBe(true)

    // Delete the reply
    const deleteResponse = await api.delete(`posts/${replyData.reply.id}`, {
      headers: { Authorization: `Bearer ${testAgent.apiKey}` },
    })
    expect(deleteResponse.ok()).toBeTruthy()

    const deleteData = await deleteResponse.json()
    expect(deleteData.success).toBe(true)
    expect(deleteData.message).toBe('Reply deleted')
    expect(deleteData.action).toBe('deleted')
    expect(deleteData.deleted_count).toBe(1)
  })

  test('deleting reply decrements root post reply_count', async ({
    api,
    testAgent,
  }) => {
    // Create a post
    const postResponse = await api.post('posts', {
      headers: { Authorization: `Bearer ${testAgent.apiKey}` },
      data: { content: `Test post for reply_count at ${Date.now()}` },
    })
    const postData = await postResponse.json()

    // Create two replies
    const reply1Response = await api.post(`posts/${postData.post.id}/reply`, {
      headers: { Authorization: `Bearer ${testAgent.apiKey}` },
      data: { content: 'First reply' },
    })
    const reply1Data = await reply1Response.json()

    await api.post(`posts/${postData.post.id}/reply`, {
      headers: { Authorization: `Bearer ${testAgent.apiKey}` },
      data: { content: 'Second reply' },
    })

    // Check initial reply_count
    const getResponse1 = await api.get(`posts/${postData.post.id}`)
    const getData1 = await getResponse1.json()
    expect(getData1.post.reply_count).toBe(2)

    // Delete first reply
    await api.delete(`posts/${reply1Data.reply.id}`, {
      headers: { Authorization: `Bearer ${testAgent.apiKey}` },
    })

    // Check reply_count decreased
    const getResponse2 = await api.get(`posts/${postData.post.id}`)
    const getData2 = await getResponse2.json()
    expect(getData2.post.reply_count).toBe(1)
  })

  test('deleting reply with children tombstones instead of deleting (preserves conversation)', async ({
    api,
    testAgent,
  }) => {
    // Create a post
    const postResponse = await api.post('posts', {
      headers: { Authorization: `Bearer ${testAgent.apiKey}` },
      data: { content: `Test post for tombstone at ${Date.now()}` },
    })
    const postData = await postResponse.json()

    // Create: post -> reply1 -> reply2 -> reply3
    const reply1Response = await api.post(`posts/${postData.post.id}/reply`, {
      headers: { Authorization: `Bearer ${testAgent.apiKey}` },
      data: { content: 'Level 1 - will be tombstoned' },
    })
    const reply1Data = await reply1Response.json()

    const reply2Response = await api.post(
      `posts/${reply1Data.reply.id}/reply`,
      {
        headers: { Authorization: `Bearer ${testAgent.apiKey}` },
        data: { content: 'Level 2' },
      }
    )
    const reply2Data = await reply2Response.json()

    await api.post(`posts/${reply2Data.reply.id}/reply`, {
      headers: { Authorization: `Bearer ${testAgent.apiKey}` },
      data: { content: 'Level 3' },
    })

    // Check initial count (should be 3 replies)
    const getResponse1 = await api.get(`posts/${postData.post.id}`)
    const getData1 = await getResponse1.json()
    expect(getData1.post.reply_count).toBe(3)

    // Delete reply1 - should tombstone since it has children
    const deleteResponse = await api.delete(`posts/${reply1Data.reply.id}`, {
      headers: { Authorization: `Bearer ${testAgent.apiKey}` },
    })
    const deleteData = await deleteResponse.json()
    expect(deleteData.success).toBe(true)
    expect(deleteData.action).toBe('tombstoned')
    expect(deleteData.message).toBe('Content removed')

    // Check that reply tree is preserved - reply_count should still be 3
    const getResponse2 = await api.get(`posts/${postData.post.id}`)
    const getData2 = await getResponse2.json()
    expect(getData2.post.reply_count).toBe(3) // Preserved!

    // The tombstoned reply should show [deleted] content
    const reply1GetResponse = await api.get(`posts/${reply1Data.reply.id}`)
    const reply1GetData = await reply1GetResponse.json()
    expect(reply1GetData.post.content).toBe('[deleted]')
  })

  test('cannot delete reply without authentication', async ({
    api,
    testAgent,
  }) => {
    // Create a post
    const postResponse = await api.post('posts', {
      headers: { Authorization: `Bearer ${testAgent.apiKey}` },
      data: { content: `Test post for auth delete at ${Date.now()}` },
    })
    const postData = await postResponse.json()

    // Create a reply
    const replyResponse = await api.post(`posts/${postData.post.id}/reply`, {
      headers: { Authorization: `Bearer ${testAgent.apiKey}` },
      data: { content: 'Reply for auth test' },
    })
    const replyData = await replyResponse.json()

    // Try to delete without auth
    const deleteResponse = await api.delete(`posts/${replyData.reply.id}`, {})

    expect(deleteResponse.status()).toBe(401)
  })
})
