/**
 * A2A push notifications (spec §4.3)
 *
 * A client registers a URL per task. The every-minute cron compares each
 * config's last delivered (state, status timestamp) with the task's current
 * one and, when they differ, POSTs a StreamResponse `{"task": Task}` snapshot
 * with the client's Authorization. Failures back off like account webhooks
 * and a config is disabled after MAX_FAILURES in a row.
 */

import type { D1Database } from '@cloudflare/workers-types'
import { execute, query, queryOne } from '../db'
import { generateId } from '../crypto'
import { loadRequest } from '../requests'
import { validateWebhookUrl } from '../webhooks'
import {
  A2AError,
  type PushConfigInput,
  type TaskPushNotificationConfig,
} from './protocol'
import { STATUS_TS_SQL, TASK_STATE_SQL, toTask, type TaskRow } from './tasks'

export const MAX_CONFIGS_PER_TASK = 5
const MAX_FAILURES = 10
const CONFIGS_PER_RUN = 50
const TIMEOUT_MS = 10_000

interface PushConfigRow {
  id: string
  task_id: string
  agent_id: string
  url: string
  token: string | null
  auth_scheme: string | null
  auth_credentials: string | null
  last_state: string | null
  last_status_at: string | null
  failure_count: number
  last_attempt_at: string | null
  last_error: string | null
  disabled_at: string | null
  created_at: string
}

/** Public shape: credentials are write-only */
export function publicConfig(row: PushConfigRow): TaskPushNotificationConfig {
  return {
    id: row.id,
    taskId: row.task_id,
    url: row.url,
    ...(row.token ? { token: row.token } : {}),
    ...(row.auth_scheme ? { authentication: { scheme: row.auth_scheme } } : {}),
  }
}

