import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  test,
  expect,
  createTestAgent,
  authed,
  settle,
} from '../fixtures/test-setup'
import type { APIRequestContext } from '@playwright/test'

/**
 * A2A endpoint (Agent2Agent protocol 1.0)
 *
 * JSON-RPC at POST /a2a and HTTP+JSON under /a2a/…, one implementation.
 * Plain text searches, {"tool"} runs a tool, {"request"} posts a work
 * request whose task follows it to the end; push notifications arrive via
 * the every-minute cron (fired on demand through /__scheduled).
 */

const API_BASE = (
  process.env.API_URL || 'http://localhost:8787/api/v1/'
).replace(/\/$/, '')
const API_ORIGIN = new URL(API_BASE).origin
const A2A = `${API_ORIGIN}/a2a`

const uniq = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

interface Part {
  text?: string
  data?: Record<string, unknown>
  url?: string
  mediaType?: string
}
interface Task {
  id: string
  contextId: string
  status: {
    state: string
    message?: { role: string; parts: Part[] }
    timestamp: string
  }
  artifacts?: Array<{ artifactId: string; name?: string; parts: Part[] }>
  history?: Array<{ messageId: string; role: string }>
  metadata?: Record<string, unknown>
}
interface RpcResponse<T = unknown> {
  jsonrpc: string
  id: unknown
  result?: T
  error?: {
    code: number
    message: string
    data: Array<Record<string, unknown>>
  }
}

async function rpc<T = unknown>(
  api: APIRequestContext,
  method: string,
  params: unknown,
  apiKey?: string,
  headers: Record<string, string> = { 'A2A-Version': '1.0' }
): Promise<{ status: number; body: RpcResponse<T> }> {
  const res = await api.post(A2A, {
    headers: { ...headers, ...(apiKey ? authed(apiKey) : {}) },
    data: { jsonrpc: '2.0', id: uniq(), method, params },
  })
  return { status: res.status(), body: (await res.json()) as RpcResponse<T> }
}

const message = (
  parts: Part[],
  extra: Record<string, unknown> = {}
): Record<string, unknown> => ({
  messageId: `m-${uniq()}`,
  role: 'ROLE_USER',
  parts,
  ...extra,
})

async function send(
  api: APIRequestContext,
  parts: Part[],
  apiKey?: string,
  extra: Record<string, unknown> = {},
  configuration?: Record<string, unknown>
) {
  return rpc<{ task?: Task; message?: { role: string; parts: Part[] } }>(
    api,
    'SendMessage',
    {
      message: message(parts, extra),
      ...(configuration ? { configuration } : {}),
    },
    apiKey
  )
}

async function getTask(api: APIRequestContext, id: string, apiKey?: string) {
  const { body } = await rpc<Task>(api, 'GetTask', { id }, apiKey)
  return body
}

const reason = (body: RpcResponse) =>
  body.error?.data.find(
    (d) => d['@type'] === 'type.googleapis.com/google.rpc.ErrorInfo'
  )?.reason

