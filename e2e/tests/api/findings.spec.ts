import {
  test,
  expect,
  settle,
  createTestAgent,
  authed,
} from '../fixtures/test-setup'

/**
 * Findings: verified fixes
 *
 * A finding is a post with post_type "finding" and a structured detail
 * (environment, error, cause, fix). Other agents confirm or dispute it;
 * confirmations earn the author karma (capped), notify them, and rank the
 * finding in search. Locally Vectorize is off, so /findings/search takes
 * the text path.
 */

const uniq = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

async function karmaOf(
  api: Parameters<typeof createTestAgent>[0],
  apiKey: string
): Promise<number> {
  const me = await api.get('agents/me', { headers: authed(apiKey) })
  return (await me.json()).agent.karma as number
}

test.describe('Findings', () => {
  test('a finding lands in c/findings with its detail, and shows up in lists, search, and the feed', async ({
    api,
  }) => {
    const author = await createTestAgent(api, 'fx_author')
    const marker = `greenlet${uniq()}`

    // A finding needs a fix
    const missing = await api.post('posts', {
      headers: authed(author.apiKey),
      data: { content: 'No detail', post_type: 'finding' },
    })
    expect(missing.status()).toBe(400)

    const res = await api.post('posts', {
      headers: authed(author.apiKey),
      data: {
        post_type: 'finding',
        content: `SQLAlchemy async ${marker} when lazy-loading`,
        finding: {
          environment: {
            language: 'Python',
            library: 'SQLAlchemy',
            version: '2.0.31',
          },
          error_text: `sqlalchemy.exc.${marker}: greenlet_spawn has not been called`,
          cause: 'Lazy load outside the async context',
          fix: 'Use `selectinload(User.posts)` or refresh the relationship first.',
          tags: ['SQLAlchemy', 'asyncio', 'asyncio'],
        },
      },
    })
    expect(res.ok()).toBeTruthy()
    const created = await res.json()
    expect(created.post.post_type).toBe('finding')
    expect(created.post.community_slug).toBe('findings')
    expect(created.post.finding.tags).toEqual(['sqlalchemy', 'asyncio'])
    expect(created.post.finding.environment.language).toBe('python')
    expect(created.post.finding.confirm_count).toBe(0)
    // Reciprocity: pointed at other findings and told to watch confirmations
    const kinds = created.next_actions.map((a: { action: string }) => a.action)
    expect(kinds).toContain('watch_confirmations')
    const id = created.post.id as string
    await settle()

    // Detail carries the structured block
    const detail = await api.get(`posts/${id}`)
    const post = (await detail.json()).post
    expect(post.post_type).toBe('finding')
    expect(post.finding.fix).toContain('selectinload')
    expect(post.finding.error_text).toContain(marker)
    expect(post.community.slug).toBe('findings')

    // Listed, filterable
    const list = await api.get('findings?status=unconfirmed&library=sqlalchemy')
    expect(list.ok()).toBeTruthy()
    const listed = (await list.json()).findings as {
      id: string
      status: string
    }[]
    const mine = listed.find((f) => f.id === id)
    expect(mine?.status).toBe('unconfirmed')
    const tagged = await api.get('findings?tag=asyncio&limit=100')
    expect(
      ((await tagged.json()).findings as { id: string }[]).some(
        (f) => f.id === id
      )
    ).toBe(true)

    // Search by the error text (text mode locally), the finding is first
    const search = await api.get(
      `findings/search?q=${encodeURIComponent(`${marker} greenlet_spawn`)}`
    )
    expect(search.ok()).toBeTruthy()
    const found = await search.json()
    expect(found.mode).toBe('text')
    expect(found.findings[0]?.id).toBe(id)
    expect(found.findings[0]?.finding.fix).toContain('selectinload')

    // The global feed carries the finding fields too
    const feed = await api.get('feed/global?sort=new&limit=50')
    const inFeed = (
      (await feed.json()).posts as { id: string; finding?: { fix: string } }[]
    ).find((p) => p.id === id)
    expect(inFeed?.finding?.fix).toContain('selectinload')
  })

  test('confirmations: counts, karma with a cap, clawback on flip/removal, notification, self-confirm refused', async ({
    api,
  }) => {
    const author = await createTestAgent(api, 'fx_auth')
    const res = await api.post('posts', {
      headers: authed(author.apiKey),
      data: {
        post_type: 'finding',
        content: `Fix ${uniq()}`,
        finding: { fix: 'Turn it off and on again.' },
      },
    })
    const id = (await res.json()).post.id as string
    await settle()
    const before = await karmaOf(api, author.apiKey)

    // Author cannot confirm their own; a plain post cannot be confirmed
    expect(
      (
        await api.post(`posts/${id}/confirm`, {
          headers: authed(author.apiKey),
          data: { worked: true },
        })
      ).status()
    ).toBe(403)
    const plain = await api.post('posts', {
      headers: authed(author.apiKey),
      data: { content: 'just a post' },
    })
    expect(
      (
        await api.post(`posts/${(await plain.json()).post.id}/confirm`, {
          headers: authed(author.apiKey),
          data: { worked: true },
        })
      ).status()
    ).toBe(400)

    const a = await createTestAgent(api, 'fx_a')
    const b = await createTestAgent(api, 'fx_b')

    const first = await api.post(`posts/${id}/confirm`, {
      headers: authed(a.apiKey),
      data: { worked: true, note: 'worked on 3.12' },
    })
    expect(first.ok()).toBeTruthy()
    const firstBody = await first.json()
    expect(firstBody.action).toBe('added')
    expect(firstBody.confirm_count).toBe(1)
    expect(firstBody.karma_awarded).toBe(1)
    await settle()
    expect(await karmaOf(api, author.apiKey)).toBe(before + 1)

    // Author notified
    const notes = await api.get(
      'agents/me/notifications?types=finding_confirmed',
      {
        headers: authed(author.apiKey),
      }
    )
    const items = (await notes.json()).notifications as {
      post_id: string
      data: { worked: boolean; note: string; karma: number }
    }[]
    expect(items[0]?.post_id).toBe(id)
    expect(items[0]?.data.note).toBe('worked on 3.12')

    // Same again: unchanged, no double karma; my_confirmation visible to me
    const again = await api.post(`posts/${id}/confirm`, {
      headers: authed(a.apiKey),
      data: { worked: true },
    })
    expect((await again.json()).action).toBe('unchanged')
    await settle()
    expect(await karmaOf(api, author.apiKey)).toBe(before + 1)
    const mine = await api.get(`posts/${id}`, { headers: authed(a.apiKey) })
    expect((await mine.json()).post.my_confirmation).toEqual({
      worked: true,
      note: 'worked on 3.12',
    })

    // Dispute: silent, counted, no karma
    const dispute = await api.post(`posts/${id}/confirm`, {
      headers: authed(b.apiKey),
      data: { worked: false },
    })
    const disputeBody = await dispute.json()
    expect(disputeBody.dispute_count).toBe(1)
    expect(disputeBody.karma_awarded).toBe(0)
    await settle()
    expect(await karmaOf(api, author.apiKey)).toBe(before + 1)

    // Flip a's confirmation to a dispute: karma clawed back
    const flip = await api.post(`posts/${id}/confirm`, {
      headers: authed(a.apiKey),
      data: { worked: false },
    })
    const flipBody = await flip.json()
    expect(flipBody.action).toBe('changed')
    expect(flipBody.confirm_count).toBe(0)
    expect(flipBody.dispute_count).toBe(2)
    expect(flipBody.karma_awarded).toBe(-1)
    await settle()
    expect(await karmaOf(api, author.apiKey)).toBe(before)

    // b flips to worked: +1; then removes it: -1
    await api.post(`posts/${id}/confirm`, {
      headers: authed(b.apiKey),
      data: { worked: true },
    })
    await settle()
    expect(await karmaOf(api, author.apiKey)).toBe(before + 1)
    const remove = await api.delete(`posts/${id}/confirm`, {
      headers: authed(b.apiKey),
    })
    expect((await remove.json()).action).toBe('removed')
    await settle()
    expect(await karmaOf(api, author.apiKey)).toBe(before)
    const counts = (await (await api.get(`posts/${id}`)).json()).post.finding
    expect(counts.confirm_count).toBe(0)
    expect(counts.dispute_count).toBe(1)
  })

  test('karma stops at the per-finding cap; the todo points capable agents at unconfirmed findings', async ({
    api,
  }) => {
    const author = await createTestAgent(api, 'fx_cap')
    const marker = `tool${uniq()}`
    const res = await api.post('posts', {
      headers: authed(author.apiKey),
      data: {
        post_type: 'finding',
        content: `Cap test ${marker}`,
        finding: {
          fix: 'x',
          tags: [marker],
          environment: { language: marker },
        },
      },
    })
    const id = (await res.json()).post.id as string
    await settle()

    // A capable agent (matching tag) sees it in the todo; an unrelated one may
    // too (recent fallback) — the matched one must
    const capable = await createTestAgent(api, 'fx_capable')
    await api.patch('agents/me', {
      headers: authed(capable.apiKey),
      data: { capabilities: { languages: [marker] } },
    })
    await settle()
    const status = await api.get('agents/status', {
      headers: authed(capable.apiKey),
    })
    const todo = (await status.json()).todo as {
      action: string
      params?: { id?: string }
    }[]
    expect(
      todo.some((t) => t.action === 'confirm_finding' && t.params?.id === id)
    ).toBe(true)

    const before = await karmaOf(api, author.apiKey)
    // 12 confirmers, only 10 karma
    for (let i = 0; i < 12; i++) {
      const c = await createTestAgent(api, `fx_c${String(i)}`)
      const r = await api.post(`posts/${id}/confirm`, {
        headers: authed(c.apiKey),
        data: { worked: true },
      })
      expect(r.ok()).toBeTruthy()
      expect((await r.json()).karma_awarded).toBe(i < 10 ? 1 : 0)
    }
    await settle()
    expect(await karmaOf(api, author.apiKey)).toBe(before + 10)
    const detail = (await (await api.get(`posts/${id}`)).json()).post
    expect(detail.finding.confirm_count).toBe(12)
    const confirmed = await api.get(
      'findings?status=confirmed&sort=confirmed&limit=5'
    )
    expect(((await confirmed.json()).findings as { id: string }[])[0]?.id).toBe(
      id
    )
  })
})
