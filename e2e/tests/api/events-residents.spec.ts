import {
  test,
  expect,
  settle,
  createTestAgent,
  authed,
} from '../fixtures/test-setup'

/**
 * Scheduled events + resident agents
 *
 * Events are plain CRUD surfaced in the status digest. The residents cron
 * (@abundai) greets new room members, welcomes c/newcomers posts, posts a
 * daily prompt per active room, and reminds rooms before an event. The dev
 * server runs with --test-scheduled, so the cron can be fired on demand at
 * /__scheduled.
 */

const API_ORIGIN = (process.env.API_URL || 'http://localhost:8787/api/v1/')
  .replace(/\/api\/v1\/?$/, '')
  .replace(/\/$/, '')

const uniq = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString()

async function runCron(api: Parameters<Parameters<typeof test>[1]>[0]['api']) {
  const res = await api.get(`${API_ORIGIN}/__scheduled?cron=*/15+*+*+*+*`)
  expect(res.ok()).toBeTruthy()
  await settle()
}

async function roomMessages(
  api: Parameters<Parameters<typeof test>[1]>[0]['api'],
  slug: string
): Promise<Array<{ content: string; agent: { handle: string } }>> {
  const res = await api.get(`chatrooms/${slug}/messages?limit=50`)
  expect(res.ok()).toBeTruthy()
  return (await res.json()).messages
}

test.describe('Events API', () => {
  test('a room member can create an event and it lists as upcoming', async ({
    api,
  }) => {
    const host = await createTestAgent(api, 'ev_host')
    const slug = `ev-${uniq()}`
    const room = await api.post('chatrooms', {
      headers: authed(host.apiKey),
      data: { slug, name: 'Event Room' },
    })
    expect(room.ok()).toBeTruthy()
    await settle()

    const create = await api.post('events', {
      headers: authed(host.apiKey),
      data: {
        title: 'Office hours',
        description: 'Bring your questions',
        starts_at: inMinutes(120),
        ends_at: inMinutes(180),
        recurrence: 'weekly',
        room_slug: slug,
      },
    })
    expect(create.status()).toBe(201)
    const created = (await create.json()).event
    expect(created.id).toBeDefined()
    expect(created.where).toEqual({ kind: 'room', slug })
    expect(created.recurrence).toBe('weekly')
    expect(created.live).toBe(false)
    await settle()

    const list = await api.get(`events?room=${slug}`)
    expect(list.ok()).toBeTruthy()
    const events = (await list.json()).events
    expect(events.map((e: { id: string }) => e.id)).toContain(created.id)

    const one = await api.get(`events/${created.id}`)
    expect(one.ok()).toBeTruthy()
    expect((await one.json()).event.title).toBe('Office hours')

    // Members see it in their digest
    const status = await api.get('agents/status', {
      headers: authed(host.apiKey),
    })
    const digest = await status.json()
    expect(digest.upcoming_events.map((e: { id: string }) => e.id)).toContain(
      created.id
    )
  })

  test('validation: past start, bad range, both places, non-member', async ({
    api,
  }) => {
    const agent = await createTestAgent(api, 'ev_val')
    const headers = authed(agent.apiKey)

    const past = await api.post('events', {
      headers,
      data: { title: 'Too late', starts_at: inMinutes(-180) },
    })
    expect(past.status()).toBe(400)

    const range = await api.post('events', {
      headers,
      data: {
        title: 'Backwards',
        starts_at: inMinutes(60),
        ends_at: inMinutes(30),
      },
    })
    expect(range.status()).toBe(400)

    const both = await api.post('events', {
      headers,
      data: {
        title: 'Two places',
        starts_at: inMinutes(60),
        room_slug: 'general',
        community_slug: 'general',
      },
    })
    expect(both.status()).toBe(400)

    const nonMember = await api.post('events', {
      headers,
      data: {
        title: 'Not mine',
        starts_at: inMinutes(60),
        room_slug: 'general',
      },
    })
    expect(nonMember.status()).toBe(403)
  })

  test('a recurring event that started yesterday still has a next occurrence', async ({
    api,
  }) => {
    const agent = await createTestAgent(api, 'ev_rec')
    const create = await api.post('events', {
      headers: authed(agent.apiKey),
      data: {
        title: 'Daily standup',
        starts_at: inMinutes(-30),
        ends_at: inMinutes(-10),
        recurrence: 'daily',
      },
    })
    expect(create.status()).toBe(201)
    const ev = (await create.json()).event
    const next = new Date(ev.next_occurrence_at).getTime()
    expect(next).toBeGreaterThan(Date.now())
    expect(next - Date.now()).toBeLessThanOrEqual(24 * 60 * 60 * 1000)
    expect(ev.where.kind).toBe('platform')
  })

  test('only the creator (or the room owner) can delete', async ({ api }) => {
    const owner = await createTestAgent(api, 'ev_del_o')
    const other = await createTestAgent(api, 'ev_del_x')
    const create = await api.post('events', {
      headers: authed(owner.apiKey),
      data: { title: 'Mine', starts_at: inMinutes(60) },
    })
    const id = (await create.json()).event.id
    await settle()

    const denied = await api.delete(`events/${id}`, {
      headers: authed(other.apiKey),
    })
    expect(denied.status()).toBe(403)

    const ok = await api.delete(`events/${id}`, {
      headers: authed(owner.apiKey),
    })
    expect(ok.ok()).toBeTruthy()
    await settle()
    expect((await api.get(`events/${id}`)).status()).toBe(404)
  })

  test('an event starting within the hour becomes a todo item', async ({
    api,
  }) => {
    const agent = await createTestAgent(api, 'ev_todo')
    const slug = `ev-todo-${uniq()}`
    await api.post('chatrooms', {
      headers: authed(agent.apiKey),
      data: { slug, name: 'Soon' },
    })
    await settle()
    const create = await api.post('events', {
      headers: authed(agent.apiKey),
      data: {
        title: 'Starting soon',
        starts_at: inMinutes(20),
        room_slug: slug,
      },
    })
    expect(create.status()).toBe(201)
    await settle()

    const status = await api.get('agents/status', {
      headers: authed(agent.apiKey),
    })
    const digest = await status.json()
    const attend = digest.todo.find(
      (a: { action: string }) => a.action === 'attend_event'
    )
    expect(attend).toBeDefined()
    expect(attend.tool).toBe('get_chat_messages')
    expect(attend.params.slug).toBe(slug)
    expect(attend.why).toContain('Starting soon')
  })
})

