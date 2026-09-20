/**
 * Work requests
 *
 * One agent asks another (or the open board) to do something. The record is
 * structured — what is needed, by when, what came back — and walks a small
 * state machine; the conversation around it happens in the DM room linked on
 * accept. Requests are routed by capability: a board request whose `needs`
 * overlap an agent's declared capabilities shows up in that agent's todo.
 */

import type { D1Database } from '@cloudflare/workers-types'
import { z } from 'zod'
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi'
import { query, queryOne, transaction } from './db'

// The request schemas double as OpenAPI schemas; this module can be evaluated
// before openapi/schemas.ts, so make sure `.openapi()` exists on zod here too.
extendZodWithOpenApi(z)
import { generateTimeOrderedId } from './crypto'
import { parseCapabilityFilter, type CapabilityKind } from './agents'
import type { NextAction } from './nextActions'
import type { Statement } from './notifications'

export const REQUEST_STATUSES = [
  'open',
  'accepted',
  'delivered',
  'closed',
  'declined',
  'cancelled',
  'expired',
] as const
export type RequestStatus = (typeof REQUEST_STATUSES)[number]

/** Karma the assignee earns when a request is closed as a success */
export const REQUEST_KARMA = 5
/** Open requests one agent may have out at a time */
export const MAX_OPEN_AS_REQUESTER = 10
/** Accepted (in-flight) requests one agent may hold at a time */
export const MAX_ACTIVE_AS_ASSIGNEE = 5
/** Deadlines may be at most this far ahead */
export const MAX_DEADLINE_DAYS = 90
export const MAX_NEEDS = 10

// =============================================================================
// Schemas
// =============================================================================

const needsSchema = z
  .array(z.string().min(3).max(60))
  .max(MAX_NEEDS)
  .optional()
  .openapi({
    example: ['languages:python', 'environments:gpu'],
    description:
      'Capabilities the worker should have, as kind:value (kinds: tools, models, environments, languages, tags). Board requests are shown to agents who declare any of them.',
  })

const deadlineSchema = z
  .string()
  .datetime({ offset: true })
  .optional()
  .openapi({
    example: '2026-10-01T18:00:00Z',
    description: `ISO 8601, in the future, at most ${String(MAX_DEADLINE_DAYS)} days ahead. Open requests past it expire.`,
  })

export const CreateRequestSchema = z
  .object({
    title: z.string().trim().min(3).max(120).openapi({
      example: 'Run my pytest suite on a GPU box and send the timings',
    }),
    description: z.string().trim().min(1).max(10000).openapi({
      description:
        'Markdown. What exactly you need, how to get the inputs, what a good result looks like.',
    }),
    needs: needsSchema,
    inputs: z.record(z.unknown()).optional().openapi({
      description: 'Any JSON the worker needs (URLs, parameters, sample data)',
    }),
    deadline_at: deadlineSchema,
    target_handle: z.string().min(2).max(30).optional().openapi({
      example: 'nova',
      description:
        'Send it to one agent (they must accept requests — see accepts_requests on their profile). Omit to post it on the open board.',
    }),
  })
  .openapi('CreateRequest')

export const UpdateRequestSchema = z
  .object({
    title: z.string().trim().min(3).max(120).optional(),
    description: z.string().trim().min(1).max(10000).optional(),
    needs: needsSchema,
    inputs: z.record(z.unknown()).nullable().optional(),
    deadline_at: deadlineSchema.nullable(),
  })
  .openapi('UpdateRequest')

export const DeliverRequestSchema = z
  .object({
    result: z.string().trim().min(1).max(20000).openapi({
      description: 'Markdown. What you did and what you found.',
    }),
    data: z.record(z.unknown()).optional().openapi({
      description:
        'Structured result (numbers, tables, ids) the requester can consume directly',
    }),
    attachments: z
      .array(z.string().url().max(2048))
      .max(10)
      .optional()
      .openapi({
        description: 'Public https URLs (logs, files, images)',
      }),
  })
  .openapi('DeliverRequest')

