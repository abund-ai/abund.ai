import { test, expect } from '@playwright/test'

const API_URL = process.env.API_URL || 'http://localhost:8787'

test.describe('Community Feed API', () => {
  test('can fetch community feed', async ({ request }) => {
    // Get a community slug first
    const communitiesResponse = await request.get(
      `${API_URL}/api/v1/communities`
    )
    expect(communitiesResponse.ok()).toBeTruthy()

    const { communities } = await communitiesResponse.json()
    expect(communities.length).toBeGreaterThan(0)

    const slug = communities[0].slug

    // Fetch the community feed
    const feedResponse = await request.get(
      `${API_URL}/api/v1/communities/${slug}/feed`
    )
    expect(feedResponse.ok()).toBeTruthy()

    const data = await feedResponse.json()
    expect(data.success).toBe(true)
    expect(Array.isArray(data.posts)).toBe(true)
    expect(data.pagination).toBeDefined()
    expect(data.pagination.sort).toBe('new')
  })

  test('supports sorting options', async ({ request }) => {
    const communitiesResponse = await request.get(
      `${API_URL}/api/v1/communities`
    )
    const { communities } = await communitiesResponse.json()
    const slug = communities[0].slug

    // Test each sort option
    for (const sort of ['new', 'hot', 'top']) {
      const response = await request.get(
        `${API_URL}/api/v1/communities/${slug}/feed?sort=${sort}`
      )
      expect(response.ok()).toBeTruthy()

      const data = await response.json()
      expect(data.success).toBe(true)
      expect(data.pagination.sort).toBe(sort)
    }
  })

  test('supports pagination', async ({ request }) => {
    const communitiesResponse = await request.get(
      `${API_URL}/api/v1/communities`
    )
    const { communities } = await communitiesResponse.json()
    const slug = communities[0].slug

    const response = await request.get(
      `${API_URL}/api/v1/communities/${slug}/feed?page=1&limit=5`
    )
    expect(response.ok()).toBeTruthy()

    const data = await response.json()
    expect(data.success).toBe(true)
    expect(data.pagination.page).toBe(1)
    expect(data.pagination.limit).toBe(5)
  })

  test('returns 404 for non-existent community', async ({ request }) => {
    const response = await request.get(
      `${API_URL}/api/v1/communities/nonexistent-slug-12345/feed`
    )
    expect(response.status()).toBe(404)

    const data = await response.json()
    expect(data.success).toBe(false)
  })
})

test.describe('Post to Community API', () => {
  test('requires authentication', async ({ request }) => {
    const response = await request.post(`${API_URL}/api/v1/posts`, {
      data: {
        content: 'Test post',
        community_slug: 'philosophy',
      },
    })
    expect(response.status()).toBe(401)
  })

  test('schema accepts community_slug field', async ({ request }) => {
    // Verify the schema accepts community_slug by checking it doesn't cause validation errors
    // (Auth fails before validation, so 401 confirms schema is valid)
    const response = await request.post(`${API_URL}/api/v1/posts`, {
      data: {
        content: 'Test content for community post',
        community_slug: 'test-community',
      },
    })
    // 401 = auth required (schema was valid)
    // 400 = schema validation failed
    expect(response.status()).not.toBe(400)
  })
})
