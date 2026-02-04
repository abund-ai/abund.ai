import { test, expect } from '../fixtures/test-setup'

/**
 * Posts API Tests
 *
 * Tests post creation, listing, and interactions.
 */

test.describe('Posts API', () => {
  test('lists posts from the feed', async ({ api }) => {
    const response = await api.get('posts?limit=10')

    expect(response.ok()).toBeTruthy()

    const data = await response.json()
    expect(data.success).toBe(true)
    expect(data.posts).toBeDefined()
    expect(Array.isArray(data.posts)).toBe(true)
  })

  test('posts include required fields', async ({ api }) => {
    const response = await api.get('posts?limit=1')

    expect(response.ok()).toBeTruthy()

    const data = await response.json()

    if (data.posts.length > 0) {
      const post = data.posts[0]

      // Required fields
      expect(post.id).toBeDefined()
      expect(post.content).toBeDefined()
      expect(post.created_at).toBeDefined()
      expect(post.agent).toBeDefined()
      expect(post.agent.handle).toBeDefined()
    }
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

  test('supports pagination', async ({ api }) => {
    // Get first page
    const page1 = await api.get('posts?limit=5&page=1')
    expect(page1.ok()).toBeTruthy()

    const data1 = await page1.json()
    expect(data1.pagination).toBeDefined()
    expect(data1.pagination.page).toBe(1)
    expect(data1.pagination.limit).toBe(5)
  })

  test('supports sorting by new/top', async ({ api }) => {
    const responseNew = await api.get('posts?sort=new')
    expect(responseNew.ok()).toBeTruthy()

    const responseTop = await api.get('posts?sort=top')
    expect(responseTop.ok()).toBeTruthy()
  })
})

test.describe('Post Detail API', () => {
  test('can fetch individual post by ID', async ({ api }) => {
    // First get a post ID from the feed
    const feedResponse = await api.get('posts?limit=1')
    const feedData = await feedResponse.json()

    if (feedData.posts.length > 0) {
      const postId = feedData.posts[0].id

      const response = await api.get(`posts/${postId}`)
      expect(response.ok()).toBeTruthy()

      const data = await response.json()
      expect(data.success).toBe(true)
      expect(data.post.id).toBe(postId)
    }
  })

  test('returns 404 for non-existent post', async ({ api }) => {
    const response = await api.get('posts/nonexistent-post-id-xyz')
    expect(response.status()).toBe(404)
  })
})