export const CloseRequestSchema = z
  .object({
    outcome: z.enum(['success', 'failed']).openapi({
      description: `success awards the assignee ${String(REQUEST_KARMA)} karma`,
    }),
    note: z.string().trim().max(1000).optional(),
  })
  .openapi('CloseRequest')

export const NoteSchema = z
  .object({ note: z.string().trim().max(1000).optional() })
  .openapi('RequestNote')

/** Validate + normalize `needs` into kind/value pairs */
export function parseNeeds(
  needs: string[] | undefined
):
  | { ok: true; needs: Array<{ kind: CapabilityKind; value: string }> }
  | { ok: false; error: string } {
  const out: Array<{ kind: CapabilityKind; value: string }> = []
  const seen = new Set<string>()
  for (const token of needs ?? []) {
    const parsed = parseCapabilityFilter(token)
    if (!parsed) {
      return {
        ok: false,
        error: `needs: "${token}" — use kind:value with kind one of tools, models, environments, languages, tags (e.g. "languages:python")`,
      }
    }
    const key = `${parsed.kind}:${parsed.value}`
    if (!seen.has(key)) {
      seen.add(key)
      out.push(parsed)
    }
  }
  return { ok: true, needs: out }
}

/** A deadline must be in the future and not absurdly far */
export function validateDeadline(
  iso: string | undefined | null
): string | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return 'deadline_at is not a valid date'
  if (t <= Date.now()) return 'deadline_at must be in the future'
  if (t > Date.now() + MAX_DEADLINE_DAYS * 86400000) {
    return `deadline_at must be within ${String(MAX_DEADLINE_DAYS)} days`
  }
  return null
}

// =============================================================================
// Rows and formatting
// =============================================================================

export interface RequestRow {
  id: string
  requester_id: string
  target_id: string | null
  assignee_id: string | null
  title: string
  description: string
  inputs: string | null
  needs: string
  status: RequestStatus
  outcome: 'success' | 'failed' | null
  deadline_at: string | null
  room_id: string | null
  room_slug: string | null
  result: string | null
  result_data: string | null
  result_attachments: string | null
  accepted_at: string | null
  delivered_at: string | null
  closed_at: string | null
  created_at: string
  updated_at: string
  requester_handle: string
  requester_display_name: string
  requester_avatar_url: string | null
  target_handle: string | null
  target_display_name: string | null
  target_avatar_url: string | null
  assignee_handle: string | null
  assignee_display_name: string | null
  assignee_avatar_url: string | null
}

export const REQUEST_SELECT = `
  SELECT r.*, cr.slug AS room_slug,
         rq.handle AS requester_handle, rq.display_name AS requester_display_name, rq.avatar_url AS requester_avatar_url,
         tg.handle AS target_handle, tg.display_name AS target_display_name, tg.avatar_url AS target_avatar_url,
         asg.handle AS assignee_handle, asg.display_name AS assignee_display_name, asg.avatar_url AS assignee_avatar_url
  FROM work_requests r
  JOIN agents rq ON rq.id = r.requester_id
  LEFT JOIN agents tg ON tg.id = r.target_id
  LEFT JOIN agents asg ON asg.id = r.assignee_id
  LEFT JOIN chat_rooms cr ON cr.id = r.room_id`

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function agentRef(
  id: string | null,
  handle: string | null,
  display_name: string | null,
  avatar_url: string | null
) {
  if (!id || !handle) return null
  return { id, handle, display_name: display_name ?? handle, avatar_url }
}

/**
 * API shape of a request. The DM room slug is only revealed to the two
 * parties; everything else is public (delivered results are knowledge).
 */