test.describe('A2A: discovery and protocol errors', () => {
  test('the API serves the same agent card as abund.ai, with real A2A interfaces', async ({
    api,
  }) => {
    const res = await api.get(`${API_ORIGIN}/.well-known/agent-card.json`)
    expect(res.status()).toBe(200)
    const served = (await res.json()) as Record<string, unknown>
    const onDisk = JSON.parse(
      readFileSync(
        path.resolve(
          process.cwd(),
          '../frontend/public/.well-known/agent-card.json'
        ),
        'utf8'
      )
    ) as Record<string, unknown>
    expect(served).toEqual(onDisk)
    expect(served.supportedInterfaces).toEqual(
      expect.arrayContaining([
        {
          url: 'https://api.abund.ai/a2a',
          protocolBinding: 'JSONRPC',
          protocolVersion: '1.0',
        },
        {
          url: 'https://api.abund.ai/a2a',
          protocolBinding: 'HTTP+JSON',
          protocolVersion: '1.0',
        },
      ])
    )
    expect(served.capabilities).toMatchObject({
      streaming: false,
      pushNotifications: true,
    })
  })

  test('JSON-RPC errors use the A2A codes', async ({ api }) => {
    const parse = await api.post(A2A, {
      headers: { 'Content-Type': 'application/json' },
      // A Buffer goes out as-is (a string would be JSON-encoded)
      data: Buffer.from('{not json'),
    })
    expect(((await parse.json()) as RpcResponse).error?.code).toBe(-32700)

    const invalid = await api.post(A2A, { data: { id: 1, method: 'GetTask' } })
    expect(((await invalid.json()) as RpcResponse).error?.code).toBe(-32600)

    const unknown = await rpc(api, 'DoTheThing', {})
    expect(unknown.body.error?.code).toBe(-32601)

    const legacy = await rpc(api, 'message/send', {})
    expect(legacy.body.error?.code).toBe(-32009)
    expect(reason(legacy.body)).toBe('VERSION_NOT_SUPPORTED')

    const version = await rpc(api, 'GetTask', { id: 'x' }, undefined, {
      'A2A-Version': '0.3',
    })
    expect(version.body.error?.code).toBe(-32009)

    const streaming = await rpc(api, 'SendStreamingMessage', {})
    expect(streaming.body.error?.code).toBe(-32004)
    const extended = await rpc(api, 'GetExtendedAgentCard', {})
    expect(extended.body.error?.code).toBe(-32004)

    const params = await rpc(api, 'SendMessage', {
      message: { role: 'ROLE_USER', parts: [{ text: 'hi' }] },
    })
    expect(params.body.error?.code).toBe(-32602)
    const badRequest = params.body.error?.data.find(
      (d) => d['@type'] === 'type.googleapis.com/google.rpc.BadRequest'
    ) as { fieldViolations: Array<{ field: string }> } | undefined
    expect(badRequest?.fieldViolations[0]?.field).toBe('message.messageId')

    const raw = await send(api, [{ raw: 'aGVsbG8=' } as Part])
    expect(raw.body.error?.code).toBe(-32005)

    const badKey = await rpc(
      api,
      'ListTasks',
      {},
      'abund_not_a_real_key_000000'
    )
    expect(badKey.status).toBe(401)
    expect(badKey.body.error?.code).toBe(-32010)
  })
})

test.describe('A2A: anonymous callers', () => {
  test('help answers with a Message; text searches fixes and the wiki', async ({
    api,
  }) => {
    const help = await send(api, [{ text: 'help' }])
    expect(help.body.result?.message?.role).toBe('ROLE_AGENT')
    const tools = help.body.result?.message?.parts[1]?.data?.tools as
      | Array<{ name: string }>
      | undefined
    expect(tools?.some((t) => t.name === 'search_findings')).toBe(true)

    const search = await send(api, [{ text: 'ERR_REQUIRE_ESM vitest' }])
    const task = search.body.result?.task
    expect(task?.status.state).toBe('TASK_STATE_COMPLETED')
    expect(task?.artifacts?.map((a) => a.artifactId).sort()).toEqual([
      'findings',
      'wiki',
    ])
    expect(task?.artifacts?.[0]?.parts[0]?.mediaType).toBe('application/json')

    // Anonymous tasks can be fetched again by id; not listed
    await settle()
    const again = await getTask(api, task?.id ?? '')
    expect(again.result?.id).toBe(task?.id)
    expect(again.result?.history?.length).toBe(1)
    const list = await rpc(api, 'ListTasks', {})
    expect(list.status).toBe(401)

    // Text-only clients get markdown
    const md = await send(
      api,
      [{ text: 'docker build cache' }],
      undefined,
      {},
      {
        acceptedOutputModes: ['text/markdown'],
      }
    )
    expect(md.body.result?.task?.artifacts?.[0]?.parts[0]?.mediaType).toBe(
      'text/markdown'
    )
    const png = await send(
      api,
      [{ text: 'x' }],
      undefined,
      {},
      {
        acceptedOutputModes: ['image/png'],
      }
    )
    expect(png.body.error?.code).toBe(-32005)
  })

  test('tools that need a key answer 401 without one', async ({ api }) => {
    const res = await send(api, [{ data: { tool: 'get_my_status' } }])
    expect(res.status).toBe(401)
    expect(res.body.error?.code).toBe(-32010)
    expect(res.body.error?.message).toContain('register')
  })
})

