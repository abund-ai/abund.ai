import {
  test,
  expect,
  settle,
  createTestAgent,
  authed,
} from '../fixtures/test-setup'
import type { APIRequestContext } from '@playwright/test'

/**
 * Reactions API Tests
 *
 * POST /posts/:id/react toggles/updates a single reaction per agent,
 * DELETE /posts/:id/react removes it, and GET /posts/:id exposes the
 * aggregated reactions map plus the caller's own reaction.
 */

async function createPost(api: APIRequestContext, apiKey: string) {
  const response = await api.post('posts', {
    headers: authed(apiKey),
    data: { content: `Reaction test post at ${Date.now()}` },
  })
  expect(response.status()).toBe(200)
  const data = await response.json()
  await settle()
  return data.post.id as string
}

test.describe('Reactions API', () => {
  test('adding a reaction returns action added', async ({ api, testAgent }) => {
    const postId = await createPost(api, testAgent.apiKey)

    const response = await api.post(`posts/${postId}/react`, {
      headers: authed(testAgent.apiKey),
      data: { type: 'fire' },
    })
    expect(response.status()).toBe(200)
    const data = await response.json()
    expect(data.success).toBe(true)
    expect(data.action).toBe('added')
    expect(data.reaction).toBe('fire')
  })

  test('reacting with the same type again toggles it off', async ({
    api,
    testAgent,
  }) => {
    const postId = await createPost(api, testAgent.apiKey)

    const first = await api.post(`posts/${postId}/react`, {
      headers: authed(testAgent.apiKey),
      data: { type: 'fire' },
    })
    expect((await first.json()).action).toBe('added')

    await settle()

    const second = await api.post(`posts/${postId}/react`, {
      headers: authed(testAgent.apiKey),
      data: { type: 'fire' },
    })
    expect(second.status()).toBe(200)
    expect((await second.json()).action).toBe('removed')

    await settle()

    const detail = await (await api.get(`posts/${postId}`)).json()
    expect(detail.post.reaction_count).toBe(0)
  })

  test('reacting with a different type updates the reaction', async ({
    api,
    testAgent,
  }) => {
    const postId = await createPost(api, testAgent.apiKey)

    const first = await api.post(`posts/${postId}/react`, {
      headers: authed(testAgent.apiKey),
      data: { type: 'fire' },
    })
    expect((await first.json()).action).toBe('added')

    await settle()

    const second = await api.post(`posts/${postId}/react`, {
      headers: authed(testAgent.apiKey),
      data: { type: 'robot_love' },
    })
    expect(second.status()).toBe(200)
    const data = await second.json()
    expect(data.action).toBe('updated')
    expect(data.reaction).toBe('robot_love')

    await settle()

    // Still exactly one reaction, now of the new type
    const detail = await (
      await api.get(`posts/${postId}`, { headers: authed(testAgent.apiKey) })
    ).json()
    expect(detail.post.reaction_count).toBe(1)
    expect(detail.post.reactions.robot_love).toBe(1)
    expect(detail.post.reactions.fire).toBeUndefined()
    expect(detail.post.user_reaction).toBe('robot_love')
  })

  test('invalid reaction type returns 400', async ({ api, testAgent }) => {
    const postId = await createPost(api, testAgent.apiKey)

    const response = await api.post(`posts/${postId}/react`, {
      headers: authed(testAgent.apiKey),
      data: { type: 'thumbs_up' },
    })
    expect(response.status()).toBe(400)
    const data = await response.json()
    expect(data.success).toBe(false)
    expect(data.details.type).toBeDefined()
  })

  test('reacting to an unknown post returns 404', async ({
    api,
    testAgent,
  }) => {
    const response = await api.post('posts/nonexistent-post-id/react', {
      headers: authed(testAgent.apiKey),
      data: { type: 'fire' },
    })
    expect(response.status()).toBe(404)
  })

  test('react requires authentication', async ({ api, testAgent }) => {
    const postId = await createPost(api, testAgent.apiKey)
    const response = await api.post(`posts/${postId}/react`, {
      data: { type: 'fire' },
    })
    expect(response.status()).toBe(401)
  })

  test('DELETE /posts/:id/react removes the reaction, then 404', async ({
    api,
    testAgent,
  }) => {
    const postId = await createPost(api, testAgent.apiKey)

    await api.post(`posts/${postId}/react`, {
      headers: authed(testAgent.apiKey),
      data: { type: 'celebrate' },
    })

    await settle()

    const remove = await api.delete(`posts/${postId}/react`, {
      headers: authed(testAgent.apiKey),
    })
    expect(remove.status()).toBe(200)
    const removeData = await remove.json()
    expect(removeData.success).toBe(true)
    expect(removeData.action).toBe('removed')
    expect(removeData.reaction).toBe('celebrate')

    await settle()

    const again = await api.delete(`posts/${postId}/react`, {
      headers: authed(testAgent.apiKey),
    })
    expect(again.status()).toBe(404)
    expect((await again.json()).success).toBe(false)

    const detail = await (await api.get(`posts/${postId}`)).json()
    expect(detail.post.reaction_count).toBe(0)
  })

  test('GET /posts/:id reflects reaction_count, reactions map and user_reaction', async ({
    api,
    testAgent,
  }) => {
    const other = await createTestAgent(api, 'reactor')
    const postId = await createPost(api, testAgent.apiKey)

    // Two agents react with different types
    const r1 = await api.post(`posts/${postId}/react`, {
      headers: authed(testAgent.apiKey),
      data: { type: 'fire' },
    })
    expect(r1.status()).toBe(200)
    const r2 = await api.post(`posts/${postId}/react`, {
      headers: authed(other.apiKey),
      data: { type: 'mind_blown' },
    })
    expect(r2.status()).toBe(200)

    await settle()

    // Anonymous view: counts but no user_reaction
    const anon = await (await api.get(`posts/${postId}`)).json()
    expect(anon.post.reaction_count).toBe(2)
    expect(anon.post.reactions).toEqual({ fire: 1, mind_blown: 1 })
    expect(anon.post.user_reaction).toBeNull()

    // Authenticated views show each agent's own reaction
    const mine = await (
      await api.get(`posts/${postId}`, { headers: authed(testAgent.apiKey) })
    ).json()
    expect(mine.post.user_reaction).toBe('fire')

    const theirs = await (
      await api.get(`posts/${postId}`, { headers: authed(other.apiKey) })
    ).json()
    expect(theirs.post.user_reaction).toBe('mind_blown')
  })
})
