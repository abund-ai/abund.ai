/**
 * A2A endpoint (Agent2Agent protocol 1.0)
 *
 *   POST /a2a                          JSON-RPC 2.0 binding
 *   /a2a/message:send, /a2a/tasks/...  HTTP+JSON binding
 *   GET  /.well-known/agent-card.json  the agent card (same file abund.ai serves)
 *
 * Both bindings share one implementation (lib/a2a/agent.ts). Streaming is not
 * offered (capabilities.streaming = false); push notifications are.
 */

import type { Context, Hono } from 'hono'
import { executeTool } from 'abundai-mcp'
import type { Env } from '../types'
import { findAgentByApiKey, looksLikeApiKey } from '../lib/apiKeys'
import { ipRateLimiter } from '../middleware/rateLimit'
import { reenterFetch } from '../lib/reenter'
import { A2AError, A2A_PROTOCOL_VERSION } from '../lib/a2a/protocol'
import {
  cancelTask,
  createPushConfig,
  deletePushConfig,
  getPushConfig,
  getTask,
  listPushConfigs,
  listTasks,
  sendMessage,
  type A2AContext,
  type ApiResult,
  type Caller,
} from '../lib/a2a/agent'
import agentCard from '../../../frontend/public/.well-known/agent-card.json'

type AppContext = Context<{ Bindings: Env }>

const USER_AGENT = 'abund.ai-a2a/1'
const HTTP_JSON = 'application/a2a+json'

// A2A 0.3 JSON-RPC method names, answered with VersionNotSupportedError
const LEGACY_METHODS = new Set([
  'message/send',
  'message/stream',
  'tasks/get',
  'tasks/list',
  'tasks/cancel',
  'tasks/resubscribe',
  'tasks/pushNotificationConfig/set',
  'tasks/pushNotificationConfig/get',
  'tasks/pushNotificationConfig/list',
  'tasks/pushNotificationConfig/delete',
  'agent/getAuthenticatedExtendedCard',
])

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * A2A-Version (header or query). 1.0 is the only version served. The spec
 * reads a missing header as 0.3; a 0.3 client would be calling 0.3 method
 * names (answered below), so a missing header is served as 1.0.
 */
function checkVersion(c: AppContext): void {
  const requested = (
    c.req.header('A2A-Version') ??
    c.req.query('A2A-Version') ??
    ''
  ).trim()
  if (requested === '' || /^1(\.0)?(\.\d+)?$/.test(requested)) return
  throw new A2AError(
    'VERSION_NOT_SUPPORTED',
    `A2A version ${requested} is not supported; this agent speaks A2A ${A2A_PROTOCOL_VERSION}`,
    { supportedVersions: A2A_PROTOCOL_VERSION }
  )
}

async function resolveCaller(c: AppContext): Promise<Caller | null> {
  const header = c.req.header('Authorization')
  if (!header) return null
  const key = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!looksLikeApiKey(key)) {
    throw new A2AError(
      'UNAUTHENTICATED',
      'Invalid Authorization header: send Authorization: Bearer abund_… (API keys start with abund_)'
    )
  }
  const agent = await findAgentByApiKey(c.env.DB, key)
  if (!agent) {
    throw new A2AError(
      'UNAUTHENTICATED',
      'Invalid API key: it does not exist, was revoked, or expired'
    )
  }
  if (!agent.is_active) {
    throw new A2AError('PERMISSION_DENIED', 'This agent has been deactivated')
  }
  return { id: agent.id, handle: agent.handle }
}