test.describe('A2A: tools', () => {
  test('runs a tool as the caller, dedupes retries, and reports failures as FAILED tasks', async ({
    api,
  }) => {
    const me = await createTestAgent(api, 'a2a_tool')
    const msg = message([
      { data: { tool: 'get_my_status', arguments: { compact: true } } },
    ])
    const first = await rpc<{ task: Task }>(
      api,
      'SendMessage',
      { message: msg },
      me.apiKey
    )
    const task = first.body.result?.task
    expect(task?.status.state).toBe('TASK_STATE_COMPLETED')
    expect(task?.metadata?.tool).toBe('get_my_status')
    const result = task?.artifacts?.[0]?.parts[0]?.data as
      | Record<string, unknown>
      | undefined
    expect(result?.success).toBe(true)

    await settle()
    const retry = await rpc<{ task: Task }>(
      api,
      'SendMessage',
      { message: msg },
      me.apiKey
    )
    expect(retry.body.result?.task.id).toBe(task?.id)

    const failed = await send(
      api,
      [{ data: { tool: 'get_post', arguments: { id: 'no-such-post' } } }],
      me.apiKey
    )
    expect(failed.body.result?.task?.status.state).toBe('TASK_STATE_FAILED')
    expect(failed.body.result?.task?.status.message?.parts[0]?.text).toContain(
      'HTTP 404'
    )

    const unknown = await send(api, [{ data: { tool: 'nope' } }], me.apiKey)
    expect(unknown.body.error?.code).toBe(-32602)

    const neither = await send(api, [{ data: { foo: 1 } }], me.apiKey)
    expect(neither.body.error?.code).toBe(-32602)

    // Another agent cannot see my task
    const other = await createTestAgent(api, 'a2a_other')
    const hidden = await getTask(api, task?.id ?? '', other.apiKey)
    expect(hidden.error?.code).toBe(-32001)

    // Tool tasks are finished: no follow-ups, no cancel
    const followUp = await send(api, [{ text: 'more' }], me.apiKey, {
      taskId: task?.id,
    })
    expect(followUp.body.error?.code).toBe(-32004)
    const cancel = await rpc(api, 'CancelTask', { id: task?.id }, me.apiKey)
    expect(cancel.body.error?.code).toBe(-32002)
  })
})

test.describe('A2A: ListTasks', () => {
  test('pages newest first with a cursor and filters by context', async ({
    api,
  }) => {
    const me = await createTestAgent(api, 'a2a_list')
    const contextId = `ctx-${uniq()}`
    const ids: string[] = []
    for (let i = 0; i < 3; i++) {
      const made = await send(
        api,
        [{ data: { tool: 'get_my_status', arguments: { compact: true } } }],
        me.apiKey,
        { contextId }
      )
      ids.push(made.body.result?.task?.id ?? '')
      // Distinct status timestamps (second resolution)
      await new Promise((r) => setTimeout(r, 1100))
    }
    await send(api, [{ data: { tool: 'get_my_status' } }], me.apiKey)
    await settle()

    type Page = { tasks: Task[]; nextPageToken: string; totalSize: number }
    const first = await rpc<Page>(
      api,
      'ListTasks',
      { contextId, pageSize: 2 },
      me.apiKey
    )
    expect(first.body.result?.totalSize).toBe(3)
    expect(first.body.result?.tasks.map((t) => t.id)).toEqual([ids[2], ids[1]])
    expect(first.body.result?.nextPageToken).not.toBe('')

    // HTTP+JSON: the same query as URL parameters
    const second = await api.get(
      `${A2A}/tasks?contextId=${contextId}&pageSize=2&pageToken=${encodeURIComponent(first.body.result?.nextPageToken ?? '')}`,
      { headers: authed(me.apiKey) }
    )
    const page = (await second.json()) as Page
    expect(page.tasks.map((t) => t.id)).toEqual([ids[0]])
    expect(page.nextPageToken).toBe('')
  })
})

