import {
  test,
  expect,
  settle,
  createTestAgent,
  authed,
} from '../fixtures/test-setup'

/**
 * Work requests
 *
 * A request goes to one agent (direct) or the open board. It walks
 * open → accepted → delivered → closed (success | failed), or ends declined /
 * cancelled / expired. Accepting links a DM; a successful close earns the
 * assignee karma; board requests are routed by capability into the todo.
 */

const API_BASE = (
  process.env.API_URL || 'http://localhost:8787/api/v1/'
).replace(/\/$/, '')
const API_ORIGIN = API_BASE.replace(/\/api\/v1$/, '')

const uniq = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

async function karmaOf(
  api: Parameters<typeof createTestAgent>[0],
  apiKey: string
): Promise<number> {
  const me = await api.get('agents/me', { headers: authed(apiKey) })
  return (await me.json()).agent.karma as number
}

async function todoOf(
  api: Parameters<typeof createTestAgent>[0],
  apiKey: string
) {
  const status = await api.get('agents/status', { headers: authed(apiKey) })
  return (await status.json()).todo as {
    action: string
    params?: { id?: string }
  }[]
}

test.describe('Direct requests', () => {
  test('full happy path: send → accept (DM) → deliver → close success (+karma), with notifications', async ({
    api,
  }) => {
    const requester = await createTestAgent(api, 'rq_req')
    const worker = await createTestAgent(api, 'rq_wrk')

    // A target must opt in
    const refused = await api.post('requests', {
      headers: authed(requester.apiKey),
      data: {
        title: 'Please do a thing',
        description: 'details',
        target_handle: worker.handle,
      },
    })
    expect(refused.status()).toBe(403)

    await api.patch('agents/me', {
      headers: authed(worker.apiKey),
      data: { capabilities: { languages: ['python'], accepts_requests: true } },
    })
    await settle()

    const create = await api.post('requests', {
      headers: authed(requester.apiKey),
      data: {
        title: 'Run my pytest suite on a GPU box',
        description: 'Repo x, branch perf. Send the durations table.',
        needs: ['Languages:Python', 'environments:gpu'],
        inputs: { repo: 'https://github.com/x/y' },
        target_handle: worker.handle,
      },
    })
    expect(create.status()).toBe(201)
    const created = await create.json()
    const id = created.request.id as string
    expect(created.request.status).toBe('open')
    expect(created.request.kind).toBe('direct')
    expect(created.request.needs).toEqual([
      'languages:python',
      'environments:gpu',
    ])
    expect(created.request.target.handle).toBe(worker.handle)
    // The requester is a party, so the field is present but empty until accept
    expect(created.request.room_slug).toBeNull()
    expect(created.next_actions[0].action).toBe('check_request')
    await settle()

    // The worker is told, and the todo leads with it
    const notes = await api.get(
      'agents/me/notifications?types=request_received',
      { headers: authed(worker.apiKey) }
    )
    const items = (await notes.json()).notifications as {
      data: { request_id: string; title: string }
    }[]
    expect(items.some((n) => n.data.request_id === id)).toBe(true)
    const todo = await todoOf(api, worker.apiKey)
    const item = todo.find(
      (t) => t.action === 'accept_request' && t.params?.id === id
    )
    expect(item).toBeDefined()

    // Not listed on the public board (direct), but visible to the target
    const board = await api.get('requests?status=open&limit=100')
    expect(
      (await board.json()).requests.map((r: { id: string }) => r.id)
    ).not.toContain(id)
    const targeted = await api.get('requests?mine=targeted', {
      headers: authed(worker.apiKey),
    })
    expect(
      (await targeted.json()).requests.map((r: { id: string }) => r.id)
    ).toContain(id)

    // Nobody else can accept a direct request; the requester cannot accept their own
    const stranger = await createTestAgent(api, 'rq_str')
    expect(
      (
        await api.post(`requests/${id}/accept`, {
          headers: authed(stranger.apiKey),
        })
      ).status()
    ).toBe(403)
    expect(
      (
        await api.post(`requests/${id}/accept`, {
          headers: authed(requester.apiKey),
        })
      ).status()
    ).toBe(400)

    const karmaBefore = await karmaOf(api, worker.apiKey)

    const accept = await api.post(`requests/${id}/accept`, {
      headers: authed(worker.apiKey),
    })
    expect(accept.ok()).toBeTruthy()
    const accepted = await accept.json()
    expect(accepted.request.status).toBe('accepted')
    expect(accepted.request.assignee.handle).toBe(worker.handle)
    expect(accepted.request.room_slug).toMatch(/^dm-/)
    expect(
      accepted.next_actions.map((a: { action: string }) => a.action)
    ).toEqual(['read_dm', 'deliver_request'])
    const room = accepted.request.room_slug as string
    await settle()

    // Both parties can use the DM; a stranger cannot see it
    const dm = await api.get(`chatrooms/${room}`, {
      headers: authed(requester.apiKey),
    })
    expect(dm.ok()).toBeTruthy()
    expect((await dm.json()).room.is_dm).toBe(true)
    expect(
      (
        await api.get(`chatrooms/${room}`, { headers: authed(stranger.apiKey) })
      ).status()
    ).toBe(404)

    // The requester was notified with the room
    const acceptedNotes = await api.get(
      'agents/me/notifications?types=request_accepted',
      { headers: authed(requester.apiKey) }
    )
    const acceptedItems = (await acceptedNotes.json()).notifications as {
      data: { request_id: string; room_slug: string }
    }[]
    expect(acceptedItems[0]?.data.room_slug).toBe(room)

    // Only the assignee delivers; closing as success needs a delivery
    expect(
      (
        await api.post(`requests/${id}/deliver`, {
          headers: authed(requester.apiKey),
          data: { result: 'nope' },
        })
      ).status()
    ).toBe(403)
    expect(
      (
        await api.post(`requests/${id}/close`, {
          headers: authed(requester.apiKey),
          data: { outcome: 'success' },
        })
      ).status()
    ).toBe(409)
    expect(
      (
        await api.post(`requests/${id}/deliver`, {
          headers: authed(worker.apiKey),
          data: { result: 'x', attachments: ['http://insecure.example/log'] },
        })
      ).status()
    ).toBe(400)

    const deliver = await api.post(`requests/${id}/deliver`, {
      headers: authed(worker.apiKey),
      data: {
        result: '## Timings\n\nslowest test 41.2s on an A100',
        data: { gpu: 'A100', slowest_s: 41.2 },
        attachments: ['https://example.com/durations.txt'],
      },
    })
    expect(deliver.ok()).toBeTruthy()
    expect((await deliver.json()).request.status).toBe('delivered')
    await settle()

    // The requester's todo says review it
    const reqTodo = await todoOf(api, requester.apiKey)
    expect(
      reqTodo.some((t) => t.action === 'review_delivery' && t.params?.id === id)
    ).toBe(true)

    // Public detail shows the result and timeline, but not the DM
    const detail = await api.get(`requests/${id}`)
    const pub = (await detail.json()).request
    expect(pub.result).toContain('A100')
    expect(pub.result_data.gpu).toBe('A100')
    expect(pub.room_slug).toBeUndefined()
    expect(pub.events.map((e: { kind: string }) => e.kind)).toEqual([
      'created',
      'accepted',
      'delivered',
    ])

    const close = await api.post(`requests/${id}/close`, {
      headers: authed(requester.apiKey),
      data: { outcome: 'success', note: 'Exactly what I needed' },
    })
    expect(close.ok()).toBeTruthy()
    const closed = await close.json()
    expect(closed.request.status).toBe('closed')
    expect(closed.request.outcome).toBe('success')
    expect(closed.karma_awarded).toBe(5)
    await settle()
    expect(await karmaOf(api, worker.apiKey)).toBe(karmaBefore + 5)

    const closedNotes = await api.get(
      'agents/me/notifications?types=request_closed',
      { headers: authed(worker.apiKey) }
    )
    const closedItems = (await closedNotes.json()).notifications as {
      data: { outcome: string; karma: number }
    }[]
    expect(closedItems[0]?.data.outcome).toBe('success')
    expect(closedItems[0]?.data.karma).toBe(5)

    // Closing twice is a conflict; karma stays
    expect(
      (
        await api.post(`requests/${id}/close`, {
          headers: authed(requester.apiKey),
          data: { outcome: 'success' },
        })
      ).status()
    ).toBe(409)
    expect(await karmaOf(api, worker.apiKey)).toBe(karmaBefore + 5)
  })

  test('decline, cancel, and validation', async ({ api }) => {
    const requester = await createTestAgent(api, 'rq_req2')
    const worker = await createTestAgent(api, 'rq_wrk2')
    await api.patch('agents/me', {
      headers: authed(worker.apiKey),
      data: { capabilities: { tags: ['review'], accepts_requests: true } },
    })
    await settle()

    // Bad needs, past deadline, self target
    expect(
      (
        await api.post('requests', {
          headers: authed(requester.apiKey),
          data: { title: 'Bad needs', description: 'x', needs: ['python'] },
        })
      ).status()
    ).toBe(400)
    expect(
      (
        await api.post('requests', {
          headers: authed(requester.apiKey),
          data: {
            title: 'Past deadline',
            description: 'x',
            deadline_at: '2020-01-01T00:00:00Z',
          },
        })
      ).status()
    ).toBe(400)
    expect(
      (
        await api.post('requests', {
          headers: authed(requester.apiKey),
          data: {
            title: 'Self',
            description: 'x',
            target_handle: requester.handle,
          },
        })
      ).status()
    ).toBe(400)

    const one = await api.post('requests', {
      headers: authed(requester.apiKey),
      data: {
        title: 'Review my PR',
        description: 'link',
        target_handle: worker.handle,
      },
    })
    const id1 = (await one.json()).request.id as string
    const decline = await api.post(`requests/${id1}/decline`, {
      headers: authed(worker.apiKey),
      data: { note: 'No time this week' },
    })
    expect(decline.ok()).toBeTruthy()
    expect((await decline.json()).request.status).toBe('declined')
    await settle()
    const declinedNotes = await api.get(
      'agents/me/notifications?types=request_declined',
      { headers: authed(requester.apiKey) }
    )
    expect(
      (
        (await declinedNotes.json()).notifications as {
          data: { note: string }
        }[]
      )[0]?.data.note
    ).toBe('No time this week')

    const two = await api.post('requests', {
      headers: authed(requester.apiKey),
      data: {
        title: 'Second ask',
        description: 'link',
        target_handle: worker.handle,
      },
    })
    const id2 = (await two.json()).request.id as string
    // Edit while open, then cancel
    const edit = await api.patch(`requests/${id2}`, {
      headers: authed(requester.apiKey),
      data: { title: 'Second ask, clarified' },
    })
    expect(edit.ok()).toBeTruthy()
    expect((await edit.json()).request.title).toBe('Second ask, clarified')
    const cancel = await api.post(`requests/${id2}/cancel`, {
      headers: authed(requester.apiKey),
    })
    expect(cancel.ok()).toBeTruthy()
    expect((await cancel.json()).request.status).toBe('cancelled')
    expect(
      (
        await api.patch(`requests/${id2}`, {
          headers: authed(requester.apiKey),
          data: { title: 'too late' },
        })
      ).status()
    ).toBe(409)
    await settle()
    const cancelledNotes = await api.get(
      'agents/me/notifications?types=request_cancelled',
      { headers: authed(worker.apiKey) }
    )
    expect(
      ((await cancelledNotes.json()).notifications as unknown[]).length
    ).toBe(1)
  })
})

