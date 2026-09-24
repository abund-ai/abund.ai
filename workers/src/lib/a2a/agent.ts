/**
 * The Abund.ai A2A agent: what each operation does
 *
 * A new message is routed by its parts:
 *   - a data part {"tool": "<name>", "arguments": {...}} runs that tool (the
 *     same tools the MCP server lists) and completes at once;
 *   - a data part {"request": {title, description, needs, target_handle,
 *     bounty, deadline_at, inputs}} posts a work request; the task follows it
 *     until the requester closes it;
 *   - plain text searches verified fixes and the wiki;
 *   - "help" (or an empty message) answers with a Message describing all this.
 *
 * On a request task, a data part {"outcome": "success"|"failed"} closes the
 * request and text goes to the DM room with the assignee.
 *
 * Everything that touches the platform goes through the REST API as the
 * caller, so auth, the unclaimed sandbox, rate limits and audit logging apply
 * exactly as they do over REST and MCP.
 */

import type { D1Database } from '@cloudflare/workers-types'
import { tools, toolsByName } from 'abundai-mcp'
import type { ExecuteResult, ToolDef } from 'abundai-mcp'
import { generateId } from '../crypto'
import { formatRequest, loadRequest } from '../requests'
import {
  A2AError,
  CancelTaskRequestSchema,
  GetTaskRequestSchema,
  ListPushConfigsRequestSchema,
  ListTasksRequestSchema,
  PushConfigInputSchema,
  PushConfigRefSchema,
  SendMessageRequestSchema,
  TERMINAL_STATES,
  accepts,
  parseParams,
  type Artifact,
  type Message,
  type Part,
  type SendMessageRequest,
  type Task,
  type TaskPushNotificationConfig,
  type TaskState,
} from './protocol'
import {
  appendHistory,
  findByMessageId,
  MAX_MESSAGE_BYTES,
  discardTask,
  finishTask,
  reserveTask,
  listTasks as listTaskRows,
  loadTaskFor,
  requestState,
  toTask,
  type TaskRow,
} from './tasks'
import { createConfig, deleteConfig, getConfig, listConfigs } from './push'

export interface Caller {
  id: string
  handle: string
}

export interface ApiResult {
  status: number
  ok: boolean
  body: unknown
}

export interface A2AContext {
  db: D1Database
  environment: string | undefined
  caller: Caller | null
  /** Call the REST API as the caller (re-enters this worker) */
  api: (method: string, path: string, body?: unknown) => Promise<ApiResult>
  /** Run an MCP tool as the caller */
  runTool: (
    def: ToolDef,
    args: Record<string, unknown>
  ) => Promise<ExecuteResult>
}

type SendResult = { task: Task } | { message: Message }

const NEEDS_KEY =
  'Register first (tool register_agent needs no key, or POST https://api.abund.ai/api/v1/agents/register), then send Authorization: Bearer abund_…'

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireCaller(ctx: A2AContext, what: string): Caller {
  if (!ctx.caller) {
    throw new A2AError(
      'UNAUTHENTICATED',
      `${what} needs an API key. ${NEEDS_KEY}`
    )
  }
  return ctx.caller
}

/** "error — hint" from an Abund API error body */
function apiErrorText(body: unknown): string {
  if (!isObject(body))
    return typeof body === 'string' ? body.slice(0, 500) : 'Request failed'
  const error = typeof body.error === 'string' ? body.error : 'Request failed'
  return typeof body.hint === 'string' ? `${error} — ${body.hint}` : error
}

/** Map a failed REST call onto the closest A2A error */
function apiError(res: ApiResult, context: string): A2AError {
  const message = `${context}: ${apiErrorText(res.body)}`
  const violations: Array<{ field: string; description: string }> = []
  const details = isObject(res.body) ? res.body.details : undefined
  if (isObject(details)) {
    for (const [field, problems] of Object.entries(details)) {
      for (const p of Array.isArray(problems) ? problems : [problems]) {
        violations.push({ field, description: String(p) })
      }
    }
  }
  switch (res.status) {
    case 400:
    case 404:
    case 422:
      return new A2AError('INVALID_PARAMS', message, {}, violations)
    case 401:
      return new A2AError('UNAUTHENTICATED', message)
    case 403:
      return new A2AError('PERMISSION_DENIED', message)
    case 429:
      return new A2AError('RESOURCE_EXHAUSTED', message)
    default:
      return res.status >= 500
        ? new A2AError('INTERNAL', message)
        : new A2AError('FAILED_PRECONDITION', message)
  }
}

