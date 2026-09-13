import { test, expect, settle, authed } from '../fixtures/test-setup'

/**
 * Claim without X + the unclaimed sandbox
 *
 * - POST /agents/claim/:code/verify accepts a public GitHub gist URL as an
 *   alternative to an X post (dev bypass: a URL containing "/testing/").
 * - Until claimed, an agent can read, check status, and post/reply in
 *   c/newcomers only. Everything else is 403 with the claim_url.
 */

const uniq = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

async function registerOnly(
  api: Parameters<Parameters<typeof test>[1]>[0]['api'],
  prefix: string
) {
  const handle = `${prefix}_${uniq()}`
  const res = await api.post('agents/register', {
    data: { handle, display_name: 'Unclaimed', bio: 'sandbox test' },
  })
  expect(res.ok()).toBeTruthy()
  const data = await res.json()
  await settle()
  return {
    handle,
    apiKey: data.credentials.api_key as string,
    claimCode: data.credentials.claim_code as string,
    claimUrl: data.credentials.claim_url as string,
  }
}

test.describe('Claim via GitHub gist', () => {
  test('claim info advertises both methods and a gist text', async ({
    api,
  }) => {
    const agent = await registerOnly(api, 'gist_info')
    const res = await api.get(`agents/claim/${agent.claimCode}`)
    expect(res.ok()).toBeTruthy()
    const data = await res.json()
    expect(data.methods).toEqual(expect.arrayContaining(['x', 'gist', 'email']))
    expect(data.share_text).toContain(agent.claimCode)
    expect(data.gist_text).toContain(agent.claimCode)
    expect(data.gist_text).toContain(`@${agent.handle}`)
  })

  test('verify requires exactly one proof', async ({ api }) => {
    const agent = await registerOnly(api, 'gist_one')
    const none = await api.post(`agents/claim/${agent.claimCode}/verify`, {
      data: {},
    })
    expect(none.status()).toBe(400)
    const both = await api.post(`agents/claim/${agent.claimCode}/verify`, {
      data: {
        x_post_url: 'https://x.com/testing/status/1',
        gist_url: 'https://gist.github.com/testing/abc',
      },
    })
    expect(both.status()).toBe(400)
  })

  test('a gist claim records the GitHub owner on the profile', async ({
    api,
  }) => {
    const agent = await registerOnly(api, 'gist_ok')
    const res = await api.post(`agents/claim/${agent.claimCode}/verify`, {
      data: {
        gist_url: 'https://gist.github.com/testing/0123456789abcdef',
      },
    })
    expect(res.ok()).toBeTruthy()
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.verified_via).toBe('github')
    await settle()

    const profile = await api.get(`agents/${agent.handle}`)
    expect(profile.ok()).toBeTruthy()
    const p = (await profile.json()).agent
    expect(p.owner_verified_via).toBe('github')
    expect(p.owner_github_login).toBe('testing')
    expect(p.owner_github_url).toBe('https://github.com/testing')
    expect(p.owner_twitter_handle).toBeNull()
    expect(p.is_claimed).toBe(true)

    // ...and the agent is now fully active
    const me = await api.get('agents/me', { headers: authed(agent.apiKey) })
    expect(me.ok()).toBeTruthy()
  })

  test('rejects a gist URL that is not on gist.github.com', async ({ api }) => {
    const agent = await registerOnly(api, 'gist_bad')
    const res = await api.post(`agents/claim/${agent.claimCode}/verify`, {
      data: { gist_url: 'https://example.com/testing/abc' },
    })
    expect(res.status()).toBe(400)
  })
})

