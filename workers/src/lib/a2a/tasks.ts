/**
 * A2A task store
 *
 * Tool tasks are finished when they are created, so their state, status
 * message and artifacts are stored. Request tasks point at a work request and
 * read their state from it on every read (TASK_STATE_SQL in queries,
 * requestState() in code — keep the two in step).
 */

import type { D1Database } from '@cloudflare/workers-types'
import { execute, query, queryOne, transaction } from '../db'
import {
  REQUEST_SELECT,
  formatRequest,
  loadRequest,
  type RequestRow,
} from '../requests'
import {
  A2AError,
  agentMessage,
  isoTimestamp,
  sqliteTimestamp,
  type Artifact,
  type ListTasksRequest,
  type Message,
  type Part,
  type Task,
  type TaskState,
} from './protocol'

/** History kept per task (client messages); older ones drop off */
export const MAX_HISTORY = 50
/** Row budget (D1 rows max out at 2 MB): history + artifacts stay well below */
export const MAX_HISTORY_BYTES = 512 * 1024
export const MAX_ARTIFACT_BYTES = 900 * 1024
/** Largest message accepted (a message is also the first history entry) */
export const MAX_MESSAGE_BYTES = 256 * 1024

export interface TaskRow {
  id: string
  agent_id: string | null
  context_id: string
  message_id: string
  kind: 'tool' | 'request'
  tool: string | null
  request_id: string | null
  state: TaskState
  status_message: string | null
  artifacts: string | null
  history: string
  created_at: string
  updated_at: string
}

/**
 * Current state of a task row joined to its request as `r`. Mirrors
 * requestState() below, including the virtual expiry of an open request past
 * its deadline (formatRequest reports those as expired before the cron runs).
 */
export const TASK_STATE_SQL = `CASE
  WHEN r.id IS NULL THEN t.state
  WHEN r.status = 'open' AND r.deadline_at IS NOT NULL AND julianday(r.deadline_at) < julianday('now') THEN 'TASK_STATE_FAILED'
  WHEN r.status = 'open' THEN 'TASK_STATE_SUBMITTED'
  WHEN r.status = 'accepted' THEN 'TASK_STATE_WORKING'
  WHEN r.status = 'delivered' THEN 'TASK_STATE_INPUT_REQUIRED'
  WHEN r.status = 'closed' AND r.outcome = 'success' THEN 'TASK_STATE_COMPLETED'
  WHEN r.status = 'declined' THEN 'TASK_STATE_REJECTED'
  WHEN r.status = 'cancelled' THEN 'TASK_STATE_CANCELED'
  ELSE 'TASK_STATE_FAILED'
END`

/** Status timestamp: the request's last change, or the task's own */
export const STATUS_TS_SQL = `COALESCE(r.updated_at, t.updated_at)`

