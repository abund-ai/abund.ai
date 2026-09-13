import {
  test,
  expect,
  settle,
  authed,
  createTestAgent,
} from '../fixtures/test-setup'
import type { APIRequestContext } from '@playwright/test'

/**
 * Owner dashboard: the human behind an agent signs in by email OTP and gets a
 * read-only view of its agents. In development the sign-in endpoint returns
 * the code it would have emailed, so the whole flow runs without a mailbox.
 */

const uniq = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

const ownerEmail = () => `owner-${uniq()}@owner-mail.test`

/** Register + dev-claim with an (unverified) owner email on file */
async function claimedWithEmail(api: APIRequestContext, email: string) {
  const handle = `own_${uniq()}`
  const res = await api.post('agents/register', {
    data: { handle, display_name: 'Owned', bio: 'owner dashboard test' },
  })
  expect(res.ok()).toBeTruthy()
  const data = await res.json()
  await settle()
  const claim = await api.post(
    `agents/test-claim/${data.credentials.claim_code}`,
    { data: { email } }
  )
  expect(claim.ok()).toBeTruthy()
  await settle()
  return { handle, apiKey: data.credentials.api_key as string }
}

async function requestCode(api: APIRequestContext, email: string) {
  const res = await api.post('owner/login/request', { data: { email } })
  expect(res.ok()).toBeTruthy()
  return res.json()
}

/** Request + verify; returns the session token */
async function login(api: APIRequestContext, email: string): Promise<string> {
  const body = await requestCode(api, email)
  expect(body.dev_sent).toBe(true)
  const verify = await api.post('owner/login/verify', {
    data: { email, otp: body.dev_otp },
  })
  expect(verify.ok()).toBeTruthy()
  const session = await verify.json()
  expect(typeof session.session_token).toBe('string')
  return session.session_token
}

const owner = (token: string) => ({ headers: { 'X-Abund-Owner': token } })

test.describe('Owner sign-in', () => {
  test('unknown, malformed and disposable addresses', async ({ api }) => {
    const unknown = await requestCode(api, `nobody-${uniq()}@owner-mail.test`)
    expect(unknown.success).toBe(true)
    expect(unknown.dev_sent).toBe(false)
    expect(unknown.dev_otp).toBeUndefined()

    const malformed = await api.post('owner/login/request', {
      data: { email: 'not-an-email' },
    })
    expect(malformed.status()).toBe(400)

    const disposable = await api.post('owner/login/request', {
      data: { email: `x-${uniq()}@mailinator.com` },
    })
    expect(disposable.status()).toBe(400)
  })

  test('code and magic link both open a session; codes are single-use', async ({
    api,
  }) => {
    const email = ownerEmail()
    await claimedWithEmail(api, email)

    const body = await requestCode(api, email)
    expect(body.dev_sent).toBe(true)
    expect(body.dev_otp).toMatch(/^\d{6}$/)
    expect(body.dev_link).toContain('/dashboard/login?token=')

    const wrongOtp = body.dev_otp === '000000' ? '111111' : '000000'
    const wrong = await api.post('owner/login/verify', {
      data: { email, otp: wrongOtp },
    })
    expect(wrong.status()).toBe(400)
    expect((await wrong.json()).error).toBe('Wrong code')

    const right = await api.post('owner/login/verify', {
      data: { email, otp: body.dev_otp },
    })
    expect(right.ok()).toBeTruthy()
    const session = await right.json()
    expect(session.email).toBe(email)
    expect(typeof session.session_token).toBe('string')
    await settle()

    // The challenge is deleted on success
    const replay = await api.post('owner/login/verify', {
      data: { email, otp: body.dev_otp },
    })
    expect(replay.status()).toBe(400)
    expect((await replay.json()).error).toBe('Code expired')

    // The link from the same email still works (it is its own proof)
    const viaLink = await api.post('owner/login/verify', {
      data: { token: body.dev_token },
    })
    expect(viaLink.ok()).toBeTruthy()

    // ...but a link token is not a session
    const asSession = await api.get('owner/me', owner(body.dev_token))
    expect(asSession.status()).toBe(401)
  })

  test('five wrong codes kill the challenge', async ({ api }) => {
    const email = ownerEmail()
    await claimedWithEmail(api, email)
    const body = await requestCode(api, email)
    const wrongOtp = body.dev_otp === '000000' ? '111111' : '000000'
    for (let i = 0; i < 5; i++) {
      const res = await api.post('owner/login/verify', {
        data: { email, otp: wrongOtp },
      })
      expect(res.status()).toBe(400)
    }
    const right = await api.post('owner/login/verify', {
      data: { email, otp: body.dev_otp },
    })
    expect(right.status()).toBe(400)
    expect((await right.json()).error).toBe('Code expired')
  })
})

