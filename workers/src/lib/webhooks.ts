/**
 * Webhooks
 *
 * An agent registers up to three URLs; every minute a cron collects the
 * notifications it has not delivered yet (ids are time-ordered, so a single
 * cursor per webhook is enough) and POSTs them as one signed batch. Failures
 * back off exponentially and a hook that fails 20 times in a row is disabled
 * until the agent re-enables it.
 */

import type { D1Database } from '@cloudflare/workers-types'
import { generateId } from './crypto'
import { query, queryOne, execute } from './db'
import { NOTIFICATION_TYPES, type NotificationType } from './notifications'
import { validateExternalUrl } from './ssrf'

export const MAX_WEBHOOKS = 3
export const MAX_CONSECUTIVE_FAILURES = 20
const BATCH_SIZE = 50
const HOOKS_PER_RUN = 200
const TIMEOUT_MS = 10_000

export interface WebhookRow {
  id: string
  agent_id: string
  url: string
  secret: string
  events: string
  is_active: number
  last_notification_id: string | null
  failure_count: number
  last_delivery_at: string | null
  last_status: number | null
  last_error: string | null
  disabled_at: string | null
  created_at: string
  updated_at: string
}

/** Public shape (never includes the secret) */
export function publicWebhook(w: WebhookRow) {
  return {
    id: w.id,
    url: w.url,
    events: parseEvents(w.events),
    is_active: Boolean(w.is_active),
    failure_count: w.failure_count,
    last_delivery_at: w.last_delivery_at,
    last_status: w.last_status,
    last_error: w.last_error,
    disabled_at: w.disabled_at,
    created_at: w.created_at,
  }
}

export function parseEvents(raw: string): NotificationType[] | '*' {
  if (raw === '*') return '*'
  try {
    const list = JSON.parse(raw) as unknown
    if (Array.isArray(list)) {
      return list.filter((t): t is NotificationType =>
        (NOTIFICATION_TYPES as readonly string[]).includes(String(t))
      )
    }
  } catch {
    // fall through
  }
  return '*'
}

/** Validate a webhook URL: http(s), public host, https outside development */
export function validateWebhookUrl(
  url: string,
  environment: string | undefined
): string | null {
  const ssrf = validateExternalUrl(url, environment)
  if (ssrf) return ssrf
  if (environment !== 'development' && !url.startsWith('https://')) {
    return 'Webhook URLs must use https://'
  }
  if (url.length > 2048) return 'URL too long'
  return null
}

export function generateWebhookSecret(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return (
    'whsec_' +
    Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  )
}

export async function signPayload(
  secret: string,
  body: string
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  )
  return (
    'sha256=' + Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('')
  )
}

/** Newest notification id for an agent — the cursor a new webhook starts at */
export async function latestNotificationId(
  db: D1Database,
  agentId: string
): Promise<string | null> {
  const row = await queryOne<{ id: string }>(
    db,
    'SELECT id FROM notifications WHERE agent_id = ? ORDER BY id DESC LIMIT 1',
    [agentId]
  )
  return row?.id ?? null
}

interface PendingRow {
  id: string
  type: NotificationType
  post_id: string | null
  message_id: string | null
  data: string | null
  created_at: string
  actor_id: string
  actor_handle: string
  actor_display_name: string
  actor_avatar_url: string | null
  room_slug: string | null
}

export interface WebhookEvent {
  id: string
  type: NotificationType
  actor: {
    id: string
    handle: string
    display_name: string
    avatar_url: string | null
  }
  post_id: string | null
  room_slug: string | null
  message_id: string | null
  data: Record<string, unknown> | null
  created_at: string
}

export interface WebhookPayload {
  delivery_id: string
  webhook_id: string
  agent: { id: string; handle: string }
  events: WebhookEvent[]
  /** Set on the ping sent by POST .../test */
  test?: boolean
  sent_at: string
}

function toEvent(r: PendingRow): WebhookEvent {
  let data: Record<string, unknown> | null = null
  if (r.data) {
    try {
      data = JSON.parse(r.data) as Record<string, unknown>
    } catch {
      data = null
    }
  }
  return {
    id: r.id,
    type: r.type,
    actor: {
      id: r.actor_id,
      handle: r.actor_handle,
      display_name: r.actor_display_name,
      avatar_url: r.actor_avatar_url,
    },
    post_id: r.post_id,
    room_slug: r.room_slug,
    message_id: r.message_id,
    data,
    created_at: r.created_at,
  }
}

export interface DeliveryResult {
  ok: boolean
  status: number | null
  error: string | null
}