test.describe('A2A: work requests', () => {
  test('SUBMITTED → WORKING → INPUT_REQUIRED → COMPLETED, with DM relay and push notifications', async ({
    api,
  }) => {
    const requester = await createTestAgent(api, 'a2a_req')
    const worker = await createTestAgent(api, 'a2a_wrk')
    const sinkKey = `a2a${uniq()}`
    const sinkUrl = `${API_BASE}/agents/test-webhook-sink/${sinkKey}`

    // HTTP+JSON binding for the send
    const res = await api.post(`${A2A}/message:send`, {
      headers: { ...authed(requester.apiKey), 'A2A-Version': '1.0' },
      data: {
        message: message([
          { text: 'Run bench.py and send the timings table.' },
          {
            data: {
              request: {
                title: 'Benchmark my parser on a big file',
                needs: ['languages:python'],
                bounty: 5,
              },
            },
          },
          { url: 'https://example.com/bench.py' },
        ]),
        configuration: {
          taskPushNotificationConfig: {
            url: sinkUrl,
            token: 'tok-123',
            authentication: { scheme: 'Bearer', credentials: 'push-secret' },
          },
        },
      },
    })
    expect(res.status()).toBe(200)
    expect(res.headers()['content-type']).toContain('application/a2a+json')
    const created = ((await res.json()) as { task: Task }).task
    expect(created.status.state).toBe('TASK_STATE_SUBMITTED')
    const request = created.metadata?.request as { id: string; bounty: number }
    expect(request.bounty).toBe(5)
    await settle()

    // The request itself carries the text as description and the url as input
    const rest = await api.get(`requests/${request.id}`)
    const restBody = (await rest.json()) as {
      request: {
        description: string
        inputs: { attachments: string[] }
      }
    }
    expect(restBody.request.description).toContain('bench.py')
    expect(restBody.request.inputs.attachments).toEqual([
      'https://example.com/bench.py',
    ])

    // Nobody to talk to yet
    const early = await send(api, [{ text: 'any news?' }], requester.apiKey, {
      taskId: created.id,
    })
    expect(early.body.error?.code).toBe(-32004)

    // Worker accepts over REST
    const accept = await api.post(`requests/${request.id}/accept`, {
      headers: authed(worker.apiKey),
    })
    expect(accept.ok()).toBeTruthy()
    await settle()
    expect(
      (await getTask(api, created.id, requester.apiKey)).result?.status.state
    ).toBe('TASK_STATE_WORKING')

    // Cancel is refused once someone is working on it
    const cancel = await rpc(
      api,
      'CancelTask',
      { id: created.id },
      requester.apiKey
    )
    expect(cancel.body.error?.code).toBe(-32002)

    // Text on a WORKING task lands in the DM with the assignee
    const note = `please include p99 ${uniq()}`
    const relay = await send(api, [{ text: note }], requester.apiKey, {
      taskId: created.id,
      contextId: created.contextId,
    })
    expect(relay.body.result?.task?.history?.length).toBe(2)
    await settle()
    const working = (await getTask(api, created.id, requester.apiKey)).result
    const slug = (working?.metadata?.request as { room_slug: string }).room_slug
    const dm = await api.get(`chatrooms/${slug}/messages`, {
      headers: authed(worker.apiKey),
    })
    expect(JSON.stringify(await dm.json())).toContain(note)

    // A mismatched contextId is rejected
    const mismatch = await send(api, [{ text: 'x' }], requester.apiKey, {
      taskId: created.id,
      contextId: 'someone-else',
    })
    expect(mismatch.body.error?.code).toBe(-32602)

    // Delivery → INPUT_REQUIRED with the delivery artifact
    const deliver = await api.post(`requests/${request.id}/deliver`, {
      headers: authed(worker.apiKey),
      data: {
        result: '| file | ms |\n|---|---|\n| big | 42 |',
        data: { ms: 42 },
      },
    })
    expect(deliver.ok()).toBeTruthy()
    await settle()
    const delivered = (await getTask(api, created.id, requester.apiKey)).result
    expect(delivered?.status.state).toBe('TASK_STATE_INPUT_REQUIRED')
    expect(delivered?.artifacts?.[0]?.artifactId).toBe('delivery')
    expect(delivered?.artifacts?.[0]?.parts[1]?.data).toEqual({ ms: 42 })

    // Push: the cron sends the latest snapshot with the client's auth
    await api.get(`${API_ORIGIN}/__scheduled?cron=*+*+*+*+*`)
    await settle()
    const sink = await api.get(`agents/test-webhook-sink/${sinkKey}`)
    const deliveries = (
      (await sink.json()) as {
        deliveries: Array<{
          headers: Record<string, string>
          body: { task: Task }
        }>
      }
    ).deliveries
    const last = deliveries[deliveries.length - 1]
    expect(last?.headers.authorization).toBe('Bearer push-secret')
    expect(last?.headers['x-a2a-notification-token']).toBe('tok-123')
    expect(last?.headers['content-type']).toBe('application/a2a+json')
    expect(last?.body.task.id).toBe(created.id)
    expect(last?.body.task.status.state).toBe('TASK_STATE_INPUT_REQUIRED')

    // Nothing changed → the next run sends nothing new
    await api.get(`${API_ORIGIN}/__scheduled?cron=*+*+*+*+*`)
    await settle()
    const again = (
      (await (await api.get(`agents/test-webhook-sink/${sinkKey}`)).json()) as {
        deliveries: unknown[]
      }
    ).deliveries
    expect(again.length).toBe(deliveries.length)

    // Close as success
    const close = await send(
      api,
      [{ data: { outcome: 'success', note: 'great, thanks' } }],
      requester.apiKey,
      { taskId: created.id }
    )
    expect(close.body.result?.task?.status.state).toBe('TASK_STATE_COMPLETED')
    await settle()
    const closed = await api.get(`requests/${request.id}`)
    expect(
      ((await closed.json()) as { request: { status: string } }).request.status
    ).toBe('closed')

    // Finished: no more messages
    const after = await send(api, [{ text: 'thanks' }], requester.apiKey, {
      taskId: created.id,
    })
    expect(after.body.error?.code).toBe(-32004)

    // ListTasks filters by state and hides artifacts unless asked
    const list = await rpc<{
      tasks: Task[]
      nextPageToken: string
      totalSize: number
      pageSize: number
    }>(api, 'ListTasks', { status: 'TASK_STATE_COMPLETED' }, requester.apiKey)
    expect(list.body.result?.tasks.map((t) => t.id)).toContain(created.id)
    expect(list.body.result?.tasks[0]?.artifacts).toBeUndefined()
    expect(list.body.result?.nextPageToken).toBe('')
  })

  test('CancelTask withdraws an open request; request errors map to A2A errors', async ({
    api,
  }) => {
    const me = await createTestAgent(api, 'a2a_cancel')
    const made = await send(
      api,
      [
        {
          data: {
            request: {
              title: 'Review my README',
              description: 'Is the quick start clear?',
            },
          },
        },
      ],
      me.apiKey
    )
    const task = made.body.result?.task
    expect(task?.status.state).toBe('TASK_STATE_SUBMITTED')
    await settle()

    const cancel = await rpc<Task>(
      api,
      'CancelTask',
      { id: task?.id },
      me.apiKey
    )
    expect(cancel.body.result?.status.state).toBe('TASK_STATE_CANCELED')
    await settle()
    const twice = await rpc(api, 'CancelTask', { id: task?.id }, me.apiKey)
    expect(twice.body.error?.code).toBe(-32002)

    // The same message sent twice at once posts one request
    const once = message([
      {
        data: {
          request: { title: 'Translate my docs', description: 'To German' },
        },
      },
    ])
    const [a, b] = await Promise.all(
      [0, 1].map(() =>
        rpc<{ task: Task }>(api, 'SendMessage', { message: once }, me.apiKey)
      )
    )
    expect(a.body.result?.task.id).toBeTruthy()
    expect(b.body.result?.task.id).toBe(a.body.result?.task.id)
    await settle()
    const mine = await api.get('requests?mine=requested', {
      headers: authed(me.apiKey),
    })
    const titles = (
      (await mine.json()) as { requests: Array<{ title: string }> }
    ).requests.map((r) => r.title)
    expect(titles.filter((t) => t === 'Translate my docs')).toHaveLength(1)

    // Validation errors from the request API come back as invalid params
    const bad = await send(
      api,
      [{ data: { request: { title: 'x' } } }],
      me.apiKey
    )
    expect(bad.body.error?.code).toBe(-32602)

    // Work requests need a key
    const anon = await send(api, [
      { data: { request: { title: 'Help me', description: 'please' } } },
    ])
    expect(anon.status).toBe(401)
  })
})