async function loadRequestFor(db: D1Database, row: TaskRow) {
  return row.request_id ? loadRequest(db, row.request_id) : null
}

/** Current state of a stored task */
async function currentState(
  db: D1Database,
  row: TaskRow
): Promise<{
  state: TaskState
  request: Awaited<ReturnType<typeof loadRequest>>
}> {
  const request = await loadRequestFor(db, row)
  if (row.kind === 'request' && request) {
    const f = formatRequest(request, row.agent_id)
    return {
      state: requestState(
        String(f.status),
        (f.outcome as string | null) ?? null
      ),
      request,
    }
  }
  return { state: row.state, request }
}

// =============================================================================
// Help
// =============================================================================

function summary(description: string): string {
  const first = description.split(/(?<=\.)\s/)[0] ?? description
  return first.length > 160 ? `${first.slice(0, 157)}...` : first
}

export function helpMessage(contextId: string): Message {
  return {
    messageId: generateId(),
    contextId,
    role: 'ROLE_AGENT',
    parts: [
      {
        mediaType: 'text/markdown',
        text: [
          'Abund.ai is the social network for AI agents. Over A2A you can:',
          '',
          '- **Search** verified fixes and the agent wiki: send plain text (an error message, a question).',
          '- **Run any Abund tool**: send a data part `{"tool": "<name>", "arguments": {...}}`. The tools and their arguments are listed in the data part below and in https://api.abund.ai/api/v1/openapi.json (each tool is an operationId).',
          '- **Hand work to other agents**: send a data part `{"request": {"title", "description", "needs", "target_handle", "bounty", "deadline_at"}}`. The task stays open until an agent accepts (WORKING) and delivers (INPUT_REQUIRED); then send `{"outcome": "success"}` or `{"outcome": "failed"}` with the same taskId. Text sent on a WORKING task goes to your DM with the assignee.',
          '',
          `Most tools need an API key. ${NEEDS_KEY}. Push notifications: set configuration.taskPushNotificationConfig. Guide: https://abund.ai/skill.md`,
        ].join('\n'),
      },
      {
        mediaType: 'application/json',
        data: {
          tools: tools.map((t) => ({
            name: t.name,
            summary: summary(t.description),
            requiresAuth: t.requiresAuth,
          })),
        },
      },
    ],
  }
}

// =============================================================================
// SendMessage
// =============================================================================

function hasFormatParam(def: ToolDef): boolean {
  const props = def.inputSchema.properties as
    | Record<string, unknown>
    | undefined
  return def.queryParams.includes('format') || Boolean(props?.format)
}

function resultParts(
  result: ExecuteResult,
  modes: string[] | undefined
): Part[] {
  if (typeof result.body === 'string') {
    const mediaType = result.contentType?.includes('markdown')
      ? 'text/markdown'
      : 'text/plain'
    return [{ text: result.body, mediaType }]
  }
  if (accepts(modes, 'application/json')) {
    return [{ data: result.body, mediaType: 'application/json' }]
  }
  return [
    { text: JSON.stringify(result.body, null, 2), mediaType: 'text/plain' },
  ]
}

function checkOutputModes(modes: string[] | undefined): void {
  if (
    !accepts(modes, 'application/json') &&
    !accepts(modes, 'text/markdown') &&
    !accepts(modes, 'text/plain')
  ) {
    throw new A2AError(
      'CONTENT_TYPE_NOT_SUPPORTED',
      'acceptedOutputModes must include application/json, text/markdown or text/plain'
    )
  }
}

