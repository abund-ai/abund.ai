import type { APIRequestContext } from '@playwright/test'
import {
  test,
  expect,
  settle,
  createTestAgent,
  authed,
  type TestAgent,
} from '../fixtures/test-setup'

/**
 * Credits, bounties and escrow
 *
 * Every claimed agent starts with 25 credits. A request's bounty is escrowed
 * from the requester when posted, paid to the assignee on a successful
 * close, refunded on failure, cancel, decline or expiry. Transfers pay an
 * agent directly. Every movement is a signed row on the public ledger.
 */

const API_ORIGIN = (
  process.env.API_URL || 'http://localhost:8787/api/v1/'
).replace(/\/api\/v1\/?$/, '')

const uniq = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

interface CreditEntry {
  kind: string
  amount: number
  balance_after: number
  summary: string
  agent: { handle: string }
  counterparty: { handle: string } | null
  request: { id: string; title: string } | null
}

async function creditsOf(api: APIRequestContext, handle: string) {
  const res = await api.get(`agents/${handle}/credits?limit=100`)
  expect(res.ok()).toBeTruthy()
  return (await res.json()) as {
    credits: number
    escrowed: number
    earned: number
    spent: number
    by_kind: Record<string, { count: number; amount: number }>
    entries: CreditEntry[]
  }
}

async function optIn(api: APIRequestContext, worker: TestAgent) {
  await api.patch('agents/me', {
    headers: authed(worker.apiKey),
    data: { capabilities: { languages: ['python'], accepts_requests: true } },
  })
  await settle()
}

async function createRequest(
  api: APIRequestContext,
  requester: TestAgent,
  data: Record<string, unknown>
) {
  return api.post('requests', {
    headers: authed(requester.apiKey),
    data: {
      title: `Job ${uniq()}`,
      description: 'Do the thing and report back',
      ...data,
    },
  })
}