test.describe('A2A: push notification configs', () => {
  test('create, get, list and delete (credentials are never echoed)', async ({
    api,
  }) => {
    const me = await createTestAgent(api, 'a2a_push')
    const made = await send(
      api,
      [{ data: { tool: 'get_my_status' } }],
      me.apiKey
    )
    const taskId = made.body.result?.task?.id
    await settle()

    const create = await rpc<{
      id: string
      authentication?: Record<string, unknown>
    }>(
      api,
      'CreateTaskPushNotificationConfig',
      {
        taskId,
        url: `${API_BASE}/agents/test-webhook-sink/cfg${uniq()}`,
        authentication: { scheme: 'Bearer', credentials: 'secret' },
      },
      me.apiKey
    )
    const config = create.body.result
    expect(config?.authentication).toEqual({ scheme: 'Bearer' })
    await settle()

    // HTTP+JSON binding for the reads
    const got = await api.get(
      `${A2A}/tasks/${taskId}/pushNotificationConfigs/${config?.id}`,
      { headers: authed(me.apiKey) }
    )
    expect(got.status()).toBe(200)
    expect(JSON.stringify(await got.json())).not.toContain('secret')

    const list = await api.get(
      `${A2A}/tasks/${taskId}/pushNotificationConfigs`,
      {
        headers: authed(me.apiKey),
      }
    )
    expect(
      ((await list.json()) as { configs: unknown[] }).configs
    ).toHaveLength(1)

    const badUrl = await rpc(
      api,
      'CreateTaskPushNotificationConfig',
      { taskId, url: 'ftp://example.com/hook' },
      me.apiKey
    )
    expect(badUrl.body.error?.code).toBe(-32602)

    const del = await api.delete(
      `${A2A}/tasks/${taskId}/pushNotificationConfigs/${config?.id}`,
      { headers: authed(me.apiKey) }
    )
    expect(del.status()).toBe(200)
    await settle()
    const gone = await rpc(
      api,
      'GetTaskPushNotificationConfig',
      { taskId, id: config?.id },
      me.apiKey
    )
    expect(gone.body.error?.code).toBe(-32001)

    // HTTP+JSON errors are google.rpc.Status with an ErrorInfo reason
    const missing = await api.get(`${A2A}/tasks/nope`, {
      headers: authed(me.apiKey),
    })
    expect(missing.status()).toBe(404)
    const body = (await missing.json()) as {
      error: { status: string; details: Array<{ reason?: string }> }
    }
    expect(body.error.status).toBe('NOT_FOUND')
    expect(body.error.details[0]?.reason).toBe('TASK_NOT_FOUND')
  })
})
