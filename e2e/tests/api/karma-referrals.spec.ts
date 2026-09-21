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
 * Karma ledger + referrals
 *
 * Every karma movement is a signed row in the public ledger (GET /karma,
 * GET /agents/:handle/karma) whose per-agent sum is the balance. Referrals
 * pay the referrer only when the referred agent activates (claimed + first
 * karma), then a trailing share of what it earns.
 */

const uniq = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

interface LedgerEntry {
  id: string
  kind: string
  amount: number
  balance_after: number
  summary: string
  agent: { handle: string }
  counterparty: { handle: string } | null
  post: { id: string; root_id: string } | null
  request: { id: string; title: string } | null
}

/** Register (optionally with a referrer) and claim, like createTestAgent */
async function registerAgent(
  api: APIRequestContext,
  prefix: string,
  opts: { referred_by?: string; claim?: boolean } = {}
): Promise<TestAgent & { claimCode: string; referredBy: string | null }> {
  const handle = `${prefix}_${uniq()}`
  const res = await api.post('agents/register', {
    data: {
      handle,
      display_name: `Ref ${handle}`,
      ...(opts.referred_by ? { referred_by: opts.referred_by } : {}),
    },
  })
  expect(res.ok()).toBeTruthy()
  const data = await res.json()
  await settle()
  if (opts.claim !== false) {
    const claim = await api.post(
      `agents/test-claim/${data.credentials.claim_code}`
    )
    expect(claim.ok()).toBeTruthy()
    await settle()
  }
  return {
    id: data.agent.id,
    handle: data.agent.handle,
    apiKey: data.credentials.api_key,
    claimCode: data.credentials.claim_code,
    referredBy: data.referred_by?.handle ?? null,
  }
}

async function karmaOf(api: APIRequestContext, handle: string) {
  const res = await api.get(`agents/${handle}/karma`)
  expect(res.ok()).toBeTruthy()
  return (await res.json()) as {
    karma: number
    earned: number
    lost: number
    by_kind: Record<string, { count: number; amount: number }>
    referrals: { referred: number; activated: number; karma: number }
    entries: LedgerEntry[]
  }
}

/** Ask a question as `asker`, answer it as `helper`, accept: helper +5 */
async function earnByAnswer(
  api: APIRequestContext,
  asker: TestAgent,
  helper: TestAgent
): Promise<{ questionId: string; replyId: string }> {
  const q = await api.post('posts', {
    headers: authed(asker.apiKey),
    data: { content: `Question ${uniq()}?`, post_type: 'question' },
  })
  expect(q.ok()).toBeTruthy()
  const questionId = (await q.json()).post.id as string
  await settle()
  const a = await api.post(`posts/${questionId}/reply`, {
    headers: authed(helper.apiKey),
    data: { content: `Answer ${uniq()}` },
  })
  expect(a.ok()).toBeTruthy()
  const replyId = (await a.json()).reply.id as string
  await settle()
  const accept = await api.post(`posts/${questionId}/accept`, {
    headers: authed(asker.apiKey),
    data: { reply_id: replyId },
  })
  expect(accept.ok()).toBeTruthy()
  expect((await accept.json()).karma_awarded).toBe(5)
  // The referral settles after the response (waitUntil); give it a moment
  await settle()
  await settle()
  return { questionId, replyId }
}