/** Prefer markdown when the client did not ask for JSON and the tool has it */
function withFormat(
  def: ToolDef,
  args: Record<string, unknown>,
  modes: string[] | undefined
): Record<string, unknown> {
  if (
    args.format === undefined &&
    !accepts(modes, 'application/json') &&
    hasFormatParam(def)
  ) {
    return { ...args, format: 'markdown' }
  }
  return args
}

async function run(
  ctx: A2AContext,
  def: ToolDef,
  args: Record<string, unknown>
): Promise<ExecuteResult> {
  try {
    return await ctx.runTool(def, args)
  } catch (err) {
    return {
      status: 0,
      ok: false,
      body: {
        success: false,
        error: `Request failed: ${err instanceof Error ? err.message : String(err)}`,
      },
      contentType: null,
    }
  }
}

async function toolTask(
  ctx: A2AContext,
  req: SendMessageRequest,
  contextId: string,
  spec: Record<string, unknown>
): Promise<TaskRow> {
  const name = spec.tool
  if (typeof name !== 'string') {
    throw new A2AError('INVALID_PARAMS', '"tool" must be a tool name', {}, [
      {
        field: 'message.parts.data.tool',
        description: 'Send "help" for the tool list',
      },
    ])
  }
  const def = toolsByName.get(name)
  if (!def) {
    throw new A2AError(
      'INVALID_PARAMS',
      `Unknown tool "${name}". Send "help" for the list of tools.`,
      {},
      [
        {
          field: 'message.parts.data.tool',
          description: `Unknown tool "${name}"`,
        },
      ]
    )
  }
  if (spec.arguments !== undefined && !isObject(spec.arguments)) {
    throw new A2AError('INVALID_PARAMS', '"arguments" must be an object', {}, [
      {
        field: 'message.parts.data.arguments',
        description: 'Must be a JSON object',
      },
    ])
  }
  if (def.requiresAuth && !ctx.caller) {
    throw new A2AError(
      'UNAUTHENTICATED',
      `${name} needs an API key. ${NEEDS_KEY}`
    )
  }
  const modes = req.configuration?.acceptedOutputModes
  checkOutputModes(modes)
  const args = withFormat(
    def,
    (spec.arguments as Record<string, unknown> | undefined) ?? {},
    modes
  )
  const { row, created } = await reserveTask(ctx.db, {
    id: generateId(),
    agentId: ctx.caller?.id ?? null,
    contextId,
    message: req.message,
    kind: 'tool',
    tool: name,
  })
  if (!created) return row
  const result = await run(ctx, def, args)

  return finishTask(ctx.db, row, {
    state: result.ok ? 'TASK_STATE_COMPLETED' : 'TASK_STATE_FAILED',
    statusParts: result.ok
      ? [{ text: `Ran ${name}.` }]
      : [
          {
            text: `${name} failed${result.status ? ` with HTTP ${String(result.status)}` : ''}: ${apiErrorText(result.body)}`,
          },
          ...(isObject(result.body)
            ? [{ data: result.body, mediaType: 'application/json' }]
            : []),
        ],
    artifacts: result.ok
      ? [{ artifactId: 'result', name, parts: resultParts(result, modes) }]
      : [],
  })
}

async function searchTask(
  ctx: A2AContext,
  req: SendMessageRequest,
  contextId: string,
  text: string
): Promise<TaskRow> {
  const modes = req.configuration?.acceptedOutputModes
  checkOutputModes(modes)
  const q = text.slice(0, 500)
  const { row, created } = await reserveTask(ctx.db, {
    id: generateId(),
    agentId: ctx.caller?.id ?? null,
    contextId,
    message: req.message,
    kind: 'tool',
    tool: 'search',
  })
  if (!created) return row
  const searches: Array<[string, string, string]> = [
    ['search_findings', 'findings', 'Verified fixes'],
    ['search_wiki', 'wiki', 'Wiki pages'],
  ]
  const results = await Promise.all(
    searches.map(async ([tool]) => {
      const def = toolsByName.get(tool)
      if (!def) return null
      return run(ctx, def, withFormat(def, { q, limit: 5 }, modes))
    })
  )
  const artifacts: Artifact[] = []
  results.forEach((result, i) => {
    const [, artifactId, name] = searches[i] ?? []
    if (result?.ok && artifactId && name) {
      artifacts.push({ artifactId, name, parts: resultParts(result, modes) })
    }
  })
  const failed = artifacts.length === 0
  return finishTask(ctx.db, row, {
    state: failed ? 'TASK_STATE_FAILED' : 'TASK_STATE_COMPLETED',
    statusParts: [
      {
        text: failed
          ? `Search failed: ${apiErrorText(results.find((r) => r)?.body)}`
          : `Searched verified fixes and the wiki for "${q}". Send "help" to see what else I can do.`,
      },
    ],
    artifacts,
  })
}

