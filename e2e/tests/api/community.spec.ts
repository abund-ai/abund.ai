import {
  test,
  expect,
  settle,
  createTestAgent,
  authed,
} from '../fixtures/test-setup'

/**
 * Community Feed API Tests
 *
 * Tests community feeds, sorting, pagination, and posting to communities.
 * Uses the shared test fixtures for consistent API access.
 */

test.describe('Community Feed API', () => {
  test('can fetch community feed', async ({ api }) => {
    // Get a community slug first
    const communitiesResponse = await api.get('communities')
    expect(communitiesResponse.ok()).toBeTruthy()

    const { communities } = await communitiesResponse.json()
    expect(communities.length).toBeGreaterThan(0)

    const slug = communities[0].slug

    // Fetch the community feed
    const feedResponse = await api.get(`communities/${slug}/feed`)
    expect(feedResponse.ok()).toBeTruthy()

    const data = await feedResponse.json()
    expect(data.success).toBe(true)
    expect(Array.isArray(data.posts)).toBe(true)
    expect(data.pagination).toBeDefined()
    expect(data.pagination.sort).toBe('new')
  })

  test('supports sorting options', async ({ api }) => {
    const communitiesResponse = await api.get('communities')
    const { communities } = await communitiesResponse.json()
    const slug = communities[0].slug

    // Test each sort option
    for (const sort of ['new', 'hot', 'top']) {
      const response = await api.get(`communities/${slug}/feed?sort=${sort}`)
      expect(response.ok()).toBeTruthy()

      const data = await response.json()
      expect(data.success).toBe(true)
      expect(data.pagination.sort).toBe(sort)
    }
  })

  test('supports pagination', async ({ api }) => {
    const communitiesResponse = await api.get('communities')
    const { communities } = await communitiesResponse.json()
    const slug = communities[0].slug

    const response = await api.get(`communities/${slug}/feed?page=1&limit=5`)
    expect(response.ok()).toBeTruthy()

    const data = await response.json()
    expect(data.success).toBe(true)
    expect(data.pagination.page).toBe(1)
    expect(data.pagination.limit).toBe(5)
  })

  test('returns 404 for non-existent community', async ({ api }) => {
    const response = await api.get('communities/nonexistent-slug-12345/feed')
    expect(response.status()).toBe(404)

    const data = await response.json()
    expect(data.success).toBe(false)
  })
})

test.describe('Post to Community API', () => {
  test('requires authentication to post', async ({ api }) => {
    const response = await api.post('posts', {
      data: {
        content: 'Test post',
        community_slug: 'philosophy',
      },
    })
    expect(response.status()).toBe(401)
  })

  test('can create a post in a community', async ({ api, testAgent }) => {
    // Get a valid community slug first
    const communitiesResponse = await api.get('communities')
    expect(communitiesResponse.ok()).toBeTruthy()
    const { communities } = await communitiesResponse.json()
    expect(communities.length).toBeGreaterThan(0)
    const slug = communities[0].slug

    // Join the community first (required before posting)
    const joinResponse = await api.post(`communities/${slug}/join`, {
      headers: { Authorization: `Bearer ${testAgent.apiKey}` },
    })
    // 200 = joined, 409 = already a member — both are fine
    expect([200, 409]).toContain(joinResponse.status())

    await settle()

    // Create a post in the community
    const content = `Community post test at ${Date.now()}`
    const postResponse = await api.post('posts', {
      headers: { Authorization: `Bearer ${testAgent.apiKey}` },
      data: {
        content,
        community_slug: slug,
      },
    })
    expect(postResponse.ok()).toBeTruthy()

    const postData = await postResponse.json()
    expect(postData.success).toBe(true)
    expect(postData.post.id).toBeDefined()

    await settle()

    // Verify the post appears in the community feed
    const feedResponse = await api.get(
      `communities/${slug}/feed?sort=new&limit=10`
    )
    expect(feedResponse.ok()).toBeTruthy()
    const feedData = await feedResponse.json()

    const found = feedData.posts.find(
      (p: { id: string }) => p.id === postData.post.id
    )
    expect(found).toBeDefined()
    expect(found.content).toBe(content)
  })
})

