import { test, expect, settle, authed } from '../fixtures/test-setup'

/**
 * Claiming with an email magic link and with GitHub sign-in.
 *
 * In development the magic-link endpoint returns the link it would have
 * emailed, and the GitHub flow short-circuits through the callback with a
 * test code, so both can run end to end without external services.
 */

const uniq = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

type Api = Parameters<Parameters<typeof test>[1]>[0]['api']

async function registerOnly(api: Api, prefix: string) {
  const handle = `${prefix}_${uniq()}`
  const res = await api.post('agents/register', {
    data: { handle, display_name: 'Claim me', bio: 'testing claim methods' },
  })
  expect(res.ok()).toBeTruthy()
  const data = await res.json()
  await settle()
  return {
    handle,
    apiKey: data.credentials.api_key as string,
    claimCode: data.credentials.claim_code as string,
  }
}

test.describe('Claim by email', () => {
  test('claim info lists the methods', async ({ api }) => {
    const agent = await registerOnly(api, 'cm_info')
    const info = await (await api.get(`agents/claim/${agent.claimCode}`)).json()
    expect(info.methods).toEqual(expect.arrayContaining(['x', 'gist', 'email']))
  })

  test('magic link claims the agent and records a verified owner email', async ({
    api,
  }) => {
    const agent = await registerOnly(api, 'cm_email')
    const email = `owner-${uniq()}@example.com`

    const request = await api.post(`agents/claim/${agent.claimCode}/email`, {
      data: { email },
    })
    expect(request.ok()).toBeTruthy()
    const body = await request.json()
    expect(body.success).toBe(true)
    // Development only: the link that would have been emailed
    expect(typeof body.dev_token).toBe('string')
    expect(body.dev_link).toContain(`/claim/${agent.claimCode}?email_token=`)

    // A token for another code must not work
    const other = await registerOnly(api, 'cm_email2')
    const wrong = await api.post(`agents/claim/${other.claimCode}/verify`, {
      data: { email_token: body.dev_token },
    })
    expect(wrong.status()).toBe(400)

    const verify = await api.post(`agents/claim/${agent.claimCode}/verify`, {
      data: { email_token: body.dev_token },
    })
    expect(verify.ok()).toBeTruthy()
    expect((await verify.json()).verified_via).toBe('email')
    await settle()

    const profile = (await (await api.get(`agents/${agent.handle}`)).json())
      .agent
    expect(profile.is_claimed).toBe(true)
    expect(profile.owner_verified_via).toBe('email')
    expect(profile.owner_twitter_handle).toBeNull()
    expect(profile.owner_github_login).toBeNull()
    expect(profile.email).toBeUndefined()

    const me = await api.get('agents/me', { headers: authed(agent.apiKey) })
    expect(me.ok()).toBeTruthy()

    // Already claimed: the link is single-use in effect
    const again = await api.post(`agents/claim/${agent.claimCode}/verify`, {
      data: { email_token: body.dev_token },
    })
    expect(again.status()).toBe(409)
  })

  test('garbage tokens and bad emails are rejected', async ({ api }) => {
    const agent = await registerOnly(api, 'cm_bad')
    const bad = await api.post(`agents/claim/${agent.claimCode}/email`, {
      data: { email: 'not-an-email' },
    })
    expect(bad.status()).toBe(400)
    const forged = await api.post(`agents/claim/${agent.claimCode}/verify`, {
      data: { email_token: 'abc.def' },
    })
    expect(forged.status()).toBe(400)
  })
})

test.describe('Claim with GitHub sign-in', () => {
  test('start redirects into the OAuth flow and the callback claims the agent', async ({
    api,
  }) => {
    const agent = await registerOnly(api, 'cm_gh')

    // In development without a client id the start endpoint loops straight
    // to the callback with a test code.
    const start = await api.get(
      `agents/claim/${agent.claimCode}/github/start`,
      {
        maxRedirects: 0,
      }
    )
    expect(start.status()).toBe(302)
    const callbackUrl = start.headers()['location']
    expect(callbackUrl).toContain('/agents/claim/github/callback?')
    expect(callbackUrl).toContain('state=')

    const callback = await api.get(callbackUrl, { maxRedirects: 0 })
    expect(callback.status()).toBe(302)
    expect(callback.headers()['location']).toContain(
      `/claim/${agent.claimCode}?claimed=github`
    )
    await settle()

    const profile = (await (await api.get(`agents/${agent.handle}`)).json())
      .agent
    expect(profile.is_claimed).toBe(true)
    expect(profile.owner_verified_via).toBe('github')
    expect(profile.owner_github_login).toBe('testing')

    // The claim page re-fetches claim info after the redirect: the 409 must
    // carry enough to render the success card
    const info = await api.get(`agents/claim/${agent.claimCode}`)
    expect(info.status()).toBe(409)
    expect((await info.json()).agent.handle).toBe(agent.handle)

    // A replayed callback lands on the error page instead of re-claiming
    const replay = await api.get(callbackUrl, { maxRedirects: 0 })
    expect(replay.status()).toBe(302)
    expect(replay.headers()['location']).toContain('error=')
  })

  test('a forged state is rejected', async ({ api }) => {
    const bad = await api.get(
      'agents/claim/github/callback?code=testing&state=nope.nope',
      {
        maxRedirects: 0,
      }
    )
    expect(bad.status()).toBe(302)
    expect(bad.headers()['location']).toContain('error=')
  })
})
