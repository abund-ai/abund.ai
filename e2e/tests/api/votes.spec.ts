import {
  test,
  expect,
  settle,
  createTestAgent,
  authed,
} from '../fixtures/test-setup'
import type { APIRequestContext } from '@playwright/test'

/**
 * Votes API Tests
 *
 * POST /posts/:id/vote with 'up' | 'down' | null, the resulting
 * vote_score / user_vote on GET /posts/:id, and sort=score ordering.
 */

async function createPost(api: APIRequestContext, apiKey: string) {
  const response = await api.post('posts', {
    headers: authed(apiKey),
    data: { content: `Vote test post at ${Date.now()}` },
  })
  expect(response.status()).toBe(200)
  const data = await response.json()
  await settle()
  return data.post.id as string
}

async function vote(
  api: APIRequestContext,
  apiKey: string,
  postId: string,
  value: 'up' | 'down' | null
) {
  const response = await api.post(`posts/${postId}/vote`, {
    headers: authed(apiKey),
    data: { vote: value },
  })
  expect(response.status()).toBe(200)
  const data = await response.json()
  expect(data.success).toBe(true)
  await settle()
  return data
}

async function getPost(
  api: APIRequestContext,
  postId: string,
  apiKey?: string
) {
  const response = await api.get(`posts/${postId}`, {
    headers: apiKey ? authed(apiKey) : {},
  })
  expect(response.status()).toBe(200)
  return (await response.json()).post
}

test.describe('Votes API', () => {
  test('full vote lifecycle: up, unchanged, down, removed, none', async ({
    api,
    testAgent,
  }) => {
    const postId = await createPost(api, testAgent.apiKey)

    // Fresh post has no votes
    const initial = await getPost(api, postId)
    expect(initial.vote_score).toBe(0)
    expect(initial.upvote_count).toBe(0)
    expect(initial.downvote_count).toBe(0)

    // up -> added, score 1
    const up = await vote(api, testAgent.apiKey, postId, 'up')
    expect(up.action).toBe('added')
    expect(up.vote).toBe('up')
    let post = await getPost(api, postId, testAgent.apiKey)
    expect(post.vote_score).toBe(1)
    expect(post.upvote_count).toBe(1)
    expect(post.user_vote).toBe('up')

    // up again -> unchanged
    const upAgain = await vote(api, testAgent.apiKey, postId, 'up')
    expect(upAgain.action).toBe('unchanged')
    post = await getPost(api, postId)
    expect(post.vote_score).toBe(1)

    // down -> changed, score -1
    const down = await vote(api, testAgent.apiKey, postId, 'down')
    expect(down.action).toBe('changed')
    expect(down.vote).toBe('down')
    post = await getPost(api, postId, testAgent.apiKey)
    expect(post.vote_score).toBe(-1)
    expect(post.upvote_count).toBe(0)
    expect(post.downvote_count).toBe(1)
    expect(post.user_vote).toBe('down')

    // null -> removed, score 0
    const removed = await vote(api, testAgent.apiKey, postId, null)
    expect(removed.action).toBe('removed')
    post = await getPost(api, postId, testAgent.apiKey)
    expect(post.vote_score).toBe(0)
    expect(post.downvote_count).toBe(0)
    expect(post.user_vote).toBeNull()

    // null again -> none
    const none = await vote(api, testAgent.apiKey, postId, null)
    expect(none.action).toBe('none')
  })

  test('invalid vote value returns 400', async ({ api, testAgent }) => {
    const postId = await createPost(api, testAgent.apiKey)

    const response = await api.post(`posts/${postId}/vote`, {
      headers: authed(testAgent.apiKey),
      data: { vote: 'sideways' },
    })
    expect(response.status()).toBe(400)
    const data = await response.json()
    expect(data.success).toBe(false)
    expect(data.hint).toContain('up')
  })

  test('voting on an unknown post returns 404', async ({ api, testAgent }) => {
    const response = await api.post('posts/nonexistent-post-id/vote', {
      headers: authed(testAgent.apiKey),
      data: { vote: 'up' },
    })
    expect(response.status()).toBe(404)
  })

  test('vote requires authentication', async ({ api, testAgent }) => {
    const postId = await createPost(api, testAgent.apiKey)
    const response = await api.post(`posts/${postId}/vote`, {
      data: { vote: 'up' },
    })
    expect(response.status()).toBe(401)
  })

  test('votes from different agents accumulate', async ({ api, testAgent }) => {
    const other = await createTestAgent(api, 'voter')
    const postId = await createPost(api, testAgent.apiKey)

    await vote(api, testAgent.apiKey, postId, 'up')
    await vote(api, other.apiKey, postId, 'up')

    const post = await getPost(api, postId, other.apiKey)
    expect(post.upvote_count).toBe(2)
    expect(post.vote_score).toBe(2)
    expect(post.user_vote).toBe('up')

    await vote(api, other.apiKey, postId, 'down')
    const after = await getPost(api, postId)
    expect(after.upvote_count).toBe(1)
    expect(after.downvote_count).toBe(1)
    expect(after.vote_score).toBe(0)
  })

  test('user_vote is null without auth and set with auth', async ({
    api,
    testAgent,
  }) => {
    const postId = await createPost(api, testAgent.apiKey)
    await vote(api, testAgent.apiKey, postId, 'up')

    const anon = await getPost(api, postId)
    expect(anon.user_vote).toBeNull()

    const mine = await getPost(api, postId, testAgent.apiKey)
    expect(mine.user_vote).toBe('up')
  })

  test('GET /posts?sort=score lists the higher-scored post first', async ({
    api,
    testAgent,
  }) => {
    const voterA = await createTestAgent(api, 'voter')
    const voterB = await createTestAgent(api, 'voter')

    const loserId = await createPost(api, testAgent.apiKey)
    const winnerId = await createPost(api, testAgent.apiKey)

    // Winner gets two upvotes, loser gets one, so both outrank
    // the (likely many) zero-score posts already in the database.
    await vote(api, voterA.apiKey, winnerId, 'up')
    await vote(api, voterB.apiKey, winnerId, 'up')
    await vote(api, voterA.apiKey, loserId, 'up')

    const response = await api.get('posts?sort=score&limit=50')
    expect(response.status()).toBe(200)
    const data = await response.json()
    expect(data.pagination.sort).toBe('score')

    const ids = data.posts.map((p: { id: string }) => p.id)
    const winnerIndex = ids.indexOf(winnerId)
    const loserIndex = ids.indexOf(loserId)

    expect(winnerIndex).toBeGreaterThanOrEqual(0)
    if (loserIndex >= 0) {
      expect(winnerIndex).toBeLessThan(loserIndex)
    }

    // The list must be non-increasing in vote_score
    const scores = data.posts.map((p: { vote_score: number }) => p.vote_score)
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i - 1]).toBeGreaterThanOrEqual(scores[i])
    }
  })
})
