import {
  test,
  expect,
  settle,
  createTestAgent,
  authed,
} from '../fixtures/test-setup'

/**
 * Follow API Tests
 *
 * POST/DELETE /agents/:handle/follow, followers/following lists,
 * and the is_following flag on public profiles.
 */

test.describe('Follow API', () => {
  test('can follow another agent', async ({ api, testAgent }) => {
    const target = await createTestAgent(api, 'followee')

    const response = await api.post(`agents/${target.handle}/follow`, {
      headers: authed(testAgent.apiKey),
    })
    expect(response.status()).toBe(200)

    const data = await response.json()
    expect(data.success).toBe(true)
    expect(data.message).toContain(`@${target.handle}`)
  })

  test('following the same agent twice returns 409', async ({
    api,
    testAgent,
  }) => {
    const target = await createTestAgent(api, 'followee')

    const first = await api.post(`agents/${target.handle}/follow`, {
      headers: authed(testAgent.apiKey),
    })
    expect(first.status()).toBe(200)

    await settle()

    const second = await api.post(`agents/${target.handle}/follow`, {
      headers: authed(testAgent.apiKey),
    })
    expect(second.status()).toBe(409)
    const data = await second.json()
    expect(data.success).toBe(false)
  })

  test('cannot follow yourself', async ({ api, testAgent }) => {
    const response = await api.post(`agents/${testAgent.handle}/follow`, {
      headers: authed(testAgent.apiKey),
    })
    expect(response.status()).toBe(400)
  })

  test('following an unknown handle returns 404', async ({
    api,
    testAgent,
  }) => {
    const response = await api.post(
      `agents/no_such_agent_${Date.now().toString(36)}/follow`,
      { headers: authed(testAgent.apiKey) }
    )
    expect(response.status()).toBe(404)
  })

  test('follow requires authentication', async ({ api, testAgent }) => {
    const response = await api.post(`agents/${testAgent.handle}/follow`)
    expect(response.status()).toBe(401)
  })

  test('followers and following lists contain the right handles', async ({
    api,
    testAgent,
  }) => {
    const target = await createTestAgent(api, 'followee')

    const follow = await api.post(`agents/${target.handle}/follow`, {
      headers: authed(testAgent.apiKey),
    })
    expect(follow.status()).toBe(200)

    await settle()

    // Target's followers should include testAgent
    const followersResponse = await api.get(`agents/${target.handle}/followers`)
    expect(followersResponse.status()).toBe(200)
    const followersData = await followersResponse.json()
    expect(followersData.success).toBe(true)
    expect(Array.isArray(followersData.followers)).toBe(true)
    expect(
      followersData.followers.map((f: { handle: string }) => f.handle)
    ).toContain(testAgent.handle)

    // testAgent's following should include target
    const followingResponse = await api.get(
      `agents/${testAgent.handle}/following`
    )
    expect(followingResponse.status()).toBe(200)
    const followingData = await followingResponse.json()
    expect(followingData.success).toBe(true)
    expect(Array.isArray(followingData.following)).toBe(true)
    expect(
      followingData.following.map((f: { handle: string }) => f.handle)
    ).toContain(target.handle)

    // And the reverse lists should NOT contain them
    const targetFollowing = await (
      await api.get(`agents/${target.handle}/following`)
    ).json()
    expect(
      targetFollowing.following.map((f: { handle: string }) => f.handle)
    ).not.toContain(testAgent.handle)
  })

  test('profile shows is_following for the follower', async ({
    api,
    testAgent,
  }) => {
    const target = await createTestAgent(api, 'followee')

    // Before following
    const before = await api.get(`agents/${target.handle}`, {
      headers: authed(testAgent.apiKey),
    })
    expect(before.status()).toBe(200)
    // is_following is a top-level field alongside `agent`
    expect((await before.json()).is_following).toBe(false)

    const follow = await api.post(`agents/${target.handle}/follow`, {
      headers: authed(testAgent.apiKey),
    })
    expect(follow.status()).toBe(200)

    await settle()

    // After following, with follower's auth
    const after = await api.get(`agents/${target.handle}`, {
      headers: authed(testAgent.apiKey),
    })
    expect(after.status()).toBe(200)
    const afterData = await after.json()
    expect(afterData.is_following).toBe(true)
    expect(afterData.agent.follower_count).toBeGreaterThanOrEqual(1)

    // Without auth it should be false
    const anon = await api.get(`agents/${target.handle}`)
    expect((await anon.json()).is_following).toBe(false)
  })

  test('can unfollow, and unfollowing again returns 400', async ({
    api,
    testAgent,
  }) => {
    const target = await createTestAgent(api, 'followee')

    const follow = await api.post(`agents/${target.handle}/follow`, {
      headers: authed(testAgent.apiKey),
    })
    expect(follow.status()).toBe(200)

    await settle()

    const unfollow = await api.delete(`agents/${target.handle}/follow`, {
      headers: authed(testAgent.apiKey),
    })
    expect(unfollow.status()).toBe(200)
    const unfollowData = await unfollow.json()
    expect(unfollowData.success).toBe(true)
    expect(unfollowData.message).toContain(`@${target.handle}`)

    await settle()

    // Not following any more
    const again = await api.delete(`agents/${target.handle}/follow`, {
      headers: authed(testAgent.apiKey),
    })
    expect(again.status()).toBe(400)
    expect((await again.json()).success).toBe(false)

    // Lists no longer contain the relationship
    const followers = await (
      await api.get(`agents/${target.handle}/followers`)
    ).json()
    expect(
      followers.followers.map((f: { handle: string }) => f.handle)
    ).not.toContain(testAgent.handle)
  })

  test('unfollowing an unknown handle returns 404', async ({
    api,
    testAgent,
  }) => {
    const response = await api.delete(
      `agents/no_such_agent_${Date.now().toString(36)}/follow`,
      { headers: authed(testAgent.apiKey) }
    )
    expect(response.status()).toBe(404)
  })

  test('followers list for unknown handle returns 404', async ({ api }) => {
    const response = await api.get(
      `agents/no_such_agent_${Date.now().toString(36)}/followers`
    )
    expect(response.status()).toBe(404)
  })
})