export async function createConfig(
  db: D1Database,
  environment: string | undefined,
  agentId: string,
  taskId: string,
  input: PushConfigInput
): Promise<TaskPushNotificationConfig> {
  const urlError = validateWebhookUrl(input.url, environment)
  if (urlError) {
    throw new A2AError('INVALID_PARAMS', `url: ${urlError}`, {}, [
      { field: 'url', description: urlError },
    ])
  }
  // Same task, same URL: a retry, not a second subscriber
  const existing = await queryOne<PushConfigRow>(
    db,
    'SELECT * FROM a2a_push_configs WHERE task_id = ? AND url = ?',
    [taskId, input.url]
  )
  if (existing) return publicConfig(existing)
  const count = await queryOne<{ n: number }>(
    db,
    'SELECT COUNT(*) AS n FROM a2a_push_configs WHERE task_id = ?',
    [taskId]
  )
  if ((count?.n ?? 0) >= MAX_CONFIGS_PER_TASK) {
    throw new A2AError(
      'INVALID_PARAMS',
      `A task has at most ${String(MAX_CONFIGS_PER_TASK)} push notification configs; delete one first`
    )
  }
  const id = generateId()
  await execute(
    db,
    `INSERT INTO a2a_push_configs (id, task_id, agent_id, url, token, auth_scheme, auth_credentials)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      taskId,
      agentId,
      input.url,
      input.token ?? null,
      input.authentication?.scheme ?? null,
      input.authentication?.credentials ?? null,
    ]
  )
  const row = await queryOne<PushConfigRow>(
    db,
    'SELECT * FROM a2a_push_configs WHERE id = ?',
    [id]
  )
  if (!row)
    throw new A2AError('INTERNAL', 'Push notification config was not stored')
  return publicConfig(row)
}

export async function getConfig(
  db: D1Database,
  taskId: string,
  id: string
): Promise<TaskPushNotificationConfig> {
  const row = await queryOne<PushConfigRow>(
    db,
    'SELECT * FROM a2a_push_configs WHERE id = ? AND task_id = ?',
    [id, taskId]
  )
  if (!row) {
    throw new A2AError('TASK_NOT_FOUND', 'Push notification config not found', {
      taskId,
      configId: id,
    })
  }
  return publicConfig(row)
}

export async function listConfigs(
  db: D1Database,
  taskId: string,
  pageSize: number | undefined,
  pageToken: string | undefined
): Promise<{ configs: TaskPushNotificationConfig[]; nextPageToken: string }> {
  const size = pageSize && pageSize > 0 ? pageSize : MAX_CONFIGS_PER_TASK
  const rows = await query<PushConfigRow>(
    db,
    `SELECT * FROM a2a_push_configs WHERE task_id = ? AND (? IS NULL OR id > ?)
     ORDER BY id LIMIT ?`,
    [taskId, pageToken ?? null, pageToken ?? null, size + 1]
  )
  const page = rows.slice(0, size)
  return {
    configs: page.map(publicConfig),
    nextPageToken: rows.length > size ? (page[page.length - 1]?.id ?? '') : '',
  }
}

export async function deleteConfig(
  db: D1Database,
  taskId: string,
  id: string
): Promise<void> {
  const result = await execute(
    db,
    'DELETE FROM a2a_push_configs WHERE id = ? AND task_id = ?',
    [id, taskId]
  )
  if ((result.meta.changes ?? 0) === 0) {
    throw new A2AError('TASK_NOT_FOUND', 'Push notification config not found', {
      taskId,
      configId: id,
    })
  }
}

// =============================================================================
// Delivery
// =============================================================================

/** Exponential backoff after failures: 1, 2, 4 … 60 minutes */
function backoffMinutes(failures: number): number {
  return Math.min(2 ** Math.max(failures - 1, 0), 60)
}

export interface PushSummary {
  due: number
  delivered: number
  failed: number
  disabled: number
}

type DueRow = PushConfigRow & { cur_state: string; status_ts: string }

export async function deliverPushes(
  db: D1Database,
  fetchImpl: typeof fetch = fetch,
  now = new Date()
): Promise<PushSummary> {
  const due = await query<DueRow>(
    db,
    `SELECT * FROM (
       SELECT p.*, ${TASK_STATE_SQL} AS cur_state, ${STATUS_TS_SQL} AS status_ts
       FROM a2a_push_configs p
       JOIN a2a_tasks t ON t.id = p.task_id
       LEFT JOIN work_requests r ON r.id = t.request_id
       WHERE p.disabled_at IS NULL
     )
     WHERE last_state IS NULL OR last_state != cur_state OR last_status_at IS NULL OR last_status_at != status_ts
     ORDER BY last_attempt_at ASC
     LIMIT ?`,
    [CONFIGS_PER_RUN]
  )
  const summary: PushSummary = {
    due: due.length,
    delivered: 0,
    failed: 0,
    disabled: 0,
  }

  for (const config of due) {
    if (config.failure_count > 0 && config.last_attempt_at) {
      const last = new Date(
        config.last_attempt_at.replace(' ', 'T') + 'Z'
      ).getTime()
      if (
        now.getTime() - last <
        backoffMinutes(config.failure_count) * 60_000
      ) {
        continue
      }
    }

    const row = await queryOne<TaskRow>(
      db,
      'SELECT * FROM a2a_tasks WHERE id = ?',
      [config.task_id]
    )
    if (!row) continue
    const request = row.request_id
      ? await loadRequest(db, row.request_id)
      : null
    const task = toTask(row, request, { historyLength: 0 })

    const headers: Record<string, string> = {
      'Content-Type': 'application/a2a+json',
      'User-Agent': 'abund.ai-a2a/1 (+https://abund.ai/skill.md)',
    }
    if (config.auth_scheme) {
      headers.Authorization = config.auth_credentials
        ? `${config.auth_scheme} ${config.auth_credentials}`
        : config.auth_scheme
    }
    if (config.token) headers['X-A2A-Notification-Token'] = config.token

    const controller = new AbortController()
    const timer = setTimeout(() => {
      controller.abort()
    }, TIMEOUT_MS)
    let ok = false
    let error: string | null = null
    try {
      const res = await fetchImpl(config.url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ task }),
        signal: controller.signal,
        redirect: 'manual',
      })
      await res.text().catch(() => '')
      ok = res.status >= 200 && res.status < 300
      if (!ok) error = `HTTP ${String(res.status)}`
    } catch (err) {
      error = (err instanceof Error ? err.message : String(err)).slice(0, 200)
    } finally {
      clearTimeout(timer)
    }

    if (ok) {
      summary.delivered++
      await execute(
        db,
        `UPDATE a2a_push_configs
         SET last_state = ?, last_status_at = ?, failure_count = 0,
             last_attempt_at = datetime('now'), last_error = NULL
         WHERE id = ?`,
        [config.cur_state, config.status_ts, config.id]
      )
    } else {
      summary.failed++
      const failures = config.failure_count + 1
      const disable = failures >= MAX_FAILURES
      if (disable) summary.disabled++
      await execute(
        db,
        `UPDATE a2a_push_configs
         SET failure_count = ?, last_attempt_at = datetime('now'), last_error = ?
             ${disable ? ", disabled_at = datetime('now')" : ''}
         WHERE id = ?`,
        [failures, error, config.id]
      )
    }
  }
  return summary
}
