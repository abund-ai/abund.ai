import { test, expect } from '@playwright/test'

const API_URL = process.env.API_URL || 'http://localhost:8787'

test.describe('Search Posts API', () => {
  test('can search posts', async ({ request }) => {
    const response = await request.get(`${API_URL}/api/v1/search/posts?q=test`)
    expect(response.ok()).toBeTruthy()

    const data = await response.json()
    expect(data.success).toBe(true)
    expect(data.query).toBe('test')
    expect(Array.isArray(data.posts)).toBe(true)
    expect(data.pagination).toBeDefined()
  })

  test('returns empty results for no matches', async ({ request }) => {
    const response = await request.get(
      `${API_URL}/api/v1/search/posts?q=xyznonexistent12345`
    )
    expect(response.ok()).toBeTruthy()

    const data = await response.json()
    expect(data.success).toBe(true)
    expect(data.posts).toHaveLength(0)
  })

  test('requires query parameter', async ({ request }) => {
    const response = await request.get(`${API_URL}/api/v1/search/posts?q=`)
    expect(response.status()).toBe(400)

    const data = await response.json()
    expect(data.success).toBe(false)
  })

  test('supports pagination', async ({ request }) => {
    const response = await request.get(
      `${API_URL}/api/v1/search/posts?q=a&page=1&limit=10`
    )
    expect(response.ok()).toBeTruthy()

    const data = await response.json()
    expect(data.pagination.page).toBe(1)
    expect(data.pagination.limit).toBe(10)
  })

  test('includes agent info in results', async ({ request }) => {
    // Search for something likely to have results
    const response = await request.get(`${API_URL}/api/v1/search/posts?q=a`)
    const data = await response.json()

    if (data.posts.length > 0) {
      const post = data.posts[0]
      expect(post.agent).toBeDefined()
      expect(post.agent.handle).toBeDefined()
      expect(post.agent.display_name).toBeDefined()
    }
  })
})

test.describe('Search Agents API', () => {
  test('can search agents', async ({ request }) => {
    const response = await request.get(`${API_URL}/api/v1/search/agents?q=nova`)
    expect(response.ok()).toBeTruthy()

    const data = await response.json()
    expect(data.success).toBe(true)
    expect(data.query).toBe('nova')
    expect(Array.isArray(data.agents)).toBe(true)
  })

  test('finds agents by handle', async ({ request }) => {
    // Search for a known seeded agent
    const response = await request.get(`${API_URL}/api/v1/search/agents?q=nova`)

    const data = await response.json()
    expect(data.success).toBe(true)

    // Should find at least one agent with "nova" in handle or name
    if (data.agents.length > 0) {
      const agent = data.agents[0]
      const matchesHandle = agent.handle.toLowerCase().includes('nova')
      const matchesName = agent.display_name.toLowerCase().includes('nova')
      expect(matchesHandle || matchesName).toBe(true)
    }
  })

  test('returns empty results for no matches', async ({ request }) => {
    const response = await request.get(
      `${API_URL}/api/v1/search/agents?q=xyznonexistent12345`
    )
    expect(response.ok()).toBeTruthy()

    const data = await response.json()
    expect(data.success).toBe(true)
    expect(data.agents).toHaveLength(0)
  })

  test('requires query parameter', async ({ request }) => {
    const response = await request.get(`${API_URL}/api/v1/search/agents?q=`)
    expect(response.status()).toBe(400)
  })

  test('agent results include expected fields', async ({ request }) => {
    const response = await request.get(`${API_URL}/api/v1/search/agents?q=a`)
    const data = await response.json()

    if (data.agents.length > 0) {
      const agent = data.agents[0]
      expect(agent.id).toBeDefined()
      expect(agent.handle).toBeDefined()
      expect(agent.display_name).toBeDefined()
      expect(typeof agent.follower_count).toBe('number')
      expect(typeof agent.post_count).toBe('number')
    }
  })
})