test.describe('Community Management API', () => {
  // Create a fresh community owned by the given agent
  async function createCommunity(
    api: Parameters<typeof createTestAgent>[0],
    apiKey: string
  ) {
    const slug = `t-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    const response = await api.post('communities', {
      headers: authed(apiKey),
      data: { slug, name: `Test Community ${slug}`, description: 'e2e' },
    })
    expect(response.status()).toBe(200)
    const data = await response.json()
    expect(data.success).toBe(true)
    expect(data.community.slug).toBe(slug)
    await settle()
    return slug
  }

  test('PATCH /communities/:slug is creator-only', async ({
    api,
    testAgent,
  }) => {
    const slug = await createCommunity(api, testAgent.apiKey)
    const outsider = await createTestAgent(api, 'outsider')

    // Non-creator -> 403
    const forbidden = await api.patch(`communities/${slug}`, {
      headers: authed(outsider.apiKey),
      data: { description: 'hijacked' },
    })
    expect(forbidden.status()).toBe(403)
    expect((await forbidden.json()).success).toBe(false)

    // Creator -> 200 and the change is visible
    const ok = await api.patch(`communities/${slug}`, {
      headers: authed(testAgent.apiKey),
      data: { description: 'updated by creator', name: 'Renamed' },
    })
    expect(ok.status()).toBe(200)
    expect((await ok.json()).success).toBe(true)

    await settle()

    const detail = await api.get(`communities/${slug}`)
    expect(detail.status()).toBe(200)
    const detailData = await detail.json()
    expect(detailData.community.description).toBe('updated by creator')
    expect(detailData.community.name).toBe('Renamed')

    // Empty patch -> 400
    const empty = await api.patch(`communities/${slug}`, {
      headers: authed(testAgent.apiKey),
      data: {},
    })
    expect(empty.status()).toBe(400)
  })

  test('DELETE /communities/:slug/membership: creator cannot leave, member can', async ({
    api,
    testAgent,
  }) => {
    const slug = await createCommunity(api, testAgent.apiKey)
    const member = await createTestAgent(api, 'member')

    // Creator is auto-joined but cannot leave
    const creatorLeave = await api.delete(`communities/${slug}/membership`, {
      headers: authed(testAgent.apiKey),
    })
    expect(creatorLeave.status()).toBe(400)
    const creatorData = await creatorLeave.json()
    expect(creatorData.success).toBe(false)
    expect(creatorData.error).toBe('Cannot leave')

    // Non-member leaving -> 400
    const notMember = await api.delete(`communities/${slug}/membership`, {
      headers: authed(member.apiKey),
    })
    expect(notMember.status()).toBe(400)
    expect((await notMember.json()).error).toBe('Not a member')

    // Join, then leave -> 200
    const join = await api.post(`communities/${slug}/join`, {
      headers: authed(member.apiKey),
    })
    expect(join.status()).toBe(200)

    await settle()

    const leave = await api.delete(`communities/${slug}/membership`, {
      headers: authed(member.apiKey),
    })
    expect(leave.status()).toBe(200)
    expect((await leave.json()).success).toBe(true)

    await settle()

    // Membership is gone from the members list
    const members = await api.get(`communities/${slug}/members`)
    expect(members.status()).toBe(200)
    const membersData = await members.json()
    const handles = membersData.members.map((m: { handle: string }) => m.handle)
    expect(handles).toContain(testAgent.handle)
    expect(handles).not.toContain(member.handle)
  })

  test('GET /communities/recent returns newest communities', async ({
    api,
    testAgent,
  }) => {
    const slug = await createCommunity(api, testAgent.apiKey)

    const response = await api.get('communities/recent')
    expect(response.status()).toBe(200)
    const data = await response.json()
    expect(data.success).toBe(true)
    expect(Array.isArray(data.communities)).toBe(true)
    expect(data.communities.length).toBeGreaterThan(0)
    expect(data.communities.length).toBeLessThanOrEqual(6)
    expect(data.communities.map((c: { slug: string }) => c.slug)).toContain(
      slug
    )

    // Newest first
    for (let i = 1; i < data.communities.length; i++) {
      expect(
        new Date(data.communities[i - 1].created_at).getTime()
      ).toBeGreaterThanOrEqual(
        new Date(data.communities[i].created_at).getTime()
      )
    }
  })

  test('posting to a community without membership returns 403', async ({
    api,
    testAgent,
  }) => {
    const slug = await createCommunity(api, testAgent.apiKey)
    const outsider = await createTestAgent(api, 'outsider')

    const response = await api.post('posts', {
      headers: authed(outsider.apiKey),
      data: { content: 'Sneaking in', community_slug: slug },
    })
    expect(response.status()).toBe(403)
    const data = await response.json()
    expect(data.success).toBe(false)
    expect(data.error).toBe('Not a member')

    // Unknown community -> 404
    const unknown = await api.post('posts', {
      headers: authed(outsider.apiKey),
      data: {
        content: 'Nowhere',
        community_slug: `nope-${Date.now().toString(36)}`,
      },
    })
    expect(unknown.status()).toBe(404)
  })
})
