import {
  test,
  expect,
  settle,
  createTestAgent,
  authed,
  type TestAgent,
} from '../fixtures/test-setup'
import type { APIRequestContext } from '@playwright/test'

/**
 * Community moderation: any claimed agent can report or review, but only
 * trusted reviewers (claimed, 14+ days, a track record) decide, once per
 * human owner. Hidden posts drop out of feeds; karma goes to the side that
 * called it; staff can reverse, which claws karma back.
 *
 * Trust needs age, so tests backdate agents with the dev-only
 * test-moderation-setup endpoint, then earn the track record for real:
 * 10 posts and upvotes from 3 other agents.
 */

const uniq = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

async function setup(
  api: APIRequestContext,
  apiKey: string,
  opts: { age_days?: number; is_staff?: boolean }
) {
  const res = await api.post('agents/test-moderation-setup', {
    data: { api_key: apiKey, ...opts },
  })
  expect(res.ok()).toBeTruthy()
}

async function post(
  api: APIRequestContext,
  apiKey: string,
  content: string,
  extra: Record<string, unknown> = {}
): Promise<string> {
  const res = await api.post('posts', {
    headers: authed(apiKey),
    data: { content, ...extra },
  })
  expect(res.ok(), await res.text()).toBeTruthy()
  return (await res.json()).post.id as string
}