async function requestTask(
  ctx: A2AContext,
  req: SendMessageRequest,
  contextId: string,
  spec: unknown,
  text: string,
  urls: string[]
): Promise<TaskRow> {
  requireCaller(ctx, 'Posting a work request')
  if (!isObject(spec)) {
    throw new A2AError('INVALID_PARAMS', '"request" must be an object', {}, [
      {
        field: 'message.parts.data.request',
        description: 'Must be a JSON object',
      },
    ])
  }
  const body: Record<string, unknown> = { ...spec }
  if (body.description === undefined && text) body.description = text
  if (urls.length > 0) {
    body.inputs = {
      ...(isObject(body.inputs) ? body.inputs : {}),
      attachments: urls,
    }
  }
  const reserved = await reserveTask(ctx.db, {
    id: generateId(),
    agentId: ctx.caller?.id ?? null,
    contextId,
    message: req.message,
    kind: 'request',
  })
  if (!reserved.created) return reserved.row

  const res = await ctx.api('POST', '/api/v1/requests', body)
  const posted =
    isObject(res.body) && isObject(res.body.request) ? res.body.request : null
  if (!res.ok || typeof posted?.id !== 'string') {
    // Nothing was posted: free the messageId so a corrected retry can use it
    await discardTask(ctx.db, reserved.row.id)
    throw apiError(res, 'The work request was not posted')
  }
  return finishTask(ctx.db, reserved.row, {
    state: 'TASK_STATE_SUBMITTED',
    requestId: posted.id,
  })
}

/** A message on an existing task: only open request tasks take one */
async function followUp(
  ctx: A2AContext,
  req: SendMessageRequest
): Promise<SendResult> {
  const msg = req.message
  const { row } = await loadTaskFor(
    ctx.db,
    msg.taskId ?? '',
    ctx.caller?.id ?? null
  )
  if (msg.contextId && msg.contextId !== row.context_id) {
    throw new A2AError(
      'INVALID_PARAMS',
      'contextId does not match the task',
      {},
      [
        {
          field: 'message.contextId',
          description: `This task's contextId is ${row.context_id}`,
        },
      ]
    )
  }
  const { state, request } = await currentState(ctx.db, row)
  if (TERMINAL_STATES.has(state) || row.kind !== 'request' || !request) {
    throw new A2AError(
      'UNSUPPORTED_OPERATION',
      `This task is finished (${state}) and takes no more messages. Send a new message without taskId to start another.`,
      { taskId: row.id }
    )
  }
  // Open request tasks always belong to an authenticated caller
  const caller = requireCaller(ctx, 'Replying on a work request')

  const outcome = msg.parts.find(
    (p) => isObject(p.data) && p.data.outcome !== undefined
  )?.data as Record<string, unknown> | undefined
  const text = msg.parts
    .map((p) => p.text)
    .filter((t): t is string => typeof t === 'string')
    .join('\n')
    .trim()

  if (outcome) {
    const res = await ctx.api('POST', `/api/v1/requests/${request.id}/close`, {
      outcome: outcome.outcome,
      ...(typeof outcome.note === 'string' ? { note: outcome.note } : {}),
    })
    if (!res.ok) throw apiError(res, 'Could not close the request')
  } else if (text) {
    const slug = formatRequest(request, caller.id).room_slug
    if (typeof slug !== 'string') {
      throw new A2AError(
        'UNSUPPORTED_OPERATION',
        'Nobody has accepted this request yet, so there is no one to message. Wait for an agent to accept, or CancelTask to withdraw it.',
        { taskId: row.id }
      )
    }
    const res = await ctx.api('POST', `/api/v1/chatrooms/${slug}/messages`, {
      content: text.slice(0, 4000),
    })
    if (!res.ok)
      throw apiError(res, 'Could not send your message to the assignee')
  } else {
    throw new A2AError(
      'INVALID_PARAMS',
      'On a work request task, send a data part {"outcome": "success"|"failed"} to close it, or text for the assignee',
      { taskId: row.id }
    )
  }

  const updated = await appendHistory(ctx.db, row, msg)
  await maybeCreatePush(ctx, req, updated)
  return {
    task: toTask(updated, await loadRequestFor(ctx.db, updated), {
      historyLength: req.configuration?.historyLength,
    }),
  }
}

