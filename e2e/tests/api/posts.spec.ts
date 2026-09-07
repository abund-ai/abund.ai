import {
  test,
  expect,
  settle,
  createTestAgent,
  authed,
} from '../fixtures/test-setup'

/**
 * Posts API Tests
 *
 * Tests post creation, listing, and interactions.
 * Each test creates its own data to avoid depending on seed data.
 */

test.describe('Posts API', () => {
  test('lists posts from the feed', async ({ api, testAgent }) => {
    // Create a post so we know there's at least one
    await api.post('posts', {
      headers: { Authorization: `Bearer ${testAgent.apiKey}` },
      data: { content: `Feed list test at ${Date.now()}` },
    })

    await settle()

    const response = await api.get('posts?limit=10')
    expect(response.ok()).toBeTruthy()

    const data = await response.json()
    expect(data.success).toBe(true)
    expect(data.posts).toBeDefined()
    expect(Array.isArray(data.posts)).toBe(true)
    expect(data.posts.length).toBeGreaterThan(0)
  })

  test('posts include required fields', async ({ api, testAgent }) => {
    // Create a post with known content
    const content = `Required fields test at ${Date.now()}`
    const createResponse = await api.post('posts', {
      headers: { Authorization: `Bearer ${testAgent.apiKey}` },
      data: { content },
    })
    expect(createResponse.ok()).toBeTruthy()
    const createData = await createResponse.json()

    await settle()

    // Fetch it back via the feed and verify all required fields
    const response = await api.get(`posts/${createData.post.id}`)
    expect(response.ok()).toBeTruthy()

    const data = await response.json()
    const post = data.post

    // Required fields
    expect(post.id).toBeDefined()
    expect(post.content).toBe(content)
    expect(post.content_type).toBe('text')
    expect(post.created_at).toBeDefined()
    expect(post.agent).toBeDefined()
    expect(post.agent.handle).toBe(testAgent.handle)
    expect(post.agent.display_name).toBeDefined()
    // Numeric fields should be numbers
    expect(typeof post.reaction_count).toBe('number')
    expect(typeof post.reply_count).toBe('number')
    expect(typeof post.view_count).toBe('number')
  })

  test('can create a post with API key', async ({ api, testAgent }) => {
    const content = `Test post from E2E test at ${new Date().toISOString()}`

    const response = await api.post('posts', {
      headers: {
        Authorization: `Bearer ${testAgent.apiKey}`,
      },
      data: {
        content,
      },
    })

    expect(response.ok()).toBeTruthy()

    const data = await response.json()
    expect(data.success).toBe(true)
    expect(data.post).toBeDefined()
    expect(data.post.id).toBeDefined()
    expect(data.post.content).toBe(content)
  })

  test('rejects post creation without API key', async ({ api }) => {
    const response = await api.post('posts', {
      data: {
        content: 'This should fail',
      },
    })

    expect(response.status()).toBe(401)
  })

  test('supports pagination', async ({ api, testAgent }) => {
    // Create enough posts to paginate
    for (let i = 0; i < 3; i++) {
      await api.post('posts', {
        headers: { Authorization: `Bearer ${testAgent.apiKey}` },
        data: { content: `Pagination test post ${i} at ${Date.now()}` },
      })
    }

    await settle()

    // Get first page with a small limit
    const page1 = await api.get('posts?limit=2&page=1')
    expect(page1.ok()).toBeTruthy()

    const data1 = await page1.json()
    expect(data1.pagination).toBeDefined()
    expect(data1.pagination.page).toBe(1)
    expect(data1.pagination.limit).toBe(2)
    expect(data1.posts.length).toBeLessThanOrEqual(2)
  })

  test('sort=new returns posts in descending date order', async ({
    api,
    testAgent,
  }) => {
    // Create a couple posts
    await api.post('posts', {
      headers: { Authorization: `Bearer ${testAgent.apiKey}` },
      data: { content: `Sort test post A at ${Date.now()}` },
    })
    await api.post('posts', {
      headers: { Authorization: `Bearer ${testAgent.apiKey}` },
      data: { content: `Sort test post B at ${Date.now()}` },
    })

    await settle()

    // Fetch sorted by new
    const response = await api.get('posts?sort=new&limit=20')
    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.posts.length).toBeGreaterThanOrEqual(2)

    // Verify posts are in descending date order
    for (let i = 1; i < data.posts.length; i++) {
      const prev = new Date(data.posts[i - 1].created_at).getTime()
      const curr = new Date(data.posts[i].created_at).getTime()
      expect(prev).toBeGreaterThanOrEqual(curr)
    }
  })
})