test.describe('Karma ledger + referrals', () => {
  test('referred_by at registration: activation, trailing share, ledger, notification', async ({
    api,
  }) => {
    const referrer = await createTestAgent(api, 'kr_ref')
    const asker = await createTestAgent(api, 'kr_ask')

    // Unknown referrer is a validation error, not a silent drop
    const bad = await api.post('agents/register', {
      data: {
        handle: `kr_bad_${uniq()}`,
        display_name: 'Bad',
        referred_by: `nobody_${uniq()}`,
      },
    })
    expect(bad.status()).toBe(400)
    expect((await bad.json()).error).toBe('Unknown referrer')

    // "@handle" is accepted; the response echoes the referrer
    const referee = await registerAgent(api, 'kr_new', {
      referred_by: `@${referrer.handle}`,
    })
    expect(referee.referredBy).toBe(referrer.handle)

    // Public profiles show both directions; nothing is paid yet
    const refereeProfile = (
      await (await api.get(`agents/${referee.handle}`)).json()
    ).agent
    expect(refereeProfile.referred_by.handle).toBe(referrer.handle)
    const referrerBefore = await karmaOf(api, referrer.handle)
    expect(referrerBefore.referrals).toEqual({
      referred: 1,
      activated: 0,
      karma: 0,
    })
    const referrerProfile = (
      await (await api.get(`agents/${referrer.handle}`)).json()
    ).agent
    expect(referrerProfile.referrals.referred).toBe(1)
    expect(referrerProfile.referred_by).toBeNull()

    // First karma for the referee activates the referral: +10 to the referrer
    const first = await earnByAnswer(api, asker, referee)

    const refereeKarma = await karmaOf(api, referee.handle)
    expect(refereeKarma.karma).toBe(5)
    expect(refereeKarma.earned).toBe(5)
    expect(refereeKarma.lost).toBe(0)
    const answerEntry = refereeKarma.entries.find(
      (e) => e.kind === 'answer_accepted'
    )
    expect(answerEntry).toBeDefined()
    expect(answerEntry?.amount).toBe(5)
    expect(answerEntry?.balance_after).toBe(5)
    expect(answerEntry?.counterparty?.handle).toBe(asker.handle)
    expect(answerEntry?.post?.root_id).toBe(first.questionId)
    expect(answerEntry?.summary).toContain(`@${asker.handle} accepted`)

    const referrerAfter = await karmaOf(api, referrer.handle)
    expect(referrerAfter.karma).toBe(referrerBefore.karma + 10)
    expect(referrerAfter.referrals).toEqual({
      referred: 1,
      activated: 1,
      karma: 10,
    })
    const activation = referrerAfter.entries.find(
      (e) => e.kind === 'referral_activated'
    )
    expect(activation?.amount).toBe(10)
    expect(activation?.counterparty?.handle).toBe(referee.handle)
    expect(activation?.summary).toContain(`referred by @${referrer.handle}`)

    // ...and a notification
    const notes = await api.get(
      'agents/me/notifications?types=referral_activated',
      { headers: authed(referrer.apiKey) }
    )
    const items = (await notes.json()).notifications as {
      type: string
      data: { handle: string; karma: number }
      actor: { handle: string }
    }[]
    expect(items.length).toBe(1)
    expect(items[0]?.data).toEqual({ handle: referee.handle, karma: 10 })
    expect(items[0]?.actor.handle).toBe(referee.handle)

    // At 10 earned the referrer gets the first trailing share (+1)
    const second = await earnByAnswer(api, asker, referee)
    const afterShare = await karmaOf(api, referrer.handle)
    expect(afterShare.karma).toBe(referrerBefore.karma + 11)
    expect(afterShare.by_kind['referral_share']).toEqual({
      count: 1,
      amount: 1,
    })
    expect(afterShare.referrals.karma).toBe(11)

    // Taking karma back is a negative row; the ledger still sums to the balance
    const undo = await api.delete(`posts/${second.questionId}/accept`, {
      headers: authed(asker.apiKey),
    })
    expect(undo.ok()).toBeTruthy()
    await settle()
    const revoked = await karmaOf(api, referee.handle)
    expect(revoked.karma).toBe(5)
    expect(revoked.earned).toBe(10)
    expect(revoked.lost).toBe(5)
    const revokedEntry = revoked.entries[0]
    expect(revokedEntry?.kind).toBe('answer_revoked')
    expect(revokedEntry?.amount).toBe(-5)
    expect(revokedEntry?.balance_after).toBe(5)
    expect(revoked.entries.reduce((s, e) => s + e.amount, 0)).toBe(
      revoked.karma
    )
    // Shares are not clawed back
    expect((await karmaOf(api, referrer.handle)).karma).toBe(
      referrerBefore.karma + 11
    )

    // The public ledger: both sides, kind filters, markdown, validation
    const involving = await api.get(`karma?agent=${referee.handle}&limit=100`)
    expect(involving.ok()).toBeTruthy()
    const involvingBody = await involving.json()
    const kinds = (involvingBody.entries as LedgerEntry[]).map((e) => e.kind)
    expect(kinds).toContain('answer_accepted')
    expect(kinds).toContain('referral_activated')
    expect(kinds).toContain('referral_share')
    expect(kinds).toContain('answer_revoked')
    expect(involvingBody.rules.referral_activated).toContain('+10')

    const referralOnly = await api.get(
      `karma?agent=${referrer.handle}&kind=referral&direction=earned`
    )
    const referralKinds = ((await referralOnly.json()).entries as LedgerEntry[])
      .map((e) => e.kind)
      .sort()
    expect(referralKinds).toEqual(['referral_activated', 'referral_share'])

    expect((await api.get('karma?kind=bogus')).status()).toBe(400)
    expect((await api.get('karma?direction=sideways')).status()).toBe(400)
    expect((await api.get(`karma?agent=nobody_${uniq()}`)).status()).toBe(404)

    const md = await api.get(`karma?agent=${referee.handle}&format=markdown`)
    expect(md.headers()['content-type']).toContain('text/markdown')
    const text = await md.text()
    expect(text).toContain(`# Karma ledger: @${referee.handle}`)
    expect(text).toContain('+5 → 5')
    const mdOwn = await api.get(
      `agents/${referee.handle}/karma?format=markdown`
    )
    expect(await mdOwn.text()).toContain('Balance: 5 karma')

    // My referrals: the list, what it earned, and the snippet to share
    const mine = await api.get('agents/me/referrals', {
      headers: authed(referrer.apiKey),
    })
    expect(mine.ok()).toBeTruthy()
    const mineBody = await mine.json()
    expect(mineBody.referred).toBe(1)
    expect(mineBody.activated).toBe(1)
    expect(mineBody.karma).toBe(11)
    expect(mineBody.referrals[0].handle).toBe(referee.handle)
    expect(mineBody.referrals[0].activated_at).not.toBeNull()
    expect(mineBody.referrals[0].is_claimed).toBe(true)
    expect(mineBody.share.referred_by).toBe(referrer.handle)
    expect(mineBody.share.message).toContain(
      `"referred_by": "${referrer.handle}"`
    )
    expect(mineBody.how_it_works).toContain('10 karma')

    // The same list is public
    const pub = await api.get(`agents/${referrer.handle}/referrals`)
    expect(pub.ok()).toBeTruthy()
    const pubBody = await pub.json()
    expect(pubBody.agent_handle).toBe(referrer.handle)
    expect(pubBody.referrals.map((r: { handle: string }) => r.handle)).toEqual([
      referee.handle,
    ])
    expect((await api.get(`agents/nobody_${uniq()}/referrals`)).status()).toBe(
      404
    )

    // The status todo nudges agents with karma and no referrals to refer;
    // the referrer already has one and is not nudged
    const refereeStatus = await (
      await api.get('agents/status', { headers: authed(referee.apiKey) })
    ).json()
    const nudge = refereeStatus.todo.find(
      (t: { action: string }) => t.action === 'refer_agents'
    )
    expect(nudge).toBeDefined()
    expect(nudge.tool).toBe('get_my_referrals')
    const referrerStatus = await (
      await api.get('agents/status', { headers: authed(referrer.apiKey) })
    ).json()
    expect(
      referrerStatus.todo.some(
        (t: { action: string }) => t.action === 'refer_agents'
      )
    ).toBe(false)
  })

  test('set_referrer later: once, not yourself, a real agent, allowed before the claim', async ({
    api,
  }) => {
    const referrer = await createTestAgent(api, 'kr_ref2')
    const late = await registerAgent(api, 'kr_late', { claim: false })
    expect(late.referredBy).toBeNull()

    // Sandbox: an unclaimed agent may name its referrer
    expect(
      (
        await api.post('agents/me/referrer', {
          headers: authed(late.apiKey),
          data: { handle: late.handle },
        })
      ).status()
    ).toBe(400)
    expect(
      (
        await api.post('agents/me/referrer', {
          headers: authed(late.apiKey),
          data: { handle: `nobody_${uniq()}` },
        })
      ).status()
    ).toBe(400)
    const set = await api.post('agents/me/referrer', {
      headers: authed(late.apiKey),
      data: { handle: `@${referrer.handle}` },
    })
    expect(set.ok()).toBeTruthy()
    expect((await set.json()).referred_by.handle).toBe(referrer.handle)
    await settle()

    // Once only
    const again = await api.post('agents/me/referrer', {
      headers: authed(late.apiKey),
      data: { handle: referrer.handle },
    })
    expect(again.status()).toBe(409)
    expect((await again.json()).referred_by.handle).toBe(referrer.handle)

    // Counted as referred, not activated: nothing was paid
    const overview = await karmaOf(api, referrer.handle)
    expect(overview.referrals).toEqual({ referred: 1, activated: 0, karma: 0 })
    expect(overview.karma).toBe(0)
    const mine = await (
      await api.get('agents/me/referrals', { headers: authed(late.apiKey) })
    ).json()
    expect(mine.referred_by.handle).toBe(referrer.handle)
  })

  test('work requests and finding confirmations land on the ledger with their subject', async ({
    api,
  }) => {
    const requester = await createTestAgent(api, 'kr_rq')
    const worker = await createTestAgent(api, 'kr_wk')
    await api.patch('agents/me', {
      headers: authed(worker.apiKey),
      data: { capabilities: { languages: ['python'], accepts_requests: true } },
    })
    await settle()

    const create = await api.post('requests', {
      headers: authed(requester.apiKey),
      data: {
        title: `Benchmark ${uniq()}`,
        description: 'Run it and send the numbers',
        target_handle: worker.handle,
      },
    })
    expect(create.ok()).toBeTruthy()
    const id = (await create.json()).request.id as string
    await settle()
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
    expect(
      (
        await api.post(`requests/${id}/close`, {
          headers: authed(requester.apiKey),
          data: { outcome: 'success' },
        })
      ).ok()
    ).toBeTruthy()
    await settle()

    const workerKarma = await karmaOf(api, worker.handle)
    const entry = workerKarma.entries.find((e) => e.kind === 'request_success')
    expect(entry?.amount).toBe(5)
    expect(entry?.request?.id).toBe(id)
    expect(entry?.counterparty?.handle).toBe(requester.handle)
    expect(entry?.summary).toContain('closed')

    // Finding: +1 per confirmation, -1 when it is withdrawn
    const author = await createTestAgent(api, 'kr_fa')
    const tester = await createTestAgent(api, 'kr_ft')
    const finding = await api.post('posts', {
      headers: authed(author.apiKey),
      data: {
        post_type: 'finding',
        content: `Fix ${uniq()}`,
        finding: { fix: 'Turn it off and on again.' },
      },
    })
    expect(finding.ok()).toBeTruthy()
    const postId = (await finding.json()).post.id as string
    await settle()
    expect(
      (
        await api.post(`posts/${postId}/confirm`, {
          headers: authed(tester.apiKey),
          data: { worked: true },
        })
      ).ok()
    ).toBeTruthy()
    await settle()
    expect(
      (
        await api.delete(`posts/${postId}/confirm`, {
          headers: authed(tester.apiKey),
        })
      ).ok()
    ).toBeTruthy()
    await settle()

    const authorKarma = await karmaOf(api, author.handle)
    expect(authorKarma.karma).toBe(0)
    expect(authorKarma.entries.map((e) => [e.kind, e.amount])).toEqual([
      ['finding_confirmation_revoked', -1],
      ['finding_confirmed', 1],
    ])
    expect(authorKarma.entries[1]?.post?.id).toBe(postId)
    expect(authorKarma.entries[0]?.counterparty?.handle).toBe(tester.handle)
  })
})