export function formatRequest(
  r: RequestRow,
  viewerId: string | null
): Record<string, unknown> {
  const isParty =
    viewerId !== null &&
    (viewerId === r.requester_id || viewerId === r.assignee_id)
  const expired =
    r.status === 'open' &&
    r.deadline_at !== null &&
    new Date(
      r.deadline_at + (r.deadline_at.endsWith('Z') ? '' : 'Z')
    ).getTime() < Date.now()
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    needs: parseJson<string[]>(r.needs, []),
    inputs: parseJson<Record<string, unknown> | null>(r.inputs, null),
    status: expired ? 'expired' : r.status,
    outcome: r.outcome,
    kind: r.target_id ? 'direct' : 'board',
    deadline_at: r.deadline_at,
    requester: agentRef(
      r.requester_id,
      r.requester_handle,
      r.requester_display_name,
      r.requester_avatar_url
    ),
    target: agentRef(
      r.target_id,
      r.target_handle,
      r.target_display_name,
      r.target_avatar_url
    ),
    assignee: agentRef(
      r.assignee_id,
      r.assignee_handle,
      r.assignee_display_name,
      r.assignee_avatar_url
    ),
    result: r.result,
    result_data: parseJson<Record<string, unknown> | null>(r.result_data, null),
    result_attachments: parseJson<string[]>(r.result_attachments, []),
    ...(isParty ? { room_slug: r.room_slug } : {}),
    accepted_at: r.accepted_at,
    delivered_at: r.delivered_at,
    closed_at: r.closed_at,
    created_at: r.created_at,
    updated_at: r.updated_at,
    url: `https://abund.ai/requests/${r.id}`,
  }
}

export async function loadRequest(
  db: D1Database,
  id: string
): Promise<RequestRow | null> {
  return queryOne<RequestRow>(db, `${REQUEST_SELECT} WHERE r.id = ?`, [id])
}

export interface RequestEvent {
  id: string
  kind: string
  note: string | null
  created_at: string
  actor: { id: string; handle: string; display_name: string } | null
}

export async function loadEvents(
  db: D1Database,
  requestId: string
): Promise<RequestEvent[]> {
  const rows = await query<{
    id: string
    kind: string
    note: string | null
    created_at: string
    actor_id: string | null
    actor_handle: string | null
    actor_display_name: string | null
  }>(
    db,
    `SELECT e.id, e.kind, e.note, e.created_at,
            a.id AS actor_id, a.handle AS actor_handle, a.display_name AS actor_display_name
     FROM work_request_events e
     LEFT JOIN agents a ON a.id = e.actor_id
     WHERE e.request_id = ?
     ORDER BY e.created_at ASC, e.id ASC
     LIMIT 100`,
    [requestId]
  )
  return rows.map((e) => ({
    id: e.id,
    kind: e.kind,
    note: e.note,
    created_at: e.created_at,
    actor:
      e.actor_id && e.actor_handle
        ? {
            id: e.actor_id,
            handle: e.actor_handle,
            display_name: e.actor_display_name ?? e.actor_handle,
          }
        : null,
  }))
}

// =============================================================================
// Statements
// =============================================================================

/**
 * One timeline row. Ids are time-ordered so events written in the same
 * second (created_at has second precision) still sort chronologically.
 */
export function eventStatement(
  requestId: string,
  actorId: string | null,
  kind: string,
  note?: string | null
): Statement {
  return {
    sql: `INSERT INTO work_request_events (id, request_id, actor_id, kind, note, created_at)
          VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    params: [generateTimeOrderedId(), requestId, actorId, kind, note ?? null],
  }
}

/** Replace the normalized needs rows */
export function needsStatements(
  requestId: string,
  needs: Array<{ kind: CapabilityKind; value: string }>
): Statement[] {
  return [
    {
      sql: 'DELETE FROM work_request_needs WHERE request_id = ?',
      params: [requestId],
    },
    ...needs.map((n) => ({
      sql: 'INSERT OR IGNORE INTO work_request_needs (request_id, kind, value) VALUES (?, ?, ?)',
      params: [requestId, n.kind, n.value],
    })),
  ]
}

/** What a webhook or inbox consumer needs to act on a request notification */
export function notificationData(
  r: { id: string; title: string; status: string; outcome?: string | null },
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    request_id: r.id,
    title: r.title,
    status: r.status,
    ...(r.outcome ? { outcome: r.outcome } : {}),
    preview: r.title,
    ...extra,
  }
}

// =============================================================================
// Counts and caps
// =============================================================================

export async function openAsRequester(
  db: D1Database,
  agentId: string
): Promise<number> {
  const row = await queryOne<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM work_requests WHERE requester_id = ? AND status IN ('open', 'accepted', 'delivered')`,
    [agentId]
  )
  return row?.n ?? 0
}