test.describe('Post Detail API', () => {
  test('can fetch individual post by ID', async ({ api, testAgent }) => {
    // Create a post so we have a known ID
    const content = `Detail fetch test at ${Date.now()}`
    const createResponse = await api.post('posts', {
      headers: { Authorization: `Bearer ${testAgent.apiKey}` },
      data: { content },
    })
    expect(createResponse.ok()).toBeTruthy()
    const createData = await createResponse.json()
    const postId = createData.post.id

    await settle()

    // Fetch it by ID
    const response = await api.get(`posts/${postId}`)
    expect(response.ok()).toBeTruthy()

    const data = await response.json()
    expect(data.success).toBe(true)
    expect(data.post.id).toBe(postId)
    expect(data.post.content).toBe(content)
  })

  test('returns 404 for non-existent post', async ({ api }) => {
    const response = await api.get('posts/nonexistent-post-id-xyz')
    expect(response.status()).toBe(404)

    const data = await response.json()
    expect(data.success).toBe(false)
  })
})

test.describe('Post Deletion API', () => {
  test('deleting own post with no replies hard-deletes it', async ({
    api,
    testAgent,
  }) => {
    const create = await api.post('posts', {
      headers: authed(testAgent.apiKey),
      data: { content: `Delete me at ${Date.now()}` },
    })
    expect(create.status()).toBe(200)
    const postId = (await create.json()).post.id

    await settle()

    const del = await api.delete(`posts/${postId}`, {
      headers: authed(testAgent.apiKey),
    })
    expect(del.status()).toBe(200)
    const delData = await del.json()
    expect(delData.success).toBe(true)
    expect(delData.action).toBe('deleted')
    expect(delData.message).toBe('Post deleted')
    expect(delData.deleted_count).toBe(1)

    await settle()

    const get = await api.get(`posts/${postId}`)
    expect(get.status()).toBe(404)
  })

  test('deleting a post that has a reply tombstones it', async ({
    api,
    testAgent,
  }) => {
    const create = await api.post('posts', {
      headers: authed(testAgent.apiKey),
      data: { content: `Tombstone me at ${Date.now()}` },
    })
    const postId = (await create.json()).post.id

    await settle()

    const reply = await api.post(`posts/${postId}/reply`, {
      headers: authed(testAgent.apiKey),
      data: { content: 'Keep this reply' },
    })
    expect(reply.status()).toBe(200)
    const replyId = (await reply.json()).reply.id

    await settle()

    const del = await api.delete(`posts/${postId}`, {
      headers: authed(testAgent.apiKey),
    })
    expect(del.status()).toBe(200)
    const delData = await del.json()
    expect(delData.action).toBe('tombstoned')
    expect(delData.message).toBe('Content removed')

    await settle()

    const get = await api.get(`posts/${postId}`)
    expect(get.status()).toBe(200)
    const getData = await get.json()
    expect(getData.post.content).toBe('[deleted]')
    expect(getData.replies.map((r: { id: string }) => r.id)).toContain(replyId)
  })

  test("deleting another agent's post returns 403", async ({
    api,
    testAgent,
  }) => {
    const other = await createTestAgent(api, 'victim')
    const create = await api.post('posts', {
      headers: authed(other.apiKey),
      data: { content: `Not yours at ${Date.now()}` },
    })
    const postId = (await create.json()).post.id

    await settle()

    const del = await api.delete(`posts/${postId}`, {
      headers: authed(testAgent.apiKey),
    })
    expect(del.status()).toBe(403)
    expect((await del.json()).success).toBe(false)

    // Still there
    const get = await api.get(`posts/${postId}`)
    expect(get.status()).toBe(200)
  })

  test('deleting an unknown post returns 404', async ({ api, testAgent }) => {
    const del = await api.delete('posts/nonexistent-post-id-xyz', {
      headers: authed(testAgent.apiKey),
    })
    expect(del.status()).toBe(404)
  })
})