function buildContext(
  app: Hono<{ Bindings: Env }>,
  c: AppContext,
  caller: Caller | null
): A2AContext {
  const origin = new URL(c.req.url).origin
  const authorization = c.req.header('Authorization')
  const reenter = reenterFetch(app, c, USER_AGENT)

  return {
    db: c.env.DB,
    environment: c.env.ENVIRONMENT,
    caller,
    api: async (method, path, body): Promise<ApiResult> => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }
      if (authorization) headers.Authorization = authorization
      const res = await reenter(`${origin}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      const text = await res.text()
      let parsed: unknown = text
      try {
        parsed = JSON.parse(text)
      } catch {
        // not JSON; keep the text
      }
      return { status: res.status, ok: res.ok, body: parsed }
    },
    runTool: (def, args) =>
      executeTool(def, args, {
        fetch: reenter,
        baseUrl: `${origin}/api/v1`,
        apiKey: authorization?.startsWith('Bearer ')
          ? authorization.slice(7)
          : undefined,
        userAgent: USER_AGENT,
      }),
  }
}

function toA2AError(err: unknown): A2AError {
  if (err instanceof A2AError) return err
  console.error('a2a error', err)
  return new A2AError('INTERNAL', 'Internal error')
}

function unsupported(what: string): A2AError {
  return new A2AError(
    'UNSUPPORTED_OPERATION',
    `${what} is not supported by this agent (see capabilities in the agent card). Poll GetTask or register a push notification config instead.`
  )
}

// =============================================================================
// JSON-RPC binding
// =============================================================================

async function dispatchRpc(
  ctx: A2AContext,
  method: string,
  params: unknown
): Promise<unknown> {
  switch (method) {
    case 'SendMessage':
      return sendMessage(ctx, params)
    case 'GetTask':
      return getTask(ctx, params)
    case 'ListTasks':
      return listTasks(ctx, params)
    case 'CancelTask':
      return cancelTask(ctx, params)
    case 'CreateTaskPushNotificationConfig':
      return createPushConfig(ctx, params)
    case 'GetTaskPushNotificationConfig':
      return getPushConfig(ctx, params)
    case 'ListTaskPushNotificationConfigs':
      return listPushConfigs(ctx, params)
    case 'DeleteTaskPushNotificationConfig':
      return deletePushConfig(ctx, params)
    case 'SendStreamingMessage':
    case 'SubscribeToTask':
      throw unsupported('Streaming')
    case 'GetExtendedAgentCard':
      throw unsupported('The extended agent card')
    default:
      if (LEGACY_METHODS.has(method)) {
        throw new A2AError(
          'VERSION_NOT_SUPPORTED',
          `${method} is an A2A 0.3 method; this agent speaks A2A ${A2A_PROTOCOL_VERSION} (SendMessage, GetTask, ...). Send A2A-Version: ${A2A_PROTOCOL_VERSION}.`,
          { supportedVersions: A2A_PROTOCOL_VERSION }
        )
      }
      throw new A2AError('METHOD_NOT_FOUND', `Method not found: ${method}`)
  }
}

function rpcResponse(
  c: AppContext,
  id: unknown,
  outcome: { result: unknown } | { error: A2AError }
): Response {
  if ('result' in outcome) {
    return c.json({ jsonrpc: '2.0', id, result: outcome.result })
  }
  const err = outcome.error
  const status = err.kind === 'UNAUTHENTICATED' ? 401 : 200
  if (status === 401) c.header('WWW-Authenticate', 'Bearer realm="abund.ai"')
  return c.json({ jsonrpc: '2.0', id, error: err.toJsonRpc() }, status)
}

// =============================================================================
// HTTP+JSON binding
// =============================================================================

type RestRoute = (
  ctx: A2AContext,
  c: AppContext,
  match: string[]
) => Promise<unknown>

async function jsonBody(c: AppContext): Promise<Record<string, unknown>> {
  const text = await c.req.text()
  if (!text.trim()) return {}
  try {
    const parsed: unknown = JSON.parse(text)
    if (isObject(parsed)) return parsed
  } catch {
    // fall through
  }
  throw new A2AError('PARSE_ERROR', 'Invalid JSON payload')
}

function queryObject(c: AppContext): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, values] of Object.entries(c.req.queries())) {
    const value = values[values.length - 1]
    if (value !== undefined && key !== 'A2A-Version') out[key] = value
  }
  return out
}

const REST_ROUTES: Array<[string, RegExp, RestRoute]> = [
  [
    'POST',
    /^\/message:send$/,
    async (ctx, c) => sendMessage(ctx, await jsonBody(c)),
  ],
  [
    'POST',
    /^\/message:stream$/,
    () => Promise.reject(unsupported('Streaming')),
  ],
  ['GET', /^\/tasks$/, (ctx, c) => listTasks(ctx, queryObject(c))],
  [
    'GET',
    /^\/tasks\/([^/:]+)$/,
    (ctx, c, [id]) => getTask(ctx, { ...queryObject(c), id }),
  ],
  [
    'POST',
    /^\/tasks\/([^/:]+):cancel$/,
    async (ctx, c, [id]) => cancelTask(ctx, { ...(await jsonBody(c)), id }),
  ],
  [
    'POST',
    /^\/tasks\/([^/:]+):subscribe$/,
    () => Promise.reject(unsupported('Streaming')),
  ],
  [
    'POST',
    /^\/tasks\/([^/:]+)\/pushNotificationConfigs$/,
    async (ctx, c, [taskId]) =>
      createPushConfig(ctx, { ...(await jsonBody(c)), taskId }),
  ],
  [
    'GET',
    /^\/tasks\/([^/:]+)\/pushNotificationConfigs$/,
    (ctx, c, [taskId]) => listPushConfigs(ctx, { ...queryObject(c), taskId }),
  ],
  [
    'GET',
    /^\/tasks\/([^/:]+)\/pushNotificationConfigs\/([^/:]+)$/,
    (ctx, _c, [taskId, id]) => getPushConfig(ctx, { taskId, id }),
  ],
  [
    'DELETE',
    /^\/tasks\/([^/:]+)\/pushNotificationConfigs\/([^/:]+)$/,
    (ctx, _c, [taskId, id]) => deletePushConfig(ctx, { taskId, id }),
  ],
  [
    'GET',
    /^\/extendedAgentCard$/,
    () => Promise.reject(unsupported('The extended agent card')),
  ],
]

function restResponse(
  c: AppContext,
  outcome: { result: unknown } | { error: A2AError }
): Response {
  if ('result' in outcome) {
    return c.body(JSON.stringify(outcome.result), 200, {
      'Content-Type': HTTP_JSON,
    })
  }
  const err = outcome.error
  const headers: Record<string, string> = { 'Content-Type': HTTP_JSON }
  if (err.kind === 'UNAUTHENTICATED') {
    headers['WWW-Authenticate'] = 'Bearer realm="abund.ai"'
  }
  return c.body(
    JSON.stringify(err.toHttp()),
    err.http as 400 | 401 | 403 | 404 | 409 | 429 | 500,
    headers
  )
}

// =============================================================================
// Registration
// =============================================================================

export function registerA2aRoutes(app: Hono<{ Bindings: Env }>): void {
  app.use('/a2a', ipRateLimiter)
  app.use('/a2a/*', ipRateLimiter)

  app.get('/.well-known/agent-card.json', (c) =>
    c.body(JSON.stringify(agentCard), 200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600',
    })
  )

  app.post('/a2a', async (c) => {
    let payload: unknown
    try {
      payload = await c.req.json<unknown>()
    } catch {
      return rpcResponse(c, null, {
        error: new A2AError('PARSE_ERROR', 'Invalid JSON payload'),
      })
    }
    if (
      !isObject(payload) ||
      payload.jsonrpc !== '2.0' ||
      typeof payload.method !== 'string'
    ) {
      return rpcResponse(c, isObject(payload) ? (payload.id ?? null) : null, {
        error: new A2AError(
          'INVALID_REQUEST',
          Array.isArray(payload)
            ? 'Batch requests are not supported'
            : 'Request payload validation error: expected {"jsonrpc": "2.0", "id", "method", "params"}'
        ),
      })
    }
    const id = payload.id ?? null
    try {
      checkVersion(c)
      const ctx = buildContext(app, c, await resolveCaller(c))
      const result = await dispatchRpc(ctx, payload.method, payload.params)
      return rpcResponse(c, id, { result })
    } catch (err) {
      return rpcResponse(c, id, { error: toA2AError(err) })
    }
  })

  app.get('/a2a', (c) =>
    c.json(
      {
        success: false,
        error: 'Method not allowed',
        hint: 'POST A2A JSON-RPC 2.0 requests here, or use the HTTP+JSON routes (POST /a2a/message:send, GET /a2a/tasks/{id}). Agent card: https://abund.ai/.well-known/agent-card.json',
      },
      405
    )
  )

  app.all('/a2a/*', async (c) => {
    const sub = decodeURIComponent(c.req.path.slice('/a2a'.length))
    try {
      checkVersion(c)
      for (const [method, pattern, handler] of REST_ROUTES) {
        const match = pattern.exec(sub)
        if (!match || method !== c.req.method) continue
        const ctx = buildContext(app, c, await resolveCaller(c))
        const result = await handler(ctx, c, match.slice(1))
        return restResponse(c, { result })
      }
      throw new A2AError(
        'METHOD_NOT_FOUND',
        `No A2A route for ${c.req.method} /a2a${sub}`
      )
    } catch (err) {
      return restResponse(c, { error: toA2AError(err) })
    }
  })
}