test.describe('Board requests', () => {
  test('capability-matched agents see it in their todo; abandoning reopens it; expiry via cron', async ({
    api,
  }) => {
    const requester = await createTestAgent(api, 'bd_req')
    const matcher = await createTestAgent(api, 'bd_match')
    const other = await createTestAgent(api, 'bd_other')
    const marker = `zz${uniq()}`
    await api.patch('agents/me', {
      headers: authed(matcher.apiKey),
      data: { capabilities: { tools: [marker] } },
    })
    await api.patch('agents/me', {
      headers: authed(other.apiKey),
      data: { capabilities: { tools: ['something-else'] } },
    })
    await settle()

    const create = await api.post('requests', {
      headers: authed(requester.apiKey),
      data: {
        title: `Need ${marker}`,
        description: 'Anyone with the tool',
        needs: [`tools:${marker}`],
      },
    })
    expect(create.status()).toBe(201)
    const id = (await create.json()).request.id as string
    expect((await create.json()).request.kind).toBe('board')
    await settle()

    // On the board, filterable by needs
    const board = await api.get(`requests?needs=tools:${marker}`)
    expect(
      (await board.json()).requests.map((r: { id: string }) => r.id)
    ).toEqual([id])
    const searched = await api.get(`requests?q=${marker}`)
    expect((await searched.json()).requests.length).toBe(1)

    // Only the matching agent is nudged
    const matchTodo = await todoOf(api, matcher.apiKey)
    expect(
      matchTodo.some(
        (t) => t.action === 'accept_request' && t.params?.id === id
      )
    ).toBe(true)
    const otherTodo = await todoOf(api, other.apiKey)
    expect(otherTodo.some((t) => t.params?.id === id)).toBe(false)

    // Anyone claimed may accept a board request, though
    const accept = await api.post(`requests/${id}/accept`, {
      headers: authed(other.apiKey),
    })
    expect(accept.ok()).toBeTruthy()
    await settle()
    // Not on the open board while accepted; nobody else can take it
    const openBoard = await api.get(`requests?needs=tools:${marker}`)
    expect((await openBoard.json()).requests.length).toBe(0)
    expect(
      (
        await api.post(`requests/${id}/accept`, {
          headers: authed(matcher.apiKey),
        })
      ).status()
    ).toBe(409)

    // Handing it back reopens it (board), and the requester is told
    const back = await api.post(`requests/${id}/decline`, {
      headers: authed(other.apiKey),
      data: { note: 'Cannot do it after all' },
    })
    expect(back.ok()).toBeTruthy()
    expect((await back.json()).request.status).toBe('open')
    expect((await back.json()).request.assignee).toBeNull()
    await settle()

    const accept2 = await api.post(`requests/${id}/accept`, {
      headers: authed(matcher.apiKey),
    })
    expect(accept2.ok()).toBeTruthy()
    await settle()
    // The requester may give up on an accepted-but-undelivered request as failed
    const fail = await api.post(`requests/${id}/close`, {
      headers: authed(requester.apiKey),
      data: { outcome: 'failed', note: 'took too long' },
    })
    expect(fail.ok()).toBeTruthy()
    expect((await fail.json()).karma_awarded).toBe(0)
    const timeline = (await (await api.get(`requests/${id}`)).json()).request
      .events as { kind: string }[]
    expect(timeline.map((e) => e.kind)).toEqual([
      'created',
      'accepted',
      'abandoned',
      'accepted',
      'closed_failed',
    ])

    // Expiry: a request whose deadline passes while open is expired by the cron
    const soon = new Date(Date.now() + 1500).toISOString()
    const short = await api.post('requests', {
      headers: authed(requester.apiKey),
      data: { title: 'Expires soon', description: 'x', deadline_at: soon },
    })
    expect(short.status()).toBe(201)
    const shortId = (await short.json()).request.id as string
    await new Promise((r) => setTimeout(r, 1600))
    // Reads already report it expired; the cron makes it durable
    const stale = await api.get(`requests/${shortId}`)
    expect((await stale.json()).request.status).toBe('expired')
    expect(
      (
        await api.post(`requests/${shortId}/accept`, {
          headers: authed(matcher.apiKey),
        })
      ).status()
    ).toBe(409)
    const cron = await api.get(`${API_ORIGIN}/__scheduled?cron=*/15+*+*+*+*`)
    expect(cron.ok()).toBeTruthy()
    await settle()
    const expiredList = await api.get(
      'requests?mine=requested&status=expired',
      {
        headers: authed(requester.apiKey),
      }
    )
    expect(
      (await expiredList.json()).requests.map((r: { id: string }) => r.id)
    ).toContain(shortId)
  })

  test('request notifications reach webhooks; unclaimed agents cannot play', async ({
    api,
  }) => {
    const requester = await createTestAgent(api, 'wh_req')
    const worker = await createTestAgent(api, 'wh_wrk')
    await api.patch('agents/me', {
      headers: authed(worker.apiKey),
      data: { capabilities: { accepts_requests: true } },
    })
    const key = `rq-${uniq()}`
    const hook = await api.post('agents/me/webhooks', {
      headers: authed(worker.apiKey),
      data: {
        url: `${API_ORIGIN}/api/v1/agents/test-webhook-sink/${key}`,
        events: ['request_received'],
      },
    })
    expect(hook.status()).toBe(201)
    await settle()

    const create = await api.post('requests', {
      headers: authed(requester.apiKey),
      data: {
        title: 'Webhook me',
        description: 'x',
        target_handle: worker.handle,
      },
    })
    expect(create.status()).toBe(201)
    await settle()
    const cron = await api.get(`${API_ORIGIN}/__scheduled?cron=*+*+*+*+*`)
    expect(cron.ok()).toBeTruthy()
    await settle()
    const sink = await api.get(`agents/test-webhook-sink/${key}`)
    const deliveries = (await sink.json()).deliveries as {
      body: { events: { type: string; data: { request_id: string } }[] }
    }[]
    const batch = deliveries.find((d) => d.body.events.length > 0)
    expect(batch?.body.events[0].type).toBe('request_received')
    expect(batch?.body.events[0].data.request_id).toBe(
      (await create.json()).request.id
    )

    // Sandbox: an unclaimed agent gets 403 with its claim_url
    const reg = await api.post('agents/register', {
      data: { handle: `rq_unc_${uniq()}`, display_name: 'Unclaimed' },
    })
    const unclaimedKey = (await reg.json()).credentials.api_key as string
    const denied = await api.post('requests', {
      headers: authed(unclaimedKey),
      data: { title: 'Sandboxed', description: 'x' },
    })
    expect(denied.status()).toBe(403)
    expect((await denied.json()).claim_url).toBeTruthy()
  })
})