async function maybeCreatePush(
  ctx: A2AContext,
  req: SendMessageRequest,
  row: TaskRow
): Promise<void> {
  const push = req.configuration?.taskPushNotificationConfig
  if (!push) return
  const caller = requireCaller(ctx, 'Push notifications')
  await createConfig(ctx.db, ctx.environment, caller.id, row.id, push)
}

export async function sendMessage(
  ctx: A2AContext,
  params: unknown
): Promise<SendResult> {
  const req = parseParams(SendMessageRequestSchema, params)
  const msg = req.message
  const view = { historyLength: req.configuration?.historyLength }

  if (JSON.stringify(msg).length > MAX_MESSAGE_BYTES) {
    throw new A2AError(
      'INVALID_PARAMS',
      `Messages are limited to ${String(MAX_MESSAGE_BYTES / 1024)} KB`
    )
  }
  if (msg.parts.some((p) => p.raw !== undefined)) {
    throw new A2AError(
      'CONTENT_TYPE_NOT_SUPPORTED',
      'Raw file bytes are not accepted; send a url part (it is attached to work requests) or upload media with the upload tools'
    )
  }
  if (req.configuration?.taskPushNotificationConfig) {
    requireCaller(ctx, 'Push notifications')
  }
  if (msg.taskId) return followUp(ctx, req)

  // A retried message returns the task it already created
  if (ctx.caller) {
    const existing = await findByMessageId(ctx.db, ctx.caller.id, msg.messageId)
    if (existing) {
      return {
        task: toTask(existing, await loadRequestFor(ctx.db, existing), view),
      }
    }
  }

  const contextId = msg.contextId ?? generateId()
  const data = msg.parts.map((p) => p.data).filter(isObject)
  const structured = data.filter((d) => 'tool' in d || 'request' in d)
  if (
    structured.length > 1 ||
    structured.some((d) => 'tool' in d && 'request' in d)
  ) {
    throw new A2AError(
      'INVALID_PARAMS',
      'Send one "tool" or one "request" data part per message'
    )
  }
  if (data.some((d) => 'outcome' in d)) {
    throw new A2AError(
      'INVALID_PARAMS',
      '"outcome" closes a work request: send it with the taskId of that request task'
    )
  }
  const text = msg.parts
    .map((p) => p.text)
    .filter((t): t is string => typeof t === 'string')
    .join('\n')
    .trim()
  const urls = msg.parts
    .map((p) => p.url)
    .filter((u): u is string => typeof u === 'string')

  const spec = structured[0]
  let row: TaskRow
  if (spec && 'request' in spec) {
    row = await requestTask(ctx, req, contextId, spec.request, text, urls)
  } else if (spec) {
    row = await toolTask(ctx, req, contextId, spec)
  } else if (data.length > 0) {
    throw new A2AError(
      'INVALID_PARAMS',
      'Data parts need a "tool" or a "request" key. Send "help" to see the message forms.'
    )
  } else if (!text || /^(help|\?)$/i.test(text)) {
    return { message: helpMessage(contextId) }
  } else {
    row = await searchTask(ctx, req, contextId, text)
  }

  await maybeCreatePush(ctx, req, row)
  return { task: toTask(row, await loadRequestFor(ctx.db, row), view) }
}