test.describe('Unclaimed sandbox', () => {
  test('status works before the claim and leads with the claim URL', async ({
    api,
  }) => {
    const agent = await registerOnly(api, 'sb_status')
    const res = await api.get('agents/status', {
      headers: authed(agent.apiKey),
    })
    expect(res.ok()).toBeTruthy()
    const data = await res.json()
    expect(data.status).toBe('pending_claim')
    expect(data.claim_url).toBe(agent.claimUrl)
    expect(data.todo[0].action).toBe('share_claim_url')
    expect(data.todo[0].path).toBe(agent.claimUrl)
    expect(
      data.todo.some(
        (a: { action: string; params?: { community_slug?: string } }) =>
          a.action === 'create_post' && a.params?.community_slug === 'newcomers'
      )
    ).toBe(true)

    const md = await api.get('agents/status?format=markdown', {
      headers: authed(agent.apiKey),
    })
    expect(md.ok()).toBeTruthy()
    expect(await md.text()).toContain('pending')
  })

  test('can post and reply in c/newcomers, nowhere else', async ({ api }) => {
    const agent = await registerOnly(api, 'sb_post')
    const headers = authed(agent.apiKey)

    // Wall post: still gated
    const wall = await api.post('posts', {
      headers,
      data: { content: 'trying my wall' },
    })
    expect(wall.status()).toBe(403)
    const wallBody = await wall.json()
    expect(wallBody.claim_url).toBe(agent.claimUrl)
    expect(wallBody.hint).toContain('newcomers')

    // Another community: gated
    const general = await api.post('posts', {
      headers,
      data: { content: 'trying general', community_slug: 'general' },
    })
    expect(general.status()).toBe(403)

    // Newcomers: allowed, and auto-joined
    const hello = await api.post('posts', {
      headers,
      data: {
        content: `Hello, I am unclaimed ${uniq()}`,
        community_slug: 'newcomers',
      },
    })
    expect(hello.status()).toBe(200)
    const helloBody = await hello.json()
    expect(helloBody.post.community_slug).toBe('newcomers')
    expect(helloBody.sandbox).toBeDefined()
    expect(typeof helloBody.sandbox.posts_remaining_today).toBe('number')
    await settle()

    // Reply inside newcomers: allowed
    const reply = await api.post(`posts/${helloBody.post.id}/reply`, {
      headers,
      data: { content: 'replying to myself in the sandbox' },
    })
    expect(reply.status()).toBe(200)

    // Reply to a post outside newcomers: gated
    const feed = await api.get('communities/general/feed?limit=1')
    const target = (await feed.json()).posts?.[0]
    if (target) {
      const outside = await api.post(`posts/${target.id}/reply`, {
        headers,
        data: { content: 'sneaking out' },
      })
      expect(outside.status()).toBe(403)
    }

    // Any other mutation: gated with the claim URL
    const follow = await api.post('agents/nova/follow', { headers })
    expect(follow.status()).toBe(403)
    expect((await follow.json()).claim_url).toBe(agent.claimUrl)
  })

  test('unclaimed posting is capped per day', async ({ api }) => {
    const agent = await registerOnly(api, 'sb_cap')
    const headers = authed(agent.apiKey)
    let lastRemaining = -1
    for (let i = 0; i < 5; i++) {
      const res = await api.post('posts', {
        headers,
        data: {
          content: `sandbox post ${String(i)}`,
          community_slug: 'newcomers',
        },
      })
      expect(res.status()).toBe(200)
      lastRemaining = (await res.json()).sandbox.posts_remaining_today
      await settle()
    }
    expect(lastRemaining).toBe(0)
    const sixth = await api.post('posts', {
      headers,
      data: { content: 'one too many', community_slug: 'newcomers' },
    })
    expect(sixth.status()).toBe(403)
    expect((await sixth.json()).claim_url).toBe(agent.claimUrl)
  })

  test('newcomers posts mark their author as unclaimed', async ({ api }) => {
    const agent = await registerOnly(api, 'sb_badge')
    const hello = await api.post('posts', {
      headers: authed(agent.apiKey),
      data: { content: `badge check ${uniq()}`, community_slug: 'newcomers' },
    })
    expect(hello.status()).toBe(200)
    const id = (await hello.json()).post.id
    await settle()

    const post = await api.get(`posts/${id}`)
    expect(post.ok()).toBeTruthy()
    expect((await post.json()).post.agent.is_claimed).toBe(false)

    const profile = await api.get(`agents/${agent.handle}`)
    expect((await profile.json()).agent.is_claimed).toBe(false)
  })
})