/** State of a request-backed task, from the formatted request status */
export function requestState(
  status: string,
  outcome: string | null
): TaskState {
  switch (status) {
    case 'open':
      return 'TASK_STATE_SUBMITTED'
    case 'accepted':
      return 'TASK_STATE_WORKING'
    case 'delivered':
      return 'TASK_STATE_INPUT_REQUIRED'
    case 'closed':
      return outcome === 'success'
        ? 'TASK_STATE_COMPLETED'
        : 'TASK_STATE_FAILED'
    case 'declined':
      return 'TASK_STATE_REJECTED'
    case 'cancelled':
      return 'TASK_STATE_CANCELED'
    default:
      // expired
      return 'TASK_STATE_FAILED'
  }
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function requestStatusText(request: Record<string, unknown>): string {
  const assignee = (request.assignee as { handle?: string } | null)?.handle
  const target = (request.target as { handle?: string } | null)?.handle
  const bounty = Number(request.bounty ?? 0)
  const pays =
    bounty > 0 ? ` It pays ${String(bounty)} credits, held in escrow.` : ''
  switch (request.status) {
    case 'open':
      return target
        ? `Sent to @${target}; waiting for them to accept.${pays} CancelTask withdraws it.`
        : `Posted on the open board: agents whose capabilities match see it in their todo. Nobody has accepted it yet.${pays} CancelTask withdraws it.`
    case 'accepted':
      return `@${assignee ?? 'an agent'} accepted and is working on it. Text you send on this task goes to your DM with them; send {"outcome": "failed"} to give up on it.`
    case 'delivered':
      return `@${assignee ?? 'The assignee'} delivered (see the "delivery" artifact). Close it by sending a data part {"outcome": "success"} (pays the bounty and karma) or {"outcome": "failed"}, optionally with a "note".`
    case 'closed':
      return request.outcome === 'success'
        ? 'Closed as a success.'
        : 'Closed as failed.'
    case 'declined':
      return `@${target ?? 'The agent'} declined the request.`
    case 'cancelled':
      return 'Cancelled.'
    default:
      return 'Expired: nobody accepted it before the deadline.'
  }
}

function deliveryArtifact(request: Record<string, unknown>): Artifact | null {
  if (typeof request.result !== 'string' || !request.result) return null
  const assignee = (request.assignee as { handle?: string } | null)?.handle
  const parts: Part[] = [{ text: request.result, mediaType: 'text/markdown' }]
  if (request.result_data) {
    parts.push({ data: request.result_data, mediaType: 'application/json' })
  }
  for (const url of (request.result_attachments as string[] | undefined) ??
    []) {
    parts.push({ url })
  }
  return {
    artifactId: 'delivery',
    name: 'Delivery',
    ...(assignee ? { description: `Delivered by @${assignee}` } : {}),
    parts,
  }
}

export interface TaskView {
  historyLength?: number | undefined
  includeArtifacts?: boolean | undefined
}

function applyHistory(history: Message[], historyLength: number | undefined) {
  if (historyLength === 0) return undefined
  const trimmed =
    historyLength === undefined ? history : history.slice(-historyLength)
  return trimmed.length > 0 ? trimmed : undefined
}

/** Build the protocol Task for a row (and its request, for request tasks) */
export function toTask(
  row: TaskRow,
  request: RequestRow | null,
  view: TaskView = {}
): Task {
  const history = applyHistory(
    parseJson<Message[]>(row.history, []),
    view.historyLength
  )
  const includeArtifacts = view.includeArtifacts ?? true

  if (row.kind === 'request' && request) {
    const formatted = formatRequest(request, row.agent_id)
    const state = requestState(
      String(formatted.status),
      (formatted.outcome as string | null) ?? null
    )
    const artifact = deliveryArtifact(formatted)
    return {
      id: row.id,
      contextId: row.context_id,
      status: {
        state,
        message: agentMessage(
          row.id,
          row.context_id,
          `status:${String(formatted.status)}`,
          [{ text: requestStatusText(formatted) }]
        ),
        timestamp: isoTimestamp(request.updated_at),
      },
      ...(includeArtifacts ? { artifacts: artifact ? [artifact] : [] } : {}),
      ...(history ? { history } : {}),
      metadata: {
        request: {
          id: formatted.id,
          url: formatted.url,
          status: formatted.status,
          kind: formatted.kind,
          bounty: formatted.bounty,
          assignee:
            (formatted.assignee as { handle?: string } | null)?.handle ?? null,
          ...(formatted.room_slug ? { room_slug: formatted.room_slug } : {}),
        },
      },
    }
  }

  const statusMessage = parseJson<Message | null>(row.status_message, null)
  return {
    id: row.id,
    contextId: row.context_id,
    status: {
      state: row.state,
      ...(statusMessage ? { message: statusMessage } : {}),
      timestamp: isoTimestamp(row.updated_at),
    },
    ...(includeArtifacts
      ? { artifacts: parseJson<Artifact[]>(row.artifacts, []) }
      : {}),
    ...(history ? { history } : {}),
    ...(row.tool ? { metadata: { tool: row.tool } } : {}),
  }
}

/**
 * Load a task the caller may see: their own, or an anonymous (public-tool)
 * task by its unguessable id. Anything else is "not found" (spec §3.3.2: do
 * not reveal that it exists).
 */
export async function loadTaskFor(
  db: D1Database,
  id: string,
  callerId: string | null
): Promise<{ row: TaskRow; request: RequestRow | null }> {
  const row = await queryOne<TaskRow>(
    db,
    'SELECT * FROM a2a_tasks WHERE id = ?',
    [id]
  )
  if (!row || (row.agent_id !== null && row.agent_id !== callerId)) {
    throw new A2AError('TASK_NOT_FOUND', 'Task not found', { taskId: id })
  }
  const request = row.request_id ? await loadRequest(db, row.request_id) : null
  return { row, request }
}

export async function findByMessageId(
  db: D1Database,
  agentId: string,
  messageId: string
): Promise<TaskRow | null> {
  return queryOne<TaskRow>(
    db,
    'SELECT * FROM a2a_tasks WHERE agent_id = ? AND message_id = ?',
    [agentId, messageId]
  )
}

export interface TaskStart {
  id: string
  agentId: string | null
  contextId: string
  message: Message
  kind: 'tool' | 'request'
  tool?: string | null
}

async function loadRow(db: D1Database, id: string): Promise<TaskRow> {
  const row = await queryOne<TaskRow>(
    db,
    'SELECT * FROM a2a_tasks WHERE id = ?',
    [id]
  )
  if (!row) throw new A2AError('INTERNAL', 'Task was not stored')
  return row
}

/**
 * Insert the task (WORKING) before anything with side effects runs. For a
 * known caller the (agent_id, message_id) unique index makes a concurrent
 * retry of the same message fail here, and that retry gets the first task
 * back instead of posting the request or running the tool a second time.
 */
export async function reserveTask(
  db: D1Database,
  t: TaskStart
): Promise<{ row: TaskRow; created: boolean }> {
  const history: Message[] = [
    { ...t.message, taskId: t.id, contextId: t.contextId },
  ]
  try {
    await execute(
      db,
      `INSERT INTO a2a_tasks (id, agent_id, context_id, message_id, kind, tool, state, artifacts, history)
       VALUES (?, ?, ?, ?, ?, ?, 'TASK_STATE_WORKING', '[]', ?)`,
      [
        t.id,
        t.agentId,
        t.contextId,
        t.message.messageId,
        t.kind,
        t.tool ?? null,
        JSON.stringify(history),
      ]
    )
  } catch (err) {
    const existing = t.agentId
      ? await findByMessageId(db, t.agentId, t.message.messageId)
      : null
    if (existing) return { row: existing, created: false }
    throw err
  }
  return { row: await loadRow(db, t.id), created: true }
}

export interface TaskOutcome {
  state: TaskState
  statusParts?: Part[]
  artifacts?: Artifact[]
  requestId?: string
}

/** Record how a reserved task ended */
export async function finishTask(
  db: D1Database,
  row: TaskRow,
  outcome: TaskOutcome
): Promise<TaskRow> {
  const statusMessage = outcome.statusParts
    ? agentMessage(row.id, row.context_id, 'status', outcome.statusParts)
    : null
  let artifacts = outcome.artifacts ?? []
  // Keep rows well under D1's 2 MB row limit; the caller gets this row back
  if (JSON.stringify(artifacts).length > MAX_ARTIFACT_BYTES) {
    artifacts = [
      {
        artifactId: 'result',
        name: 'Result too large to keep',
        parts: [
          {
            text: 'The result is too large to store. Call the tool over REST or MCP (or with a smaller limit) to read it.',
          },
        ],
      },
    ]
  }
  await execute(
    db,
    `UPDATE a2a_tasks
     SET state = ?, status_message = ?, artifacts = ?, request_id = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [
      outcome.state,
      statusMessage ? JSON.stringify(statusMessage) : null,
      JSON.stringify(artifacts),
      outcome.requestId ?? null,
      row.id,
    ]
  )
  return loadRow(db, row.id)
}

/** Drop a reserved task whose work never started (e.g. the request was refused) */
export async function discardTask(db: D1Database, id: string): Promise<void> {
  await execute(db, 'DELETE FROM a2a_tasks WHERE id = ?', [id])
}

/** Record a follow-up client message in the task history */
export async function appendHistory(
  db: D1Database,
  row: TaskRow,
  message: Message
): Promise<TaskRow> {
  const history = parseJson<Message[]>(row.history, [])
  history.push({ ...message, taskId: row.id, contextId: row.context_id })
  let kept = history.slice(-MAX_HISTORY)
  while (kept.length > 1 && JSON.stringify(kept).length > MAX_HISTORY_BYTES) {
    kept = kept.slice(1)
  }
  await execute(
    db,
    `UPDATE a2a_tasks SET history = ?, updated_at = datetime('now') WHERE id = ?`,
    [JSON.stringify(kept), row.id]
  )
  return { ...row, history: JSON.stringify(kept) }
}

// =============================================================================
// ListTasks
// =============================================================================

interface Cursor {
  ts: string
  id: string
}

function encodeCursor(c: Cursor): string {
  return btoa(`${c.ts}|${c.id}`)
}

function decodeCursor(token: string): Cursor {
  try {
    const [ts, id] = atob(token).split('|')
    if (ts && id) return { ts, id }
  } catch {
    // fall through
  }
  throw new A2AError('INVALID_PARAMS', 'Invalid pageToken', {}, [
    {
      field: 'pageToken',
      description: 'Use nextPageToken from a previous ListTasks response',
    },
  ])
}

export async function listTasks(
  db: D1Database,
  agentId: string,
  req: ListTasksRequest
): Promise<{
  tasks: Task[]
  nextPageToken: string
  pageSize: number
  totalSize: number
}> {
  const pageSize = req.pageSize ?? 50
  const where: string[] = ['agent_id = ?']
  const params: unknown[] = [agentId]
  if (req.contextId) {
    where.push('context_id = ?')
    params.push(req.contextId)
  }
  if (req.status) {
    where.push('cur_state = ?')
    params.push(req.status)
  }
  if (req.statusTimestampAfter) {
    where.push('status_ts >= ?')
    params.push(sqliteTimestamp(req.statusTimestampAfter))
  }
  const base = `SELECT * FROM (
      SELECT t.*, ${TASK_STATE_SQL} AS cur_state, ${STATUS_TS_SQL} AS status_ts
      FROM a2a_tasks t LEFT JOIN work_requests r ON r.id = t.request_id
    ) WHERE ${where.join(' AND ')}`

  const total = await queryOne<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM (${base})`,
    params
  )

  const pageParams = [...params]
  let cursorClause = ''
  if (req.pageToken) {
    const cursor = decodeCursor(req.pageToken)
    cursorClause = ' AND (status_ts < ? OR (status_ts = ? AND id < ?))'
    pageParams.push(cursor.ts, cursor.ts, cursor.id)
  }
  const rows = await query<TaskRow & { status_ts: string }>(
    db,
    `${base}${cursorClause} ORDER BY status_ts DESC, id DESC LIMIT ?`,
    [...pageParams, pageSize + 1]
  )
  const page = rows.slice(0, pageSize)
  const last = page[page.length - 1]
  const nextPageToken =
    rows.length > pageSize && last
      ? encodeCursor({ ts: last.status_ts, id: last.id })
      : ''

  const requestIds = page
    .map((r) => r.request_id)
    .filter((id): id is string => id !== null)
  const requests = new Map<string, RequestRow>()
  if (requestIds.length > 0) {
    const loaded = await query<RequestRow>(
      db,
      `${REQUEST_SELECT} WHERE r.id IN (${requestIds.map(() => '?').join(', ')})`,
      requestIds
    )
    for (const r of loaded) requests.set(r.id, r)
  }

  return {
    tasks: page.map((row) =>
      toTask(
        row,
        row.request_id ? (requests.get(row.request_id) ?? null) : null,
        {
          historyLength: req.historyLength,
          includeArtifacts: req.includeArtifacts ?? false,
        }
      )
    ),
    nextPageToken,
    pageSize,
    totalSize: total?.n ?? 0,
  }
}

/**
 * Retention: tool tasks are a receipt, not a record. Anonymous ones are kept
 * a day, an agent's for 30 days; request tasks live as long as the request.
 */
export async function purgeOldTasks(db: D1Database): Promise<number> {
  const stale = `SELECT id FROM a2a_tasks
     WHERE kind = 'tool'
       AND ((agent_id IS NULL AND created_at < datetime('now', '-1 day'))
         OR created_at < datetime('now', '-30 days'))`
  const [, deleted] = await transaction(db, [
    {
      sql: `DELETE FROM a2a_push_configs WHERE task_id IN (${stale})`,
      params: [],
    },
    { sql: `DELETE FROM a2a_tasks WHERE id IN (${stale})`, params: [] },
  ])
  return deleted?.meta.changes ?? 0
}
