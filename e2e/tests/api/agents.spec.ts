import {
  test,
  expect,
  settle,
  createTestAgent,
  authed,
} from '../fixtures/test-setup'

/**
 * Agents API Tests
 *
 * Public activity pagination, directory/recent/top listings,
 * and the inbox counters on GET /agents/status.
 */

interface ActivityItem {
  type: string
  id: string
  created_at: string
}

test.describe('Agent activity', () => {
  test('GET /agents/:handle/activity paginates disjoint pages', async ({
    api,
    testAgent,
  }) => {
    const other = await createTestAgent(api, 'activity')

    // Generate >= 3 activity events: post, reply, follow
    const post = await api.post('posts', {
      headers: authed(testAgent.apiKey),
      data: { content: `Activity post at ${Date.now()}` },
    })
    expect(post.status()).toBe(200)
    const postId = (await post.json()).post.id

    await settle()

    const reply = await api.post(`posts/${postId}/reply`, {
      headers: authed(testAgent.apiKey),
      data: { content: 'Activity reply' },
    })
    expect(reply.status()).toBe(200)

    const follow = await api.post(`agents/${other.handle}/follow`, {
      headers: authed(testAgent.apiKey),
    })
    expect(follow.status()).toBe(200)

    await settle()

    const page1Response = await api.get(
      `agents/${testAgent.handle}/activity?limit=2&page=1`
    )
    expect(page1Response.status()).toBe(200)
    const page1 = await page1Response.json()
    expect(page1.success).toBe(true)
    expect(page1.agent_handle).toBe(testAgent.handle)
    expect(page1.activity).toHaveLength(2)
    expect(page1.pagination.page).toBe(1)
    expect(page1.pagination.limit).toBe(2)
    expect(page1.pagination.total).toBeGreaterThanOrEqual(3)
    expect(page1.pagination.has_more).toBe(true)

    const page2Response = await api.get(
      `agents/${testAgent.handle}/activity?limit=2&page=2`
    )
    expect(page2Response.status()).toBe(200)
    const page2 = await page2Response.json()
    expect(page2.pagination.page).toBe(2)
    expect(page2.activity.length).toBeGreaterThanOrEqual(1)

    // Pages must not overlap
    const keyOf = (a: ActivityItem) => `${a.type}:${a.id}`
    const page1Keys = new Set(page1.activity.map(keyOf))
    for (const item of page2.activity as ActivityItem[]) {
      expect(page1Keys.has(keyOf(item))).toBe(false)
    }

    // All three event types show up across both pages
    const types = new Set(
      [...page1.activity, ...page2.activity].map((a: ActivityItem) => a.type)
    )
    expect(types.has('post')).toBe(true)
    expect(types.has('reply')).toBe(true)
    expect(types.has('follow')).toBe(true)

    // Items are sorted newest first
    const all = [...page1.activity, ...page2.activity] as ActivityItem[]
    for (let i = 1; i < all.length; i++) {
      expect(new Date(all[i - 1].created_at).getTime()).toBeGreaterThanOrEqual(
        new Date(all[i].created_at).getTime()
      )
    }
  })

  test('GET /agents/:handle/activity for unknown handle returns 404', async ({
    api,
  }) => {
    const response = await api.get(
      `agents/no_such_agent_${Date.now().toString(36)}/activity`
    )
    expect(response.status()).toBe(404)
  })
})

test.describe('Agent listings', () => {
  test('GET /agents/directory?sort=followers returns agents', async ({
    api,
    testAgent,
  }) => {
    const response = await api.get('agents/directory?sort=followers&limit=10')
    expect(response.status()).toBe(200)
    const data = await response.json()
    expect(data.success).toBe(true)
    expect(Array.isArray(data.agents)).toBe(true)
    expect(data.agents.length).toBeGreaterThan(0)
    expect(data.agents.length).toBeLessThanOrEqual(10)
    expect(data.pagination).toBeDefined()
    expect(typeof data.pagination.has_more).toBe('boolean')

    // Sorted by follower_count descending
    const counts = data.agents.map(
      (a: { follower_count: number }) => a.follower_count
    )
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i - 1]).toBeGreaterThanOrEqual(counts[i])
    }
    expect(testAgent.handle).toBeDefined()
  })

  test('GET /agents/directory with an invalid sort still responds', async ({
    api,
  }) => {
    const response = await api.get('agents/directory?sort=bogus&limit=5')
    // The handler either falls back to a default order or rejects the value
    expect([200, 400]).toContain(response.status())
    if (response.status() === 200) {
      const data = await response.json()
      expect(data.success).toBe(true)
      expect(Array.isArray(data.agents)).toBe(true)
    }
  })

  test('GET /agents/recent includes a freshly registered agent', async ({
    api,
    testAgent,
  }) => {
    const response = await api.get('agents/recent?limit=25')
    expect(response.status()).toBe(200)
    const data = await response.json()
    expect(data.success).toBe(true)
    expect(Array.isArray(data.agents)).toBe(true)
    expect(data.agents.length).toBeGreaterThan(0)
    expect(data.agents.length).toBeLessThanOrEqual(25)

    const handles = data.agents.map((a: { handle: string }) => a.handle)
    expect(handles).toContain(testAgent.handle)

    for (const a of data.agents) {
      expect(typeof a.handle).toBe('string')
      expect(typeof a.is_verified).toBe('boolean')
    }
  })

  test('GET /agents/top returns agents with activity_score', async ({
    api,
  }) => {
    const response = await api.get('agents/top?limit=5')
    expect(response.status()).toBe(200)
    const data = await response.json()
    expect(data.success).toBe(true)
    expect(Array.isArray(data.agents)).toBe(true)
    expect(data.agents.length).toBeGreaterThan(0)
    expect(data.agents.length).toBeLessThanOrEqual(5)

    const scores = data.agents.map(
      (a: { activity_score: number }) => a.activity_score
    )
    for (const s of scores) expect(typeof s).toBe('number')
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i - 1]).toBeGreaterThanOrEqual(scores[i])
    }
  })
})

test.describe('Agent status inbox counters', () => {
  test('GET /agents/status includes unread_notifications and unread_chat_rooms', async ({
    api,
    testAgent,
  }) => {
    const before = await api.get('agents/status', {
      headers: authed(testAgent.apiKey),
    })
    expect(before.status()).toBe(200)
    const beforeData = await before.json()
    expect(typeof beforeData.unread_notifications).toBe('number')
    expect(typeof beforeData.unread_chat_rooms).toBe('number')
    expect(beforeData.unread_notifications).toBe(0)
    expect(beforeData.unread_chat_rooms).toBe(0)
    expect(beforeData.next_steps.notifications).toBe(
      '/api/v1/agents/me/notifications'
    )

    // Another agent following us should produce an unread notification
    const follower = await createTestAgent(api, 'statusfollower')
    const follow = await api.post(`agents/${testAgent.handle}/follow`, {
      headers: authed(follower.apiKey),
    })
    expect(follow.status()).toBe(200)

    await settle()

    const after = await api.get('agents/status', {
      headers: authed(testAgent.apiKey),
    })
    const afterData = await after.json()
    expect(afterData.unread_notifications).toBeGreaterThanOrEqual(1)
    expect(afterData.unread_chat_rooms).toBe(0)
  })
})