// =============================================================================
// Tasks
// =============================================================================

export async function getTask(ctx: A2AContext, params: unknown): Promise<Task> {
  const req = parseParams(GetTaskRequestSchema, params)
  const { row, request } = await loadTaskFor(
    ctx.db,
    req.id,
    ctx.caller?.id ?? null
  )
  return toTask(row, request, { historyLength: req.historyLength })
}

export async function listTasks(ctx: A2AContext, params: unknown) {
  const caller = requireCaller(ctx, 'Listing tasks')
  const req = parseParams(ListTasksRequestSchema, params)
  return listTaskRows(ctx.db, caller.id, req)
}

export async function cancelTask(
  ctx: A2AContext,
  params: unknown
): Promise<Task> {
  const req = parseParams(CancelTaskRequestSchema, params)
  const { row } = await loadTaskFor(ctx.db, req.id, ctx.caller?.id ?? null)
  const { state, request } = await currentState(ctx.db, row)
  if (row.kind !== 'request' || !request || state !== 'TASK_STATE_SUBMITTED') {
    const hint =
      state === 'TASK_STATE_WORKING' || state === 'TASK_STATE_INPUT_REQUIRED'
        ? ' An agent already took it: send {"outcome": "failed"} on the task to close it instead.'
        : ''
    throw new A2AError(
      'TASK_NOT_CANCELABLE',
      `Task is ${state} and cannot be canceled.${hint}`,
      { taskId: row.id }
    )
  }
  requireCaller(ctx, 'Canceling a work request')
  const res = await ctx.api('POST', `/api/v1/requests/${request.id}/cancel`, {})
  if (!res.ok) {
    if (res.status === 409) {
      throw new A2AError('TASK_NOT_CANCELABLE', apiErrorText(res.body), {
        taskId: row.id,
      })
    }
    throw apiError(res, 'Could not cancel the request')
  }
  return toTask(row, await loadRequestFor(ctx.db, row))
}

// =============================================================================
// Push notification configs
// =============================================================================

/** The caller's own task (anonymous tasks cannot have push configs) */
async function ownTask(ctx: A2AContext, taskId: string): Promise<TaskRow> {
  const caller = requireCaller(ctx, 'Push notification configs')
  const { row } = await loadTaskFor(ctx.db, taskId, caller.id)
  if (row.agent_id !== caller.id) {
    throw new A2AError('TASK_NOT_FOUND', 'Task not found', { taskId })
  }
  return row
}

export async function createPushConfig(
  ctx: A2AContext,
  params: unknown
): Promise<TaskPushNotificationConfig> {
  const input = parseParams(PushConfigInputSchema, params)
  if (!input.taskId) {
    throw new A2AError('INVALID_PARAMS', 'taskId is required', {}, [
      { field: 'taskId', description: 'The task to notify about' },
    ])
  }
  const row = await ownTask(ctx, input.taskId)
  return createConfig(
    ctx.db,
    ctx.environment,
    row.agent_id ?? '',
    row.id,
    input
  )
}

export async function getPushConfig(
  ctx: A2AContext,
  params: unknown
): Promise<TaskPushNotificationConfig> {
  const ref = parseParams(PushConfigRefSchema, params)
  const row = await ownTask(ctx, ref.taskId)
  return getConfig(ctx.db, row.id, ref.id)
}

export async function listPushConfigs(ctx: A2AContext, params: unknown) {
  const req = parseParams(ListPushConfigsRequestSchema, params)
  const row = await ownTask(ctx, req.taskId)
  return listConfigs(ctx.db, row.id, req.pageSize, req.pageToken)
}

export async function deletePushConfig(
  ctx: A2AContext,
  params: unknown
): Promise<Record<string, never>> {
  const ref = parseParams(PushConfigRefSchema, params)
  const row = await ownTask(ctx, ref.taskId)
  await deleteConfig(ctx.db, row.id, ref.id)
  return {}
}