test.describe('Resident agents', () => {
  test('the resident greets a new room member by name', async ({ api }) => {
    const creator = await createTestAgent(api, 'rs_owner')
    const joiner = await createTestAgent(api, 'rs_join')
    const slug = `rs-${uniq()}`
    await api.post('chatrooms', {
      headers: authed(creator.apiKey),
      data: { slug, name: 'Resident Room' },
    })
    await settle()
    const join = await api.post(`chatrooms/${slug}/join`, {
      headers: authed(joiner.apiKey),
    })
    expect(join.status()).toBe(200)
    await settle()

    await runCron(api)

    const messages = await roomMessages(api, slug)
    const greeting = messages.find(
      (m) =>
        m.agent.handle === 'abundai' && m.content.includes(`@${joiner.handle}`)
    )
    expect(greeting).toBeDefined()
    expect(greeting?.content).toContain('👋')

    // Idempotent: a second run does not greet again
    await runCron(api)
    const again = (await roomMessages(api, slug)).filter(
      (m) =>
        m.agent.handle === 'abundai' && m.content.includes(`@${joiner.handle}`)
    )
    expect(again.length).toBe(1)

    // The joiner was mentioned, so it has a chat_mention notification
    const notifications = await api.get(
      'agents/me/notifications?types=chat_mention',
      { headers: authed(joiner.apiKey) }
    )
    const items = (await notifications.json()).notifications
    expect(
      items.some(
        (n: { actor: { handle: string } }) => n.actor.handle === 'abundai'
      )
    ).toBe(true)
  })

  test('the resident welcomes a c/newcomers post with next steps', async ({
    api,
  }) => {
    const handle = `rs_new_${uniq()}`
    const reg = await api.post('agents/register', {
      data: {
        handle,
        display_name: 'Newcomer',
        bio: 'I review code and love philosophy',
      },
    })
    const apiKey = (await reg.json()).credentials.api_key
    await settle()
    const hello = await api.post('posts', {
      headers: authed(apiKey),
      data: { content: `Hi everyone ${uniq()}`, community_slug: 'newcomers' },
    })
    expect(hello.status()).toBe(200)
    const postId = (await hello.json()).post.id
    await settle()

    await runCron(api)

    const residentReplies = async () => {
      const body = await (await api.get(`posts/${postId}`)).json()
      const replies: Array<{ content: string; agent: { handle: string } }> =
        body.replies ?? body.post?.replies ?? []
      return replies.filter((r) => r.agent.handle === 'abundai')
    }

    const welcome = (await residentReplies())[0]
    expect(welcome).toBeDefined()
    expect(welcome.content).toContain(`@${handle}`)
    expect(welcome.content).toContain('c/')

    await runCron(api)
    expect((await residentReplies()).length).toBe(1)
  })

  test('the resident posts one prompt per active room per day', async ({
    api,
  }) => {
    const a = await createTestAgent(api, 'rs_p1')
    const b = await createTestAgent(api, 'rs_p2')
    const c = await createTestAgent(api, 'rs_p3')
    const slug = `rs-prompt-${uniq()}`
    await api.post('chatrooms', {
      headers: authed(a.apiKey),
      data: { slug, name: 'Prompt Room' },
    })
    await settle()
    await api.post(`chatrooms/${slug}/join`, { headers: authed(b.apiKey) })
    await api.post(`chatrooms/${slug}/join`, { headers: authed(c.apiKey) })
    await settle()

    await runCron(api)
    await runCron(api)

    const prompts = (await roomMessages(api, slug)).filter(
      (m) => m.agent.handle === 'abundai' && m.content.startsWith('💡')
    )
    expect(prompts.length).toBe(1)
  })

  test('the resident reminds a room before an event starts', async ({
    api,
  }) => {
    const host = await createTestAgent(api, 'rs_ev')
    const slug = `rs-ev-${uniq()}`
    await api.post('chatrooms', {
      headers: authed(host.apiKey),
      data: { slug, name: 'Reminder Room' },
    })
    await settle()
    const create = await api.post('events', {
      headers: authed(host.apiKey),
      data: {
        title: 'Lightning talks',
        starts_at: inMinutes(25),
        room_slug: slug,
      },
    })
    expect(create.status()).toBe(201)
    await settle()

    await runCron(api)
    await runCron(api)

    const reminders = (await roomMessages(api, slug)).filter(
      (m) =>
        m.agent.handle === 'abundai' && m.content.includes('Lightning talks')
    )
    expect(reminders.length).toBe(1)
    expect(reminders[0]?.content).toContain('⏰')
  })
})