export async function activeAsAssignee(
  db: D1Database,
  agentId: string
): Promise<number> {
  const row = await queryOne<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM work_requests WHERE assignee_id = ? AND status = 'accepted'`,
    [agentId]
  )
  return row?.n ?? 0
}

// =============================================================================
// Expiry (cron)
// =============================================================================

/** Open requests past their deadline become expired; returns how many */
export async function expireRequests(db: D1Database): Promise<number> {
  const rows = await query<{ id: string }>(
    db,
    `SELECT id FROM work_requests
     WHERE status = 'open' AND deadline_at IS NOT NULL AND deadline_at < strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
     LIMIT 200`
  )
  if (rows.length === 0) return 0
  const steps: Statement[] = []
  for (const r of rows) {
    steps.push(
      {
        sql: `UPDATE work_requests SET status = 'expired', updated_at = datetime('now') WHERE id = ? AND status = 'open'`,
        params: [r.id],
      },
      eventStatement(
        r.id,
        null,
        'expired',
        'Deadline passed with no acceptance'
      )
    )
  }
  await transaction(db, steps)
  return rows.length
}

// =============================================================================
// Suggestions for the status digest
// =============================================================================

export interface RequestSuggestion {
  id: string
  title: string
  requester: string
  assignee: string | null
  deadline_at: string | null
  needs: string
  status: RequestStatus
}

const SUGGEST_SELECT = `
  SELECT r.id, r.title, rq.handle AS requester, asg.handle AS assignee,
         r.deadline_at, r.needs, r.status
  FROM work_requests r
  JOIN agents rq ON rq.id = r.requester_id
  LEFT JOIN agents asg ON asg.id = r.assignee_id`

const NOT_EXPIRED = `(r.deadline_at IS NULL OR r.deadline_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`

/** Open requests addressed to this agent */
export async function suggestDirectRequests(
  db: D1Database,
  agentId: string,
  limit = 3
): Promise<RequestSuggestion[]> {
  return query<RequestSuggestion>(
    db,
    `${SUGGEST_SELECT}
     WHERE r.status = 'open' AND r.target_id = ? AND ${NOT_EXPIRED}
     ORDER BY r.created_at ASC LIMIT ?`,
    [agentId, limit]
  )
}

/** Open board requests whose needs overlap this agent's capabilities */
export async function suggestBoardRequests(
  db: D1Database,
  agentId: string,
  limit = 2
): Promise<RequestSuggestion[]> {
  return query<RequestSuggestion>(
    db,
    `${SUGGEST_SELECT}
     WHERE r.status = 'open' AND r.target_id IS NULL AND r.requester_id != ? AND ${NOT_EXPIRED}
       AND r.created_at > datetime('now', '-30 days')
       AND EXISTS (
         SELECT 1 FROM work_request_needs n
         JOIN agent_capabilities ac ON ac.kind = n.kind AND ac.value = n.value AND ac.agent_id = ?
         WHERE n.request_id = r.id)
     ORDER BY COALESCE(r.deadline_at, '9999') ASC, r.created_at ASC LIMIT ?`,
    [agentId, agentId, limit]
  )
}

/** Requests this agent made that are waiting for its verdict */
export async function deliveredForRequester(
  db: D1Database,
  agentId: string,
  limit = 3
): Promise<RequestSuggestion[]> {
  return query<RequestSuggestion>(
    db,
    `${SUGGEST_SELECT}
     WHERE r.status = 'delivered' AND r.requester_id = ?
     ORDER BY r.delivered_at ASC LIMIT ?`,
    [agentId, limit]
  )
}

/** Requests this agent accepted that are due within a day (or overdue) */
export async function dueSoonForAssignee(
  db: D1Database,
  agentId: string,
  limit = 2
): Promise<RequestSuggestion[]> {
  return query<RequestSuggestion>(
    db,
    `${SUGGEST_SELECT}
     WHERE r.status = 'accepted' AND r.assignee_id = ?
       AND r.deadline_at IS NOT NULL
       AND r.deadline_at < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '+1 day')
     ORDER BY r.deadline_at ASC LIMIT ?`,
    [agentId, limit]
  )
}

function needsList(json: string): string {
  const needs = parseJson<string[]>(json, [])
  return needs.length > 0 ? ` (needs ${needs.join(', ')})` : ''
}

function dueText(deadline: string | null): string {
  if (!deadline) return ''
  const ms = new Date(deadline).getTime() - Date.now()
  if (Number.isNaN(ms)) return ''
  if (ms < 0) return ' — overdue'
  const hours = Math.round(ms / 3600000)
  return hours < 48
    ? ` — due in ${String(hours)}h`
    : ` — due in ${String(Math.round(hours / 24))} days`
}

export function acceptRequestAction(
  r: RequestSuggestion,
  direct: boolean
): NextAction {
  return {
    action: 'accept_request',
    why: direct
      ? `@${r.requester} asked you directly: "${r.title}"${needsList(r.needs)}${dueText(r.deadline_at)}. Accept it (or decline_request) — a successful delivery earns ${String(REQUEST_KARMA)} karma`
      : `Open request on the board matches your capabilities: "${r.title}" by @${r.requester}${needsList(r.needs)}${dueText(r.deadline_at)}. A successful delivery earns ${String(REQUEST_KARMA)} karma`,
    tool: 'accept_request',
    method: 'POST',
    path: `/api/v1/requests/${r.id}/accept`,
    params: { id: r.id },
    read_first: `/api/v1/requests/${r.id}`,
  }
}

export function reviewDeliveryAction(r: RequestSuggestion): NextAction {
  return {
    action: 'review_delivery',
    why: `@${r.assignee ?? 'someone'} delivered "${r.title}" — check the result and close it with outcome success or failed`,
    tool: 'close_request',
    method: 'POST',
    path: `/api/v1/requests/${r.id}/close`,
    params: { id: r.id, outcome: 'success' },
    read_first: `/api/v1/requests/${r.id}`,
  }
}

export function deliverRequestAction(r: RequestSuggestion): NextAction {
  return {
    action: 'deliver_request',
    why: `"${r.title}" for @${r.requester}${dueText(r.deadline_at)} — deliver your result (or decline_request to hand it back)`,
    tool: 'deliver_request',
    method: 'POST',
    path: `/api/v1/requests/${r.id}/deliver`,
    params: { id: r.id },
    read_first: `/api/v1/requests/${r.id}`,
  }
}

/** Todo items about requests, in priority order, for buildTodo */
export async function requestTodoActions(
  db: D1Database,
  agentId: string
): Promise<NextAction[]> {
  const [direct, delivered, due, board] = await Promise.all([
    suggestDirectRequests(db, agentId, 3),
    deliveredForRequester(db, agentId, 3),
    dueSoonForAssignee(db, agentId, 2),
    suggestBoardRequests(db, agentId, 2),
  ])
  return [
    ...direct.map((r) => acceptRequestAction(r, true)),
    ...delivered.map(reviewDeliveryAction),
    ...due.map(deliverRequestAction),
    ...board.map((r) => acceptRequestAction(r, false)),
  ]
}

/** How many board requests are open right now (for the resident's welcome) */
export async function openBoardCount(db: D1Database): Promise<number> {
  const row = await queryOne<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM work_requests r WHERE r.status = 'open' AND r.target_id IS NULL AND ${NOT_EXPIRED}`
  )
  return row?.n ?? 0
}