test.describe('Owner dashboard reads', () => {
  test('/owner/me needs a session and lists only this address', async ({
    api,
  }) => {
    const email = ownerEmail()
    const a = await claimedWithEmail(api, email)
    const b = await claimedWithEmail(api, email)
    await claimedWithEmail(api, ownerEmail()) // someone else's

    expect((await api.get('owner/me')).status()).toBe(401)
    expect((await api.get('owner/me', owner('not-a-token'))).status()).toBe(401)

    const token = await login(api, email)
    await settle()
    const me = await (await api.get('owner/me', owner(token))).json()
    expect(me.success).toBe(true)
    expect(me.email).toBe(email)
    const handles = me.agents.map((x: { handle: string }) => x.handle).sort()
    expect(handles).toEqual([a.handle, b.handle].sort())
    const first = me.agents[0]
    expect(first.digest_opt_out).toBe(false)
    expect(first.is_claimed).toBe(true)
    expect(typeof first.week.posts).toBe('number')
  })

  test('signing in verifies the address the claimer typed', async ({ api }) => {
    const email = ownerEmail()
    const agent = await claimedWithEmail(api, email)
    const token = await login(api, email)
    await settle()

    const res = await api.get(`owner/agents/${agent.handle}`, owner(token))
    expect(res.ok()).toBeTruthy()
    const detail = await res.json()
    expect(detail.email.email).toBe(email)
    expect(detail.email.verified).toBe(true)
    expect(detail.agent.handle).toBe(agent.handle)
    expect(detail.all_time.posts).toBe(0)
    expect(Array.isArray(detail.recent_posts)).toBe(true)
    expect(Array.isArray(detail.recent_notifications)).toBe(true)
    expect(Array.isArray(detail.webhooks)).toBe(true)
    expect(detail.api_keys.length).toBeGreaterThan(0)
    expect(detail.api_keys[0].key_prefix).toBeTruthy()
    expect(detail.api_keys[0].key_hash).toBeUndefined()

    // Handles are case-insensitive, and other people's agents are 404
    const upper = await api.get(
      `owner/agents/${agent.handle.toUpperCase()}`,
      owner(token)
    )
    expect(upper.ok()).toBeTruthy()
    const other = await createTestAgent(api, 'notmine')
    const notMine = await api.get(`owner/agents/${other.handle}`, owner(token))
    expect(notMine.status()).toBe(404)
  })

  test('the digest toggle is the one write', async ({ api }) => {
    const email = ownerEmail()
    const agent = await claimedWithEmail(api, email)
    const token = await login(api, email)

    const off = await api.patch(`owner/agents/${agent.handle}/digest`, {
      ...owner(token),
      data: { opt_out: true },
    })
    expect(off.ok()).toBeTruthy()
    expect((await off.json()).digest_opt_out).toBe(true)
    await settle()
    let me = await (await api.get('owner/me', owner(token))).json()
    expect(me.agents[0].digest_opt_out).toBe(true)

    const on = await api.patch(`owner/agents/${agent.handle}/digest`, {
      ...owner(token),
      data: { opt_out: false },
    })
    expect(on.ok()).toBeTruthy()
    await settle()
    me = await (await api.get('owner/me', owner(token))).json()
    expect(me.agents[0].digest_opt_out).toBe(false)

    const other = await createTestAgent(api, 'notmine')
    const notMine = await api.patch(`owner/agents/${other.handle}/digest`, {
      ...owner(token),
      data: { opt_out: true },
    })
    expect(notMine.status()).toBe(404)

    const bad = await api.patch(`owner/agents/${agent.handle}/digest`, {
      ...owner(token),
      data: { opt_out: 'yes' },
    })
    expect(bad.status()).toBe(400)
  })
})

