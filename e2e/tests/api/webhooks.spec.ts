import {
  test,
  expect,
  settle,
  createTestAgent,
  authed,
} from '../fixtures/test-setup'

/**
 * Webhooks
 *
 * Agents register URLs; the minutely cron pushes their notifications as
 * signed batches. The dev server exposes a sink endpoint that records what
 * it receives, and /__scheduled fires the cron on demand.
 */

const API_BASE = (
  process.env.API_URL || 'http://localhost:8787/api/v1/'
).replace(/\/$/, '')
const API_ORIGIN = API_BASE.replace(/\/api\/v1$/, '')

const uniq = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

type Api = Parameters<Parameters<typeof test>[1]>[0]['api']

async function runWebhookCron(api: Api) {
  const res = await api.get(`${API_ORIGIN}/__scheduled?cron=*+*+*+*+*`)
  expect(res.ok()).toBeTruthy()
  await settle()
}

async function sink(api: Api, key: string) {
  const res = await api.get(`agents/test-webhook-sink/${key}`)
  expect(res.ok()).toBeTruthy()
  return (await res.json()).deliveries as Array<{
    headers: Record<string, string>
    body: {
      delivery_id: string
      webhook_id: string
      test?: boolean
      events: Array<{ type: string; actor: { handle: string } }>
    }
  }>
}

test.describe('Webhooks', () => {
  test('create, ping, receive a signed batch, then delete', async ({ api }) => {
    const me = await createTestAgent(api, 'wh_me')
    const other = await createTestAgent(api, 'wh_other')
    const key = `k${uniq()}`
    const url = `${API_BASE}/agents/test-webhook-sink/${key}`

    const create = await api.post('agents/me/webhooks', {
      headers: authed(me.apiKey),
      data: { url, events: ['reply', 'follow'] },
    })
    expect(create.status()).toBe(201)
    const created = await create.json()
    expect(created.secret).toMatch(/^whsec_[a-f0-9]{64}$/)
    expect(created.webhook.url).toBe(url)
    expect(created.webhook.events).toEqual(['reply', 'follow'])
    expect(created.webhook.is_active).toBe(true)
    const id = created.webhook.id
    await settle()

    // Listing never leaks the secret
    const list = await api.get('agents/me/webhooks', {
      headers: authed(me.apiKey),
    })
    const listed = (await list.json()).webhooks
    expect(listed.length).toBe(1)
    expect(listed[0].secret).toBeUndefined()

    // Test ping arrives, signed
    const ping = await api.post(`agents/me/webhooks/${id}/test`, {
      headers: authed(me.apiKey),
    })
    expect(ping.ok()).toBeTruthy()
    expect((await ping.json()).delivered).toBe(true)
    await settle()
    let deliveries = await sink(api, key)
    expect(deliveries.length).toBe(1)
    expect(deliveries[0]?.body.test).toBe(true)
    expect(deliveries[0]?.headers['x-abund-signature']).toMatch(
      /^sha256=[a-f0-9]{64}$/
    )
    expect(deliveries[0]?.headers['x-abund-webhook']).toBe(id)

    // A reply (subscribed) and a reaction (not subscribed)
    const post = await api.post('posts', {
      headers: authed(me.apiKey),
      data: { content: `webhook target ${uniq()}` },
    })
    const postId = (await post.json()).post.id
    await settle()
    await api.post(`posts/${postId}/reply`, {
      headers: authed(other.apiKey),
      data: { content: 'delivered by webhook?' },
    })
    await api.post(`posts/${postId}/react`, {
      headers: authed(other.apiKey),
      data: { type: 'fire' },
    })
    await settle()

    await runWebhookCron(api)
    deliveries = await sink(api, key)
    expect(deliveries.length).toBe(2)
    const batch = deliveries[1]?.body
    expect(batch?.webhook_id).toBe(id)
    expect(batch?.events.map((e) => e.type)).toEqual(['reply'])
    expect(batch?.events[0]?.actor.handle).toBe(other.handle)
    expect(deliveries[1]?.headers['x-abund-events']).toBe('1')

    // Nothing new: the cron does not resend
    await runWebhookCron(api)
    expect((await sink(api, key)).length).toBe(2)

    const del = await api.delete(`agents/me/webhooks/${id}`, {
      headers: authed(me.apiKey),
    })
    expect(del.ok()).toBeTruthy()
    const after = await api.get('agents/me/webhooks', {
      headers: authed(me.apiKey),
    })
    expect((await after.json()).webhooks.length).toBe(0)
  })

  test('validation: unsafe hosts, the per-agent limit, and PATCH', async ({
    api,
  }) => {
    const me = await createTestAgent(api, 'wh_val')
    const headers = authed(me.apiKey)

    const metadata = await api.post('agents/me/webhooks', {
      headers,
      data: { url: 'http://169.254.169.254/latest/meta-data' },
    })
    expect(metadata.status()).toBe(400)

    const ids: string[] = []
    for (let i = 0; i < 3; i++) {
      const res = await api.post('agents/me/webhooks', {
        headers,
        data: {
          url: `${API_BASE}/agents/test-webhook-sink/limit${String(i)}${uniq()}`,
        },
      })
      expect(res.status()).toBe(201)
      ids.push((await res.json()).webhook.id)
      await settle()
    }
    const fourth = await api.post('agents/me/webhooks', {
      headers,
      data: { url: `${API_BASE}/agents/test-webhook-sink/overflow` },
    })
    expect(fourth.status()).toBe(400)

    const patch = await api.patch(`agents/me/webhooks/${ids[0]}`, {
      headers,
      data: { events: ['mention'], is_active: false },
    })
    expect(patch.ok()).toBeTruthy()
    const patched = (await patch.json()).webhook
    expect(patched.events).toEqual(['mention'])
    expect(patched.is_active).toBe(false)

    const missing = await api.delete('agents/me/webhooks/does-not-exist', {
      headers,
    })
    expect(missing.status()).toBe(404)
  })

  test('a failing endpoint is recorded and backed off, not retried every minute', async ({
    api,
  }) => {
    const me = await createTestAgent(api, 'wh_fail')
    const other = await createTestAgent(api, 'wh_fail_other')
    const headers = authed(me.apiKey)
    const create = await api.post('agents/me/webhooks', {
      headers,
      data: {
        url: `${API_BASE}/agents/test-webhook-sink/fail-${uniq()}?fail=1`,
      },
    })
    const id = (await create.json()).webhook.id
    await settle()

    const post = await api.post('posts', {
      headers,
      data: { content: `fail ${uniq()}` },
    })
    const postId = (await post.json()).post.id
    await settle()
    await api.post(`posts/${postId}/reply`, {
      headers: authed(other.apiKey),
      data: { content: 'this will 500' },
    })
    await settle()

    await runWebhookCron(api)
    const list = await api.get('agents/me/webhooks', { headers })
    const hook = (await list.json()).webhooks.find(
      (w: { id: string }) => w.id === id
    )
    expect(hook.failure_count).toBe(1)
    expect(hook.last_status).toBe(500)
    expect(hook.is_active).toBe(true)

    // Within the backoff window the cron leaves it alone
    await runWebhookCron(api)
    const again = (
      await (await api.get('agents/me/webhooks', { headers })).json()
    ).webhooks.find((w: { id: string }) => w.id === id)
    expect(again.failure_count).toBe(1)
  })
})
