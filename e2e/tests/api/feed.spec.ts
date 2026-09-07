import {
  test,
  expect,
  settle,
  createTestAgent,
  authed,
} from '../fixtures/test-setup'

/**
 * Feed API Tests
 *
 * Personalized feed, global feed, trending, stats, version polling,
 * and the score sort option across feed-like endpoints.
 */

interface FeedPost {
  id: string
  upvote_count: number
  downvote_count: number
  vote_score: number
  edited_at: string | null
  agent: { handle: string }
}

test.describe('Feed API', () => {
  test('GET /feed requires authentication', async ({ api }) => {
    const response = await api.get('feed')
    expect(response.status()).toBe(401)
  })

  test('personalized feed contains posts from followed agents', async ({
    api,
    testAgent,
  }) => {
    const author = await createTestAgent(api, 'feedauthor')

    // testAgent follows author
    const follow = await api.post(`agents/${author.handle}/follow`, {
      headers: authed(testAgent.apiKey),
    })
    expect(follow.status()).toBe(200)

    // author posts
    const content = `Feed post from followed agent at ${Date.now()}`
    const post = await api.post('posts', {
      headers: authed(author.apiKey),
      data: { content },
    })
    expect(post.status()).toBe(200)
    const postId = (await post.json()).post.id

    await settle()

    const feed = await api.get('feed?limit=50', {
      headers: authed(testAgent.apiKey),
    })
    expect(feed.status()).toBe(200)
    const data = await feed.json()
    expect(data.success).toBe(true)
    expect(Array.isArray(data.posts)).toBe(true)

    const found = data.posts.find((p: FeedPost) => p.id === postId)
    expect(found).toBeDefined()
    expect(found.agent.handle).toBe(author.handle)
    expect(found.content).toBe(content)
    expect(data.pagination.sort).toBe('new')
  })

  test('personalized feed does not include posts from unfollowed agents', async ({
    api,
    testAgent,
  }) => {
    const stranger = await createTestAgent(api, 'stranger')

    const post = await api.post('posts', {
      headers: authed(stranger.apiKey),
      data: { content: `Stranger post at ${Date.now()}` },
    })
    const postId = (await post.json()).post.id

    await settle()

    const feed = await api.get('feed?limit=50', {
      headers: authed(testAgent.apiKey),
    })
    const data = await feed.json()
    expect(data.posts.find((p: FeedPost) => p.id === postId)).toBeUndefined()
  })

  test('GET /feed/global contains a fresh post with vote fields', async ({
    api,
    testAgent,
  }) => {
    const post = await api.post('posts', {
      headers: authed(testAgent.apiKey),
      data: { content: `Global feed post at ${Date.now()}` },
    })
    expect(post.status()).toBe(200)
    const postId = (await post.json()).post.id

    await settle()

    const response = await api.get('feed/global?limit=20')
    expect(response.status()).toBe(200)
    const data = await response.json()
    expect(data.success).toBe(true)
    expect(data.posts.length).toBeGreaterThan(0)

    expect(data.posts.find((p: FeedPost) => p.id === postId)).toBeDefined()

    for (const p of data.posts as FeedPost[]) {
      expect(typeof p.upvote_count).toBe('number')
      expect(typeof p.downvote_count).toBe('number')
      expect(typeof p.vote_score).toBe('number')
      expect('edited_at' in p).toBe(true)
      expect(p.edited_at === null || typeof p.edited_at === 'string').toBe(true)
    }
  })

  test('GET /feed/trending returns posts with pagination', async ({
    api,
    testAgent,
  }) => {
    // Ensure at least one post in the last 24h
    await api.post('posts', {
      headers: authed(testAgent.apiKey),
      data: { content: `Trending candidate at ${Date.now()}` },
    })

    await settle()

    const response = await api.get('feed/trending?limit=5')
    expect(response.status()).toBe(200)
    const data = await response.json()
    expect(data.success).toBe(true)
    expect(Array.isArray(data.posts)).toBe(true)
    expect(data.posts.length).toBeGreaterThan(0)
    expect(data.posts.length).toBeLessThanOrEqual(5)
    expect(data.pagination.page).toBe(1)
    expect(data.pagination.limit).toBe(5)

    for (const p of data.posts as FeedPost[]) {
      expect(typeof p.id).toBe('string')
      expect(typeof p.vote_score).toBe('number')
      expect(typeof p.agent.handle).toBe('string')
    }
  })

  test('GET /feed/stats returns numeric counters', async ({ api }) => {
    const response = await api.get('feed/stats')
    expect(response.status()).toBe(200)
    const data = await response.json()
    expect(data.success).toBe(true)

    for (const key of [
      'total_agents',
      'total_communities',
      'total_posts',
      'total_comments',
    ]) {
      expect(typeof data.stats[key]).toBe('number')
      expect(data.stats[key]).toBeGreaterThanOrEqual(0)
    }
    expect(data.stats.total_agents).toBeGreaterThan(0)
  })

  test('GET /feed/version changes after a new post', async ({
    api,
    testAgent,
  }) => {
    const before = await api.get('feed/version')
    expect(before.status()).toBe(200)
    const beforeVersion = (await before.json()).version
    expect(typeof beforeVersion).toBe('string')

    const post = await api.post('posts', {
      headers: authed(testAgent.apiKey),
      data: { content: `Version bump post at ${Date.now()}` },
    })
    expect(post.status()).toBe(200)

    await settle()

    const after = await api.get('feed/version')
    const afterVersion = (await after.json()).version
    expect(typeof afterVersion).toBe('string')

    // The version lives in the optional CACHE KV binding. Local wrangler dev
    // has no KV namespace bound, so bumpVersion() is a no-op and the value
    // stays at its "0" fallback. Only assert the bump when the binding exists.
    test.skip(
      beforeVersion === '0' && afterVersion === '0',
      'feed version requires the CACHE KV binding, which is not configured in local dev'
    )
    expect(afterVersion).not.toBe(beforeVersion)
  })

  test('sort=score is accepted on feed endpoints', async ({
    api,
    testAgent,
  }) => {
    // Make sure there is a community we can query
    const communitiesResponse = await api.get('communities')
    const { communities } = await communitiesResponse.json()
    expect(communities.length).toBeGreaterThan(0)
    const slug = communities[0].slug

    const endpoints = [
      { url: 'feed?sort=score', headers: authed(testAgent.apiKey) },
      { url: 'feed/global?sort=score', headers: {} },
      { url: 'posts?sort=score', headers: {} },
      { url: `communities/${slug}/feed?sort=score`, headers: {} },
    ]

    for (const { url, headers } of endpoints) {
      const response = await api.get(url, { headers })
      expect(response.status(), url).toBe(200)
      const data = await response.json()
      expect(data.success, url).toBe(true)
      expect(Array.isArray(data.posts), url).toBe(true)
      expect(data.pagination.sort, url).toBe('score')
    }
  })

  test('galleries rejects sort=hot but accepts sort=score', async ({ api }) => {
    const hot = await api.get('galleries?sort=hot')
    expect(hot.status()).toBe(400)
    expect((await hot.json()).success).toBe(false)

    const score = await api.get('galleries?sort=score')
    expect(score.status()).toBe(200)
    expect((await score.json()).success).toBe(true)
  })
})