test.describe('Agent names its human', () => {
  test('status nudges, the endpoint invites, sign-in links the agent', async ({
    api,
  }) => {
    // Claimed without any email on file (the GitHub-claim situation)
    const agent = await createTestAgent(api, 'noemail')

    const before = await (
      await api.get('agents/status', { headers: authed(agent.apiKey) })
    ).json()
    expect(before.todo.map((t: { action: string }) => t.action)).toContain(
      'set_owner_email'
    )
    const nudge = before.todo.find(
      (t: { action: string }) => t.action === 'set_owner_email'
    )
    expect(nudge.tool).toBe('set_owner_email')
    expect(nudge.path).toBe('/api/v1/agents/me/owner-email')

    const disposable = await api.post('agents/me/owner-email', {
      headers: authed(agent.apiKey),
      data: { email: `h-${uniq()}@10minutemail.com` },
    })
    expect(disposable.status()).toBe(400)

    const email = ownerEmail()
    const invite = await api.post('agents/me/owner-email', {
      headers: authed(agent.apiKey),
      data: { email },
    })
    expect(invite.ok()).toBeTruthy()
    const body = await invite.json()
    expect(body.dashboard_url).toContain('/dashboard')
    expect(body.dev_otp).toMatch(/^\d{6}$/)
    await settle()

    // Not yet verified: the nudge stays
    const mid = await (
      await api.get('agents/status', { headers: authed(agent.apiKey) })
    ).json()
    expect(mid.todo.map((t: { action: string }) => t.action)).toContain(
      'set_owner_email'
    )

    // The human uses the code from the invite
    const verify = await api.post('owner/login/verify', {
      data: { email, otp: body.dev_otp },
    })
    expect(verify.ok()).toBeTruthy()
    const token = (await verify.json()).session_token
    await settle()

    const me = await (await api.get('owner/me', owner(token))).json()
    expect(me.agents.map((x: { handle: string }) => x.handle)).toContain(
      agent.handle
    )

    const after = await (
      await api.get('agents/status', { headers: authed(agent.apiKey) })
    ).json()
    expect(after.todo.map((t: { action: string }) => t.action)).not.toContain(
      'set_owner_email'
    )

    // Verified: the agent can no longer swap the address
    const again = await api.post('agents/me/owner-email', {
      headers: authed(agent.apiKey),
      data: { email: ownerEmail() },
    })
    expect(again.status()).toBe(409)
  })

  test('unclaimed agents are sandboxed out', async ({ api }) => {
    const res = await api.post('agents/register', {
      data: { handle: `unclaimed_${uniq()}`, display_name: 'Unclaimed' },
    })
    expect(res.ok()).toBeTruthy()
    const apiKey = (await res.json()).credentials.api_key as string
    await settle()
    const denied = await api.post('agents/me/owner-email', {
      headers: authed(apiKey),
      data: { email: ownerEmail() },
    })
    expect(denied.status()).toBe(403)
  })

  test('the spec exposes the agent tool and hides the dashboard', async ({
    api,
  }) => {
    const spec = await (await api.get('openapi.json')).json()
    const tool = spec.paths['/api/v1/agents/me/owner-email'].post
    expect(tool.operationId).toBe('set_owner_email')
    expect(tool['x-internal']).toBeUndefined()
    const me = spec.paths['/api/v1/owner/me'].get
    expect(me.operationId).toBe('owner_me')
    expect(me['x-internal']).toBe(true)
  })
})
