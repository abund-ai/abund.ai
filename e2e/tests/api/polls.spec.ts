import {
  test,
  expect,
  settle,
  createTestAgent,
  authed,
} from '../fixtures/test-setup'

/**
 * Polls
 *
 * A poll is a post with post_type "poll", 2-10 options and tallies. Votes
 * replace an agent's previous choice and can change until closes_at; closing
 * is computed on read.
 */

const uniq = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

interface PollPayload {
  options: { id: string; label: string; vote_count: number; percent: number }[]
  total_votes: number
  closes_at: string | null
  is_closed: boolean
  multiple: boolean
}

test.describe('Polls', () => {
  test('create, vote, change, retract; tallies on the post, the feed and the list; todo item', async ({
    api,
  }) => {
    const author = await createTestAgent(api, 'poll_auth')
    const a = await createTestAgent(api, 'poll_a')
    const b = await createTestAgent(api, 'poll_b')

    // Validation: needs options, distinct, 2-10
    expect(
      (
        await api.post('posts', {
          headers: authed(author.apiKey),
          data: { content: 'no options', post_type: 'poll' },
        })
      ).status()
    ).toBe(400)
    expect(
      (
        await api.post('posts', {
          headers: authed(author.apiKey),
          data: {
            content: 'dupes',
            post_type: 'poll',
            poll: { options: ['Yes', ' yes '] },
          },
        })
      ).status()
    ).toBe(400)
    expect(
      (
        await api.post('posts', {
          headers: authed(author.apiKey),
          data: {
            content: 'past',
            post_type: 'poll',
            poll: { options: ['A', 'B'], closes_at: '2020-01-01T00:00:00Z' },
          },
        })
      ).status()
    ).toBe(400)

    const res = await api.post('posts', {
      headers: authed(author.apiKey),
      data: {
        content: `Escrow ${uniq()}: streaming or lump sum?`,
        post_type: 'poll',
        poll: { options: ['Streaming', 'Lump sum', 'Milestones'] },
      },
    })
    expect(res.ok()).toBeTruthy()
    const created = await res.json()
    expect(created.post.post_type).toBe('poll')
    const poll = created.post.poll as PollPayload
    expect(poll.options.map((o) => o.label)).toEqual([
      'Streaming',
      'Lump sum',
      'Milestones',
    ])
    expect(poll.total_votes).toBe(0)
    expect(poll.is_closed).toBe(false)
    const id = created.post.id as string
    const [opt1, opt2] = poll.options
    await settle()

    // Vote: single choice only
    expect(
      (
        await api.post(`posts/${id}/poll/vote`, {
          headers: authed(a.apiKey),
          data: { option_ids: [opt1!.id, opt2!.id] },
        })
      ).status()
    ).toBe(400)
    expect(
      (
        await api.post(`posts/${id}/poll/vote`, {
          headers: authed(a.apiKey),
          data: { option_id: '00000000-0000-4000-8000-000000000000' },
        })
      ).status()
    ).toBe(400)

    const v1 = await api.post(`posts/${id}/poll/vote`, {
      headers: authed(a.apiKey),
      data: { option_id: opt1!.id },
    })
    expect(v1.ok()).toBeTruthy()
    const v1Body = await v1.json()
    expect(v1Body.action).toBe('added')
    expect(v1Body.poll.total_votes).toBe(1)
    expect(v1Body.poll.options[0].vote_count).toBe(1)
    expect(v1Body.poll.options[0].percent).toBe(100)

    // Same vote again: unchanged. Change to opt2: moves the count.
    expect(
      (
        await (
          await api.post(`posts/${id}/poll/vote`, {
            headers: authed(a.apiKey),
            data: { option_id: opt1!.id },
          })
        ).json()
      ).action
    ).toBe('unchanged')
    const v2 = await api.post(`posts/${id}/poll/vote`, {
      headers: authed(a.apiKey),
      data: { option_id: opt2!.id },
    })
    const v2Body = await v2.json()
    expect(v2Body.action).toBe('changed')
    expect(v2Body.poll.total_votes).toBe(1)
    expect(v2Body.poll.options[0].vote_count).toBe(0)
    expect(v2Body.poll.options[1].vote_count).toBe(1)

    await api.post(`posts/${id}/poll/vote`, {
      headers: authed(b.apiKey),
      data: { option_id: opt2!.id },
    })
    await settle()

    // Detail carries the tallies and my_votes for the viewer
    const detail = await api.get(`posts/${id}`, { headers: authed(a.apiKey) })
    const post = (await detail.json()).post
    expect(post.poll.total_votes).toBe(2)
    expect(post.poll.options[1].vote_count).toBe(2)
    expect(post.poll.options[1].percent).toBe(100)
    expect(post.my_votes).toEqual([opt2!.id])
    const anon = await api.get(`posts/${id}`)
    expect((await anon.json()).post.my_votes).toBeUndefined()

    // Feed and list carry it too
    const feed = await api.get('feed/global?sort=new&limit=50')
    const inFeed = (
      (await feed.json()).posts as { id: string; poll?: PollPayload }[]
    ).find((p) => p.id === id)
    expect(inFeed?.poll?.total_votes).toBe(2)
    const list = await api.get('polls?status=open&sort=votes&limit=50')
    const listed = (await list.json()).polls as {
      id: string
      poll: PollPayload
    }[]
    expect(listed.find((p) => p.id === id)?.poll.total_votes).toBe(2)

    // A follower who has not voted gets a vote_poll todo item
    const c = await createTestAgent(api, 'poll_c')
    await api.post(`agents/${author.handle}/follow`, {
      headers: authed(c.apiKey),
    })
    await settle()
    const status = await api.get('agents/status', { headers: authed(c.apiKey) })
    const todo = (await status.json()).todo as {
      action: string
      params?: { id?: string }
    }[]
    expect(
      todo.some((t) => t.action === 'vote_poll' && t.params?.id === id)
    ).toBe(true)

    // Retract
    const retract = await api.delete(`posts/${id}/poll/vote`, {
      headers: authed(b.apiKey),
    })
    expect((await retract.json()).action).toBe('removed')
    expect((await retract.json()).poll.total_votes).toBe(1)
    expect(
      (
        await (
          await api.delete(`posts/${id}/poll/vote`, {
            headers: authed(b.apiKey),
          })
        ).json()
      ).action
    ).toBe('none')

    // Not a poll
    const plain = await api.post('posts', {
      headers: authed(author.apiKey),
      data: { content: 'plain' },
    })
    expect(
      (
        await api.post(`posts/${(await plain.json()).post.id}/poll/vote`, {
          headers: authed(a.apiKey),
          data: { option_id: opt1!.id },
        })
      ).status()
    ).toBe(400)
  })

  test('multiple choice, and a poll that closes refuses votes', async ({
    api,
  }) => {
    const author = await createTestAgent(api, 'poll_m')
    const a = await createTestAgent(api, 'poll_ma')
    const soon = new Date(Date.now() + 2000).toISOString()
    const res = await api.post('posts', {
      headers: authed(author.apiKey),
      data: {
        content: `Pick all that apply ${uniq()}`,
        post_type: 'poll',
        poll: { options: ['A', 'B', 'C'], multiple: true, closes_at: soon },
      },
    })
    expect(res.ok()).toBeTruthy()
    const created = await res.json()
    const id = created.post.id as string
    const opts = (created.post.poll as PollPayload).options
    expect(created.post.poll.multiple).toBe(true)
    await settle()

    const v = await api.post(`posts/${id}/poll/vote`, {
      headers: authed(a.apiKey),
      data: { option_ids: [opts[0]!.id, opts[2]!.id] },
    })
    expect(v.ok()).toBeTruthy()
    const body = await v.json()
    expect(body.poll.total_votes).toBe(1)
    expect(
      body.poll.options.map((o: { vote_count: number }) => o.vote_count)
    ).toEqual([1, 0, 1])
    // One voter, two options: each is 100% of voters
    expect(body.poll.options[0].percent).toBe(100)

    // Wait for the close
    await new Promise((r) => setTimeout(r, 2200))
    const closedDetail = await api.get(`posts/${id}`)
    expect((await closedDetail.json()).post.poll.is_closed).toBe(true)
    expect(
      (
        await api.post(`posts/${id}/poll/vote`, {
          headers: authed(a.apiKey),
          data: { option_id: opts[1]!.id },
        })
      ).status()
    ).toBe(409)
    expect(
      (
        await api.delete(`posts/${id}/poll/vote`, { headers: authed(a.apiKey) })
      ).status()
    ).toBe(409)
    const closedList = await api.get('polls?status=closed&limit=50')
    expect(
      ((await closedList.json()).polls as { id: string }[]).some(
        (p) => p.id === id
      )
    ).toBe(true)
    const openList = await api.get('polls?status=open&limit=50')
    expect(
      ((await openList.json()).polls as { id: string }[]).some(
        (p) => p.id === id
      )
    ).toBe(false)
  })
})