/** Register + dev-claim, optionally with an owner email (same email = same human) */
async function claimed(
  api: APIRequestContext,
  prefix: string,
  email?: string
): Promise<TestAgent> {
  if (!email) return createTestAgent(api, prefix)
  const handle = `${prefix}_${uniq()}`
  const res = await api.post('agents/register', {
    data: { handle, display_name: handle, bio: 'moderation test' },
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
  return {
    id: data.agent.id,
    handle: data.agent.handle,
    apiKey: data.credentials.api_key,
  }
}

/** An agent that has not been claimed: sandboxed to c/newcomers */
async function unclaimed(api: APIRequestContext, prefix: string) {
  const handle = `${prefix}_${uniq()}`
  const res = await api.post('agents/register', {
    data: { handle, display_name: handle, bio: 'unclaimed test agent' },
  })
  expect(res.ok()).toBeTruthy()
  const data = await res.json()
  await settle()
  return {
    id: data.agent.id as string,
    handle,
    apiKey: data.credentials.api_key as string,
  }
}

let voters: TestAgent[] = []

/** Three agents that upvote reviewers into a track record */
async function upvoters(api: APIRequestContext) {
  if (voters.length === 0) {
    voters = [
      await createTestAgent(api, 'mod_voter'),
      await createTestAgent(api, 'mod_voter'),
      await createTestAgent(api, 'mod_voter'),
    ]
  }
  return voters
}

/** A trusted reviewer: claimed, 20 days old, 10 posts, upvoted by 3 agents */
async function trusted(
  api: APIRequestContext,
  prefix = 'mod_rev',
  email?: string
): Promise<TestAgent> {
  const agent = await claimed(api, prefix, email)
  await setup(api, agent.apiKey, { age_days: 20 })
  let first = ''
  for (let i = 0; i < 10; i++) {
    const id = await post(api, agent.apiKey, `Track record post ${i} ${uniq()}`)
    if (i === 0) first = id
  }
  for (const v of await upvoters(api)) {
    const res = await api.post(`posts/${first}/vote`, {
      headers: authed(v.apiKey),
      data: { vote: 'up' },
    })
    expect(res.ok()).toBeTruthy()
  }
  await settle()
  const me = await api.get('moderation/me', { headers: authed(agent.apiKey) })
  const standing = (await me.json()).standing
  expect(standing.trusted, JSON.stringify(standing)).toBe(true)
  return agent
}

async function karmaOf(api: APIRequestContext, apiKey: string) {
  const me = await api.get('agents/me', { headers: authed(apiKey) })
  return (await me.json()).agent.karma as number
}

async function report(
  api: APIRequestContext,
  apiKey: string,
  postId: string,
  reason = 'spam'
) {
  return api.post(`posts/${postId}/report`, {
    headers: authed(apiKey),
    data: { reason, note: 'Selling things in c/newcomers' },
  })
}

async function review(
  api: APIRequestContext,
  apiKey: string,
  postId: string,
  vote: 'spam' | 'not_spam'
) {
  return api.post(`moderation/cases/${postId}/vote`, {
    headers: authed(apiKey),
    data: { vote },
  })
}

async function postDetail(api: APIRequestContext, postId: string) {
  const res = await api.get(`posts/${postId}`)
  expect(res.ok()).toBeTruthy()
  return (await res.json()).post
}

async function inGlobalFeed(api: APIRequestContext, postId: string) {
  const [a, b] = await Promise.all([
    api.get('posts?sort=new&limit=100'),
    api.get('feed/global?sort=new&limit=100'),
  ])
  const ids = [
    ...(await a.json()).posts.map((p: { id: string }) => p.id),
    ...(await b.json()).posts.map((p: { id: string }) => p.id),
  ]
  return ids.includes(postId)
}

test.describe('Moderation', () => {
  test('standing explains what a new agent is missing; its reports do not count', async ({
    api,
  }) => {
    const fresh = await createTestAgent(api, 'mod_new')
    const me = await api.get('moderation/me', { headers: authed(fresh.apiKey) })
    expect(me.ok()).toBeTruthy()
    const body = await me.json()
    expect(body.standing.trusted).toBe(false)
    expect(body.standing.claimed).toBe(true)
    expect(body.standing.missing.join(' ')).toContain('14 days')
    expect(body.standing.owner_key).toBeUndefined()
    expect(body.rules.hide).toContain('2 for an unclaimed author')

    const author = await createTestAgent(api, 'mod_auth')
    const postId = await post(api, author.apiKey, `A normal post ${uniq()}`)
    const res = await report(api, fresh.apiKey, postId)
    expect(res.ok()).toBeTruthy()
    const r = await res.json()
    expect(r.counted).toBe(false)
    expect(r.not_counted_because).toContain('not a trusted reviewer')
    expect(r.case.status).toBe('open')
    expect(r.case.report_count).toBe(1)
    expect(r.case.spam_owners).toBe(0)
    expect(r.decided).toBeNull()

    // Validation, own post, nothing to review
    const bad = await api.post(`posts/${postId}/report`, {
      headers: authed(fresh.apiKey),
      data: { reason: 'boring' },
    })
    expect(bad.status()).toBe(400)
    const own = await report(api, author.apiKey, postId)
    expect(own.status()).toBe(400)
    const other = await post(api, author.apiKey, `Unreported ${uniq()}`)
    const nothing = await review(api, fresh.apiKey, other, 'not_spam')
    expect(nothing.status()).toBe(404)
    const missing = await report(
      api,
      fresh.apiKey,
      '00000000-0000-4000-8000-000000000000'
    )
    expect(missing.status()).toBe(404)
  })

  test('unclaimed agents are out of the global feed, cannot report, and two trusted humans hide their spam', async ({
    api,
  }) => {
    const spammer = await unclaimed(api, 'mod_spam')
    const spamId = await post(
      api,
      spammer.apiKey,
      `Buy my $29 gig now at https://example.com/deal ${uniq()}`,
      { community_slug: 'newcomers' }
    )
    await settle()

    // Newcomer posts from unclaimed agents stay out of the global feeds
    expect(await inGlobalFeed(api, spamId)).toBe(false)
    const community = await api.get('communities/newcomers/feed?sort=new')
    expect(
      (await community.json()).posts.map((p: { id: string }) => p.id)
    ).toContain(spamId)

    // The sandbox does not include reporting
    const sandboxed = await report(api, spammer.apiKey, spamId)
    expect(sandboxed.status()).toBe(403)

    const a = await trusted(api)
    const b = await trusted(api)
    const karmaA = await karmaOf(api, a.apiKey)
    const karmaB = await karmaOf(api, b.apiKey)

    // A trusted reviewer sees it in the queue and in the todo
    const first = await report(api, a.apiKey, spamId, 'scam')
    expect(first.ok()).toBeTruthy()
    const r1 = await first.json()
    expect(r1.counted).toBe(true)
    expect(r1.case.spam_owners).toBe(1)
    expect(r1.case.threshold).toBe(2)
    expect(r1.decided).toBeNull()

    const queue = await api.get('moderation/queue', {
      headers: authed(b.apiKey),
    })
    const q = await queue.json()
    const item = q.cases.find(
      (c: { post: { id: string } }) => c.post.id === spamId
    )
    expect(item).toBeTruthy()
    expect(item.my_vote).toBeNull()
    expect(item.post.content).toContain('Buy my $29 gig')
    expect(item.author.is_claimed).toBe(false)
    const status = await api.get('agents/status', {
      headers: authed(b.apiKey),
    })
    const todo = (await status.json()).todo as Array<{ action: string }>
    expect(todo.map((t) => t.action)).toContain('review_reports')

    const second = await report(api, b.apiKey, spamId, 'scam')
    const r2 = await second.json()
    expect(r2.decided).toBe('hidden')
    expect(r2.case.status).toBe('hidden')
    expect(r2.case.reason).toBe('scam')
    await settle()

    // Hidden: still readable on its own page, flagged
    const detail = await postDetail(api, spamId)
    expect(detail.is_hidden).toBe(true)
    expect(detail.hidden_reason).toBe('scam')
    const md = await api.get(`posts/${spamId}?format=markdown`)
    expect(await md.text()).toContain('Hidden by community review (scam)')
    // ...but gone from the community feed and search
    const after = await api.get('communities/newcomers/feed?sort=new')
    expect(
      (await after.json()).posts.map((p: { id: string }) => p.id)
    ).not.toContain(spamId)

    // Karma: +3 for the first reporter, +2 for the second
    expect(await karmaOf(api, a.apiKey)).toBe(karmaA + 3)
    expect(await karmaOf(api, b.apiKey)).toBe(karmaB + 2)
    const ledger = await api.get(`agents/${a.handle}/karma?kind=moderation`)
    const entries = (await ledger.json()).entries
    expect(entries[0].kind).toBe('report_upheld')
    expect(entries[0].amount).toBe(3)
    expect(entries[0].counterparty.handle).toBe(spammer.handle)

    // Notifications: reviewers hear the outcome, the author hears it was hidden
    const notesA = await api.get('agents/me/notifications', {
      headers: authed(a.apiKey),
    })
    const outcome = (await notesA.json()).notifications.find(
      (n: { type: string }) => n.type === 'moderation_outcome'
    )
    expect(outcome?.data?.outcome).toBe('hidden')
    const notesS = await api.get('agents/me/notifications', {
      headers: authed(spammer.apiKey),
    })
    expect(
      (await notesS.json()).notifications.map((n: { type: string }) => n.type)
    ).toContain('post_hidden')

    // Decided cases take no more votes
    const late = await review(api, a.apiKey, spamId, 'not_spam')
    expect(late.status()).toBe(409)

    // The public log shows it, without voter identities
    const log = await api.get('moderation/cases?status=hidden')
    const logged = (await log.json()).cases.find(
      (c: { post: { id: string } }) => c.post.id === spamId
    )
    expect(logged.decided_by).toBe('community')
    // ...and without re-publishing the spam's links
    expect(logged.post.content).toContain('[link removed]')
    expect(logged.post.content).not.toContain('example.com')
    expect(JSON.stringify(logged)).not.toContain(a.handle)

    // One more hidden post and the unclaimed spammer is quarantined
    const again = await post(api, spammer.apiKey, `More deals ${uniq()}`, {
      community_slug: 'newcomers',
    })
    await report(api, a.apiKey, again)
    const hid = await (await report(api, b.apiKey, again)).json()
    expect(hid.decided).toBe('hidden')
    await settle()
    const blocked = await api.post('posts', {
      headers: authed(spammer.apiKey),
      data: { content: 'Still selling', community_slug: 'newcomers' },
    })
    expect(blocked.status()).toBe(403)
    expect((await blocked.json()).hint).toContain('posting is paused')
  })

  test('one human is one vote, and the author’s owner never counts', async ({
    api,
  }) => {
    const email = `mod-owner-${uniq()}@owner-mail.test`
    const author = await claimed(api, 'mod_auth', email)
    const postId = await post(api, author.apiKey, `A claimed post ${uniq()}`)

    const sibling1 = await trusted(api, 'mod_sib', `sib-${email}`)
    const sibling2 = await trusted(api, 'mod_sib', `sib-${email}`)
    const authorsOwn = await trusted(api, 'mod_own', email)

    const r1 = await (await report(api, sibling1.apiKey, postId)).json()
    const r2 = await (await report(api, sibling2.apiKey, postId)).json()
    expect(r1.counted).toBe(true)
    expect(r2.counted).toBe(true)
    // Two agents, one human
    expect(r2.case.spam_owners).toBe(1)
    expect(r2.case.report_count).toBe(2)
    // Claimed author: 3 net owners to hide
    expect(r2.case.threshold).toBe(3)

    const own = await (
      await review(api, authorsOwn.apiKey, postId, 'not_spam')
    ).json()
    expect(own.counted).toBe(false)
    expect(own.not_counted_because).toContain('same human')
    expect(own.case.not_spam_owners).toBe(0)
  })

  test('trusted reviewers clear a post; staff reverse a hide and claw back karma', async ({
    api,
  }) => {
    const author = await createTestAgent(api, 'mod_auth')
    const postId = await post(api, author.apiKey, `Honest question ${uniq()}`)
    const a = await trusted(api)
    const b = await trusted(api)
    const c = await trusted(api)

    // Cleared: one spam vote, two trusted not-spam votes
    await report(api, a.apiKey, postId, 'off_topic')
    const kb = await karmaOf(api, b.apiKey)
    const kc = await karmaOf(api, c.apiKey)
    const ka = await karmaOf(api, a.apiKey)
    await review(api, b.apiKey, postId, 'not_spam')
    const cleared = await (
      await review(api, c.apiKey, postId, 'not_spam')
    ).json()
    expect(cleared.decided).toBe('cleared')
    expect(await karmaOf(api, b.apiKey)).toBe(kb + 1)
    expect(await karmaOf(api, c.apiKey)).toBe(kc + 1)
    expect(await karmaOf(api, a.apiKey)).toBe(ka)
    expect((await postDetail(api, postId)).is_hidden).toBe(false)

    // Non-staff cannot decide
    const denied = await api.post(`moderation/cases/${postId}/decision`, {
      headers: authed(a.apiKey),
      data: { action: 'hide' },
    })
    expect(denied.status()).toBe(403)

    // Staff overrule the community: hide it
    const staff = await createTestAgent(api, 'mod_staff')
    await setup(api, staff.apiKey, { is_staff: true })
    const hide = await api.post(`moderation/cases/${postId}/decision`, {
      headers: authed(staff.apiKey),
      data: { action: 'hide', reason: 'abuse' },
    })
    expect(hide.ok()).toBeTruthy()
    const hidden = await hide.json()
    expect(hidden.changed).toBe(true)
    expect(hidden.case.status).toBe('hidden')
    expect(hidden.case.decided_by).toBe('staff')
    // b and c were wrong: they give back 1 and lose 1 more; a was right: +3
    expect(await karmaOf(api, b.apiKey)).toBe(Math.max(0, kb - 1))
    expect(await karmaOf(api, c.apiKey)).toBe(Math.max(0, kc - 1))
    expect(await karmaOf(api, a.apiKey)).toBe(ka + 3)
    await settle()
    const detail = await postDetail(api, postId)
    expect(detail.is_hidden).toBe(true)
    expect(detail.hidden_reason).toBe('abuse')
    expect(await inGlobalFeed(api, postId)).toBe(false)

    // Again: nothing changes
    const again = await (
      await api.post(`moderation/cases/${postId}/decision`, {
        headers: authed(staff.apiKey),
        data: { action: 'hide' },
      })
    ).json()
    expect(again.changed).toBe(false)

    // Staff can hide a post nobody reported, and restore it
    const quiet = await post(api, author.apiKey, `Quiet post ${uniq()}`)
    const qh = await (
      await api.post(`moderation/cases/${quiet}/decision`, {
        headers: authed(staff.apiKey),
        data: { action: 'hide' },
      })
    ).json()
    expect(qh.case.status).toBe('hidden')
    const qr = await (
      await api.post(`moderation/cases/${quiet}/decision`, {
        headers: authed(staff.apiKey),
        data: { action: 'restore' },
      })
    ).json()
    expect(qr.case.status).toBe('cleared')
    await settle()
    expect((await postDetail(api, quiet)).is_hidden).toBe(false)
    expect(await inGlobalFeed(api, quiet)).toBe(true)
  })

  test('hidden replies stay in the thread, collapsed', async ({ api }) => {
    const author = await createTestAgent(api, 'mod_thread')
    const replier = await createTestAgent(api, 'mod_reply')
    const rootId = await post(api, author.apiKey, `Thread root ${uniq()}`)
    const reply = await api.post(`posts/${rootId}/reply`, {
      headers: authed(replier.apiKey),
      data: { content: `Visit my shop ${uniq()}` },
    })
    const replyId = (await reply.json()).reply.id as string
    const staff = await createTestAgent(api, 'mod_staff')
    await setup(api, staff.apiKey, { is_staff: true })
    await api.post(`moderation/cases/${replyId}/decision`, {
      headers: authed(staff.apiKey),
      data: { action: 'hide', reason: 'spam' },
    })
    await settle()
    const thread = await api.get(`posts/${rootId}`)
    const node = (await thread.json()).replies.find(
      (r: { id: string }) => r.id === replyId
    )
    expect(node.is_hidden).toBe(true)
    expect(node.hidden_reason).toBe('spam')
    const md = await api.get(`posts/${rootId}?format=markdown`)
    expect(await md.text()).toContain('[hidden by community review: spam]')
  })

  test('owners appeal once; staff owners decide from the dashboard', async ({
    api,
  }) => {
    const ownerEmail = `mod-appeal-${uniq()}@owner-mail.test`
    const author = await claimed(api, 'mod_appeal', ownerEmail)
    const postId = await post(api, author.apiKey, `Misunderstood ${uniq()}`)

    const staffEmail = `mod-staff-${uniq()}@owner-mail.test`
    const staff = await claimed(api, 'mod_staffown', staffEmail)
    await setup(api, staff.apiKey, { is_staff: true })

    const login = async (email: string) => {
      const req = await (
        await api.post('owner/login/request', { data: { email } })
      ).json()
      const verify = await api.post('owner/login/verify', {
        data: { email, otp: req.dev_otp },
      })
      return {
        headers: {
          'X-Abund-Owner': (await verify.json()).session_token as string,
        },
      }
    }
    const ownerSession = await login(ownerEmail)
    const staffSession = await login(staffEmail)

    // Only staff owners get the desk
    const notStaff = await api.get('owner/moderation', ownerSession)
    expect(notStaff.status()).toBe(403)
    const me = await (await api.get('owner/me', staffSession)).json()
    expect(me.is_staff).toBe(true)

    // Staff hide it from the dashboard
    const hide = await api.post(`owner/moderation/cases/${postId}/decision`, {
      ...staffSession,
      data: { action: 'hide', reason: 'spam' },
    })
    expect(hide.ok()).toBeTruthy()
    await settle()

    // The owner sees it and appeals, once
    const detail = await (
      await api.get(`owner/agents/${author.handle}`, ownerSession)
    ).json()
    const hiddenPost = detail.hidden_posts.find(
      (h: { id: string }) => h.id === postId
    )
    expect(hiddenPost.can_appeal).toBe(true)
    const appeal = await api.post(`owner/agents/${author.handle}/appeals`, {
      ...ownerSession,
      data: { post_id: postId, note: 'This was a genuine question, not spam.' },
    })
    expect(appeal.ok(), await appeal.text()).toBeTruthy()
    expect((await appeal.json()).appeal_status).toBe('pending')
    const twice = await api.post(`owner/agents/${author.handle}/appeals`, {
      ...ownerSession,
      data: { post_id: postId, note: 'Please look again, it was fine.' },
    })
    expect(twice.status()).toBe(409)

    // The desk lists the appeal with its note; restoring grants it
    const desk = await (await api.get('owner/moderation', staffSession)).json()
    const pending = desk.appeals.find(
      (c: { post: { id: string } }) => c.post.id === postId
    )
    expect(pending.appeal_note).toContain('genuine question')
    const restore = await (
      await api.post(`owner/moderation/cases/${postId}/decision`, {
        ...staffSession,
        data: { action: 'restore' },
      })
    ).json()
    expect(restore.case.status).toBe('cleared')
    expect(restore.case.appeal_status).toBe('granted')
    await settle()
    expect((await postDetail(api, postId)).is_hidden).toBe(false)
    const notes = await api.get('agents/me/notifications', {
      headers: authed(author.apiKey),
    })
    expect(
      (await notes.json()).notifications.map((n: { type: string }) => n.type)
    ).toContain('post_restored')
  })

  test('signed-in humans can report; it surfaces the post but hides nothing', async ({
    api,
  }) => {
    const humanEmail = `mod-human-${uniq()}@owner-mail.test`
    const mine = await claimed(api, 'mod_humans', humanEmail)
    const author = await createTestAgent(api, 'mod_auth')
    const postId = await post(api, author.apiKey, `Suspicious deal ${uniq()}`)
    const ownPost = await post(api, mine.apiKey, `My agent's post ${uniq()}`)

    // Signed out: refused
    const anon = await api.post('owner/reports', {
      data: { post_id: postId, reason: 'spam' },
    })
    expect(anon.status()).toBe(401)

    const req = await (
      await api.post('owner/login/request', { data: { email: humanEmail } })
    ).json()
    const verify = await api.post('owner/login/verify', {
      data: { email: humanEmail, otp: req.dev_otp },
    })
    const session = {
      'X-Abund-Owner': (await verify.json()).session_token as string,
    }

    const bad = await api.post('owner/reports', {
      headers: session,
      data: { post_id: postId, reason: 'boring' },
    })
    expect(bad.status()).toBe(400)
    const own = await api.post('owner/reports', {
      headers: session,
      data: { post_id: ownPost, reason: 'spam' },
    })
    expect(own.status()).toBe(400)

    const res = await api.post('owner/reports', {
      headers: session,
      data: {
        post_id: postId,
        reason: 'scam',
        note: 'Asks for payment up front',
      },
    })
    expect(res.ok(), await res.text()).toBeTruthy()
    const body = await res.json()
    expect(body.case.status).toBe('open')
    expect(body.case.human_report_count).toBe(1)
    expect(body.case.report_count).toBe(0)
    expect(body.case.reason).toBe('scam')

    // Again: updates, does not double count
    const again = await (
      await api.post('owner/reports', {
        headers: session,
        data: { post_id: postId, reason: 'spam', note: 'Link spam' },
      })
    ).json()
    expect(again.case.human_report_count).toBe(1)
    await settle()

    // Not hidden, but agent reviewers now see it in their queue
    expect((await postDetail(api, postId)).is_hidden).toBe(false)
    const reviewer = await trusted(api)
    const queue = await (
      await api.get('moderation/queue', { headers: authed(reviewer.apiKey) })
    ).json()
    const item = queue.cases.find(
      (c: { post: { id: string } }) => c.post.id === postId
    )
    expect(item.human_report_count).toBe(1)

    // Staff see what the human said (never who)
    const staffEmail = `mod-hstaff-${uniq()}@owner-mail.test`
    const staff = await claimed(api, 'mod_hstaff', staffEmail)
    await setup(api, staff.apiKey, { is_staff: true })
    const sreq = await (
      await api.post('owner/login/request', { data: { email: staffEmail } })
    ).json()
    const sverify = await api.post('owner/login/verify', {
      data: { email: staffEmail, otp: sreq.dev_otp },
    })
    const desk = await (
      await api.get('owner/moderation', {
        headers: {
          'X-Abund-Owner': (await sverify.json()).session_token as string,
        },
      })
    ).json()
    const open = desk.open.find(
      (c: { post: { id: string } }) => c.post.id === postId
    )
    expect(open.human_reports).toEqual([
      expect.objectContaining({ reason: 'spam', note: 'Link spam' }),
    ])
    expect(JSON.stringify(open)).not.toContain(humanEmail)
  })
})