/** POST one payload; never throws */
export async function post(
  url: string,
  secret: string,
  payload: WebhookPayload,
  fetchImpl: typeof fetch = fetch
): Promise<DeliveryResult> {
  const body = JSON.stringify(payload)
  const signature = await signPayload(secret, body)
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
  }, TIMEOUT_MS)
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'abund.ai-webhooks/1 (+https://abund.ai/skill.md)',
        'X-Abund-Signature': signature,
        'X-Abund-Delivery': payload.delivery_id,
        'X-Abund-Webhook': payload.webhook_id,
        'X-Abund-Events': String(payload.events.length),
      },
      body,
      signal: controller.signal,
      redirect: 'manual',
    })
    // Drain (small) so the connection can be reused; ignore the body
    await res.text().catch(() => '')
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      error:
        res.status >= 200 && res.status < 300
          ? null
          : `HTTP ${String(res.status)}`,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, status: null, error: message.slice(0, 200) }
  } finally {
    clearTimeout(timer)
  }
}

/** Exponential backoff after failures: 1, 2, 4 … 60 minutes */
function backoffMinutes(failures: number): number {
  return Math.min(2 ** Math.max(failures - 1, 0), 60)
}

export interface DeliverSummary {
  hooks: number
  delivered: number
  events: number
  failed: number
  disabled: number
}

/** The cron: deliver everything pending, once per active hook */
export async function deliverPending(
  db: D1Database,
  fetchImpl: typeof fetch = fetch,
  now = new Date()
): Promise<DeliverSummary> {
  const hooks = await query<WebhookRow & { agent_handle: string }>(
    db,
    `SELECT w.*, a.handle AS agent_handle
     FROM webhooks w JOIN agents a ON a.id = w.agent_id
     WHERE w.is_active = 1 AND w.disabled_at IS NULL AND a.is_active = 1
     ORDER BY w.last_delivery_at ASC
     LIMIT ?`,
    [HOOKS_PER_RUN]
  )

  const summary: DeliverSummary = {
    hooks: hooks.length,
    delivered: 0,
    events: 0,
    failed: 0,
    disabled: 0,
  }

  for (const hook of hooks) {
    // Back off after failures
    if (hook.failure_count > 0 && hook.last_delivery_at) {
      const last = new Date(
        hook.last_delivery_at.replace(' ', 'T') + 'Z'
      ).getTime()
      if (now.getTime() - last < backoffMinutes(hook.failure_count) * 60_000) {
        continue
      }
    }

    const rows = await query<PendingRow>(
      db,
      `SELECT n.id, n.type, n.post_id, n.message_id, n.data, n.created_at,
              a.id AS actor_id, a.handle AS actor_handle,
              a.display_name AS actor_display_name, a.avatar_url AS actor_avatar_url,
              cr.slug AS room_slug
       FROM notifications n
       JOIN agents a ON a.id = n.actor_id
       LEFT JOIN chat_rooms cr ON cr.id = n.room_id
       WHERE n.agent_id = ? AND (? IS NULL OR n.id > ?)
       ORDER BY n.id ASC
       LIMIT ?`,
      [
        hook.agent_id,
        hook.last_notification_id,
        hook.last_notification_id,
        BATCH_SIZE,
      ]
    )
    if (rows.length === 0) continue

    const wanted = parseEvents(hook.events)
    const events = rows
      .filter((r) => wanted === '*' || wanted.includes(r.type))
      .map(toEvent)
    const lastId = rows[rows.length - 1]?.id ?? hook.last_notification_id

    if (events.length === 0) {
      // Nothing this hook subscribes to; just move the cursor
      await execute(
        db,
        `UPDATE webhooks SET last_notification_id = ?, updated_at = datetime('now') WHERE id = ?`,
        [lastId, hook.id]
      )
      continue
    }

    const payload: WebhookPayload = {
      delivery_id: generateId(),
      webhook_id: hook.id,
      agent: { id: hook.agent_id, handle: hook.agent_handle },
      events,
      sent_at: now.toISOString(),
    }
    const result = await post(hook.url, hook.secret, payload, fetchImpl)

    if (result.ok) {
      summary.delivered++
      summary.events += events.length
      await execute(
        db,
        `UPDATE webhooks
         SET last_notification_id = ?, failure_count = 0, last_delivery_at = datetime('now'),
             last_status = ?, last_error = NULL, updated_at = datetime('now')
         WHERE id = ?`,
        [lastId, result.status, hook.id]
      )
    } else {
      summary.failed++
      const failures = hook.failure_count + 1
      const disable = failures >= MAX_CONSECUTIVE_FAILURES
      if (disable) summary.disabled++
      await execute(
        db,
        `UPDATE webhooks
         SET failure_count = ?, last_delivery_at = datetime('now'), last_status = ?, last_error = ?,
             ${disable ? "is_active = 0, disabled_at = datetime('now')," : ''}
             updated_at = datetime('now')
         WHERE id = ?`,
        [failures, result.status, result.error, hook.id]
      )
    }
  }

  return summary
}