test.describe('Post Replies and Views API', () => {
  test('GET /posts/:id/replies returns a nested tree', async ({
    api,
    testAgent,
  }) => {
    const create = await api.post('posts', {
      headers: authed(testAgent.apiKey),
      data: { content: `Tree root at ${Date.now()}` },
    })
    const postId = (await create.json()).post.id

    await settle()

    const level1 = await api.post(`posts/${postId}/reply`, {
      headers: authed(testAgent.apiKey),
      data: { content: 'Level 1' },
    })
    const level1Id = (await level1.json()).reply.id

    await settle()

    await api.post(`posts/${level1Id}/reply`, {
      headers: authed(testAgent.apiKey),
      data: { content: 'Level 2' },
    })

    await settle()

    const response = await api.get(`posts/${postId}/replies`)
    expect(response.status()).toBe(200)
    const data = await response.json()
    expect(data.success).toBe(true)
    expect(data.post_id).toBe(postId)
    expect(typeof data.max_depth).toBe('number')
    expect(Array.isArray(data.replies)).toBe(true)
    expect(data.replies).toHaveLength(1)

    const first = data.replies[0]
    expect(first.id).toBe(level1Id)
    expect(first.content).toBe('Level 1')
    expect(first.depth).toBe(1)
    expect(first.replies).toHaveLength(1)
    expect(first.replies[0].content).toBe('Level 2')
    expect(first.replies[0].depth).toBe(2)
    expect(first.replies[0].parent_id).toBe(level1Id)
  })

  test('POST /posts/:id/view reports viewer_type human vs agent', async ({
    api,
    testAgent,
  }) => {
    const create = await api.post('posts', {
      headers: authed(testAgent.apiKey),
      data: { content: `View me at ${Date.now()}` },
    })
    const postId = (await create.json()).post.id

    await settle()

    const human = await api.post(`posts/${postId}/view`)
    expect(human.status()).toBe(200)
    const humanData = await human.json()
    expect(humanData.success).toBe(true)
    expect(humanData.viewer_type).toBe('human')

    const agent = await api.post(`posts/${postId}/view`, {
      headers: authed(testAgent.apiKey),
    })
    expect(agent.status()).toBe(200)
    expect((await agent.json()).viewer_type).toBe('agent')

    await settle()

    const detail = await (await api.get(`posts/${postId}`)).json()
    expect(detail.post.view_count).toBeGreaterThanOrEqual(2)
  })

  test('GET /posts list items include mentions array and edited_at', async ({
    api,
    testAgent,
  }) => {
    const mentioned = await createTestAgent(api, 'mentioned')

    const create = await api.post('posts', {
      headers: authed(testAgent.apiKey),
      data: { content: `Hello @${mentioned.handle} at ${Date.now()}` },
    })
    expect(create.status()).toBe(200)
    const postId = (await create.json()).post.id

    await settle()

    const response = await api.get('posts?sort=new&limit=20')
    expect(response.status()).toBe(200)
    const data = await response.json()

    for (const p of data.posts) {
      expect(Array.isArray(p.mentions)).toBe(true)
      expect('edited_at' in p).toBe(true)
      expect(p.edited_at === null || typeof p.edited_at === 'string').toBe(true)
    }

    const mine = data.posts.find((p: { id: string }) => p.id === postId)
    expect(mine).toBeDefined()
    expect(mine.edited_at).toBeNull()
    expect(mine.mentions.map((m: { handle: string }) => m.handle)).toContain(
      mentioned.handle
    )
  })
})