test.describe('Credits, bounties and escrow', () => {
  test('starter grant on claim, ledger shape, insufficient bounty, escrow → paid on success', async ({
    api,
  }) => {
    const requester = await createTestAgent(api, 'cr_rq')
    const worker = await createTestAgent(api, 'cr_wk')
    await optIn(api, worker)

    // The claim paid the starter grant, once
    const start = await creditsOf(api, requester.handle)
    expect(start.credits).toBe(25)
    expect(start.escrowed).toBe(0)
    expect(start.entries.map((e) => [e.kind, e.amount])).toEqual([
      ['starter_grant', 25],
    ])
    expect(start.entries[0]?.balance_after).toBe(25)
    const mine = await (
      await api.get('agents/me/credits', { headers: authed(requester.apiKey) })
    ).json()
    expect(mine.credits).toBe(25)
    const me = await (
      await api.get('agents/me', { headers: authed(requester.apiKey) })
    ).json()
    expect(me.agent.credits).toBe(25)

    // More than the balance is a 402 and moves nothing
    const tooMuch = await createRequest(api, requester, {
      bounty: 26,
      target_handle: worker.handle,
    })
    expect(tooMuch.status()).toBe(402)
    expect((await tooMuch.json()).balance).toBe(25)
    expect((await creditsOf(api, requester.handle)).credits).toBe(25)
    expect((await createRequest(api, requester, { bounty: -1 })).status()).toBe(
      400
    )

    // A bounty is escrowed at creation
    const create = await createRequest(api, requester, {
      bounty: 10,
      target_handle: worker.handle,
    })
    expect(create.status()).toBe(201)
    const created = await create.json()
    const id = created.request.id as string
    expect(created.request.bounty).toBe(10)
    expect(created.request.bounty_settled).toBeNull()
    expect(created.hint).toContain('escrow')
    await settle()

    const afterEscrow = await creditsOf(api, requester.handle)
    expect(afterEscrow.credits).toBe(15)
    expect(afterEscrow.escrowed).toBe(10)
    const escrow = afterEscrow.entries[0]
    expect(escrow?.kind).toBe('bounty_escrow')
    expect(escrow?.amount).toBe(-10)
    expect(escrow?.balance_after).toBe(15)
    expect(escrow?.request?.id).toBe(id)

    // The target's notification and todo carry the bounty
    const notes = await api.get(
      'agents/me/notifications?types=request_received',
      { headers: authed(worker.apiKey) }
    )
    const items = (await notes.json()).notifications as {
      data: { request_id: string; bounty?: number }
    }[]
    expect(items.find((n) => n.data.request_id === id)?.data.bounty).toBe(10)
    const status = await (
      await api.get('agents/status', { headers: authed(worker.apiKey) })
    ).json()
    const item = status.todo.find(
      (t: { action: string; params?: { id: string } }) =>
        t.action === 'accept_request' && t.params?.id === id
    )
    expect(item?.why).toContain('10-credit bounty')

    // accept → deliver → close success pays the assignee from escrow
    expect(
      (
        await api.post(`requests/${id}/accept`, {
          headers: authed(worker.apiKey),
        })
      ).ok()
    ).toBeTruthy()
    await settle()
    expect(
      (
        await api.post(`requests/${id}/deliver`, {
          headers: authed(worker.apiKey),
          data: { result: 'done' },
        })
      ).ok()
    ).toBeTruthy()
    await settle()
    const close = await api.post(`requests/${id}/close`, {
      headers: authed(requester.apiKey),
      data: { outcome: 'success', note: 'great' },
    })
    expect(close.ok()).toBeTruthy()
    const closed = await close.json()
    expect(closed.karma_awarded).toBe(5)
    expect(closed.credits_paid).toBe(10)
    expect(closed.request.bounty_settled).toBe('paid')
    await settle()

    const workerCredits = await creditsOf(api, worker.handle)
    expect(workerCredits.credits).toBe(35)
    expect(workerCredits.earned).toBe(35)
    const paid = workerCredits.entries[0]
    expect(paid?.kind).toBe('bounty_paid')
    expect(paid?.amount).toBe(10)
    expect(paid?.counterparty?.handle).toBe(requester.handle)
    expect(paid?.request?.id).toBe(id)
    expect(paid?.summary).toContain(
      `@${requester.handle} paid @${worker.handle}`
    )
    const closedNotes = await api.get(
      'agents/me/notifications?types=request_closed',
      { headers: authed(worker.apiKey) }
    )
    const closedItems = (await closedNotes.json()).notifications as {
      data: { request_id: string; credits?: number; karma: number }
    }[]
    expect(
      closedItems.find((n) => n.data.request_id === id)?.data.credits
    ).toBe(10)

    const requesterAfter = await creditsOf(api, requester.handle)
    expect(requesterAfter.credits).toBe(15)
    expect(requesterAfter.escrowed).toBe(0)
    expect(requesterAfter.spent).toBe(10)
    expect(requesterAfter.entries.reduce((s, e) => s + e.amount, 0)).toBe(
      requesterAfter.credits
    )

    // Closing again is a conflict and cannot pay twice
    expect(
      (
        await api.post(`requests/${id}/close`, {
          headers: authed(requester.apiKey),
          data: { outcome: 'success' },
        })
      ).status()
    ).toBe(409)
    expect((await creditsOf(api, worker.handle)).credits).toBe(35)
  })

  test('refunds: cancel, decline, close failed, expiry; raising and lowering a bounty', async ({
    api,
  }) => {
    const requester = await createTestAgent(api, 'cr_rq2')
    const worker = await createTestAgent(api, 'cr_wk2')
    await optIn(api, worker)

    // Cancel an open board request → refund
    const a = await createRequest(api, requester, { bounty: 5 })
    const aId = (await a.json()).request.id as string
    await settle()
    expect((await creditsOf(api, requester.handle)).credits).toBe(20)
    expect(
      (
        await api.post(`requests/${aId}/cancel`, {
          headers: authed(requester.apiKey),
        })
      ).ok()
    ).toBeTruthy()
    await settle()
    let c = await creditsOf(api, requester.handle)
    expect(c.credits).toBe(25)
    expect(c.entries[0]?.kind).toBe('bounty_refund')
    expect(c.entries[0]?.request?.id).toBe(aId)
    expect(
      (await (await api.get(`requests/${aId}`)).json()).request.bounty_settled
    ).toBe('refunded')

    // Decline a direct request → refund
    const b = await createRequest(api, requester, {
      bounty: 6,
      target_handle: worker.handle,
    })
    const bId = (await b.json()).request.id as string
    await settle()
    expect(
      (
        await api.post(`requests/${bId}/decline`, {
          headers: authed(worker.apiKey),
          data: { note: 'busy' },
        })
      ).ok()
    ).toBeTruthy()
    await settle()
    expect((await creditsOf(api, requester.handle)).credits).toBe(25)

    // Raise, then lower, while open; then close as failed after accept → refund
    const d = await createRequest(api, requester, {
      bounty: 4,
      target_handle: worker.handle,
    })
    const dId = (await d.json()).request.id as string
    await settle()
    const raise = await api.patch(`requests/${dId}`, {
      headers: authed(requester.apiKey),
      data: { bounty: 9 },
    })
    expect(raise.ok()).toBeTruthy()
    expect((await raise.json()).request.bounty).toBe(9)
    await settle()
    c = await creditsOf(api, requester.handle)
    expect(c.credits).toBe(16)
    expect(c.escrowed).toBe(9)
    expect(
      (
        await api.patch(`requests/${dId}`, {
          headers: authed(requester.apiKey),
          data: { bounty: 100 },
        })
      ).status()
    ).toBe(402)
    const lower = await api.patch(`requests/${dId}`, {
      headers: authed(requester.apiKey),
      data: { bounty: 7 },
    })
    expect(lower.ok()).toBeTruthy()
    await settle()
    c = await creditsOf(api, requester.handle)
    expect(c.credits).toBe(18)
    expect(c.escrowed).toBe(7)
    expect(
      (
        await api.post(`requests/${dId}/accept`, {
          headers: authed(worker.apiKey),
        })
      ).ok()
    ).toBeTruthy()
    await settle()
    const failed = await api.post(`requests/${dId}/close`, {
      headers: authed(requester.apiKey),
      data: { outcome: 'failed', note: 'never delivered' },
    })
    expect(failed.ok()).toBeTruthy()
    expect((await failed.json()).credits_paid).toBe(0)
    await settle()
    c = await creditsOf(api, requester.handle)
    expect(c.credits).toBe(25)
    expect(c.escrowed).toBe(0)
    expect((await creditsOf(api, worker.handle)).credits).toBe(25)

    // Expiry via the cron refunds too
    const e = await createRequest(api, requester, {
      bounty: 3,
      deadline_at: new Date(Date.now() + 1500).toISOString(),
    })
    expect(e.status()).toBe(201)
    const eId = (await e.json()).request.id as string
    await settle()
    expect((await creditsOf(api, requester.handle)).credits).toBe(22)
    await new Promise((r) => setTimeout(r, 1600))
    const cron = await api.get(`${API_ORIGIN}/__scheduled?cron=*/15+*+*+*+*`)
    expect(cron.ok()).toBeTruthy()
    await settle()
    expect(
      (await (await api.get(`requests/${eId}`)).json()).request.status
    ).toBe('expired')
    c = await creditsOf(api, requester.handle)
    expect(c.credits).toBe(25)
    expect(c.entries[0]?.kind).toBe('bounty_refund')
    expect(c.entries.reduce((s, x) => s + x.amount, 0)).toBe(25)

    // The board sorts by bounty
    const big = await createRequest(api, requester, { bounty: 20 })
    const bigId = (await big.json()).request.id as string
    await settle()
    const board = await api.get('requests?status=open&sort=bounty&limit=5')
    expect((await board.json()).requests[0].id).toBe(bigId)
    const md = await api.get('requests?status=open&sort=bounty&format=markdown')
    expect(await md.text()).toContain('bounty 20 credits')
  })

  test('transfers: validation, insufficient, success with notification; the public ledger', async ({
    api,
  }) => {
    const payer = await createTestAgent(api, 'cr_pay')
    const payee = await createTestAgent(api, 'cr_pyd')

    const send = (data: Record<string, unknown>) =>
      api.post('credits/transfer', { headers: authed(payer.apiKey), data })

    expect((await send({ to_handle: payer.handle, amount: 1 })).status()).toBe(
      400
    )
    expect(
      (await send({ to_handle: `nobody_${uniq()}`, amount: 1 })).status()
    ).toBe(404)
    expect((await send({ to_handle: payee.handle, amount: 0 })).status()).toBe(
      400
    )
    const broke = await send({ to_handle: payee.handle, amount: 26 })
    expect(broke.status()).toBe(402)
    expect((await broke.json()).balance).toBe(25)

    const ok = await send({
      to_handle: `@${payee.handle}`,
      amount: 7,
      note: 'for the review',
    })
    expect(ok.ok()).toBeTruthy()
    const body = await ok.json()
    expect(body.paid).toEqual({ handle: payee.handle, amount: 7 })
    expect(body.balance).toBe(18)
    await settle()

    const payerCredits = await creditsOf(api, payer.handle)
    expect(payerCredits.credits).toBe(18)
    expect(payerCredits.entries[0]?.kind).toBe('transfer_out')
    expect(payerCredits.entries[0]?.amount).toBe(-7)
    expect(payerCredits.entries[0]?.counterparty?.handle).toBe(payee.handle)
    const payeeCredits = await creditsOf(api, payee.handle)
    expect(payeeCredits.credits).toBe(32)
    expect(payeeCredits.entries[0]?.kind).toBe('transfer_in')
    expect(payeeCredits.entries[0]?.summary).toBe(
      `@${payer.handle} paid @${payee.handle}`
    )

    const notes = await api.get(
      'agents/me/notifications?types=credits_received',
      { headers: authed(payee.apiKey) }
    )
    const items = (await notes.json()).notifications as {
      data: { amount: number; from: string; note?: string }
      actor: { handle: string }
    }[]
    expect(items.length).toBe(1)
    expect(items[0]?.data.amount).toBe(7)
    expect(items[0]?.data.note).toBe('for the review')
    expect(items[0]?.actor.handle).toBe(payer.handle)

    // Public ledger: both sides, kind groups, direction, markdown, validation
    const involving = await api.get(`credits?agent=${payer.handle}&limit=100`)
    expect(involving.ok()).toBeTruthy()
    const kinds = ((await involving.json()).entries as CreditEntry[]).map(
      (e) => e.kind
    )
    expect(kinds).toContain('transfer_out')
    expect(kinds).toContain('transfer_in')
    expect(kinds).toContain('starter_grant')
    const transfers = await api.get(
      `credits?agent=${payee.handle}&kind=transfer&direction=earned`
    )
    expect(
      ((await transfers.json()).entries as CreditEntry[]).map((e) => e.kind)
    ).toEqual(['transfer_in'])
    expect((await api.get('credits?kind=bogus')).status()).toBe(400)
    expect((await api.get('credits?direction=up')).status()).toBe(400)
    expect((await api.get(`credits?agent=nobody_${uniq()}`)).status()).toBe(404)
    const rules = (await (await api.get('credits?limit=1')).json()).rules
    expect(rules.starter_grant).toContain('+25')
    const md = await api.get(`agents/${payee.handle}/credits?format=markdown`)
    expect(md.headers()['content-type']).toContain('text/markdown')
    expect(await md.text()).toContain('Balance: 32 credits')
    expect(
      (await api.get(`credits?agent=${payee.handle}&format=markdown`)).ok()
    ).toBeTruthy()
  })
})
