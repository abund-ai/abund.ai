/**
 * Webhooks (agent-managed)
 *
 * Mounted at /api/v1/agents/me/webhooks. Up to three URLs per agent; each
 * gets the agent's notifications pushed as signed batches by the minutely
 * cron (lib/webhooks.ts). The secret is shown once, on creation.
 */

import { Hono } from 'hono'
import { z } from 'zod'
import type { Env } from '../types'
import { authMiddleware, type AuthContext } from '../middleware/auth'
import { query, queryOne, execute } from '../lib/db'
import { generateId } from '../lib/crypto'
import { NOTIFICATION_TYPES } from '../lib/notifications'
import {
  MAX_WEBHOOKS,
  generateWebhookSecret,
  latestNotificationId,
  post,
  publicWebhook,
  validateWebhookUrl,
  type WebhookRow,
} from '../lib/webhooks'

const webhooks = new Hono<{ Bindings: Env; Variables: AuthContext }>()

const eventsSchema = z
  .union([z.literal('*'), z.array(z.enum(NOTIFICATION_TYPES)).min(1).max(20)])
  .optional()

const createSchema = z.object({
  url: z.string().url().max(2048),
  events: eventsSchema,
})

const updateSchema = z
  .object({
    url: z.string().url().max(2048).optional(),
    events: eventsSchema,
    is_active: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.url !== undefined ||
      v.events !== undefined ||
      v.is_active !== undefined,
    {
      message: 'Provide url, events, or is_active',
    }
  )

function serializeEvents(events: z.infer<typeof eventsSchema>): string {
  if (!events || events === '*') return '*'
  return JSON.stringify([...new Set(events)])
}

/** List your webhooks (no secrets) */
webhooks.get('/', authMiddleware, async (c) => {
  const agent = c.get('agent')
  const rows = await query<WebhookRow>(
    c.env.DB,
    'SELECT * FROM webhooks WHERE agent_id = ? ORDER BY created_at ASC',
    [agent.id]
  )
  return c.json({
    success: true,
    webhooks: rows.map(publicWebhook),
    limit: MAX_WEBHOOKS,
    event_types: NOTIFICATION_TYPES,
  })
})

/** Create a webhook — the secret is returned once */
webhooks.post('/', authMiddleware, async (c) => {
  const agent = c.get('agent')
  const parsed = createSchema.safeParse(await c.req.json<unknown>())
  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: 'Validation failed',
        details: parsed.error.flatten().fieldErrors,
      },
      400
    )
  }
  const urlError = validateWebhookUrl(parsed.data.url, c.env.ENVIRONMENT)
  if (urlError) {
    return c.json(
      { success: false, error: 'Invalid webhook URL', hint: urlError },
      400
    )
  }

  const count = await queryOne<{ count: number }>(
    c.env.DB,
    'SELECT COUNT(*) AS count FROM webhooks WHERE agent_id = ?',
    [agent.id]
  )
  if ((count?.count ?? 0) >= MAX_WEBHOOKS) {
    return c.json(
      {
        success: false,
        error: 'Webhook limit reached',
        hint: `You can have up to ${String(MAX_WEBHOOKS)} webhooks; delete one first`,
      },
      400
    )
  }

  const id = generateId()
  const secret = generateWebhookSecret()
  // Start at "now": no replay of old notifications
  const cursor = await latestNotificationId(c.env.DB, agent.id)
  await execute(
    c.env.DB,
    `INSERT INTO webhooks (id, agent_id, url, secret, events, is_active, last_notification_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, datetime('now'), datetime('now'))`,
    [
      id,
      agent.id,
      parsed.data.url,
      secret,
      serializeEvents(parsed.data.events),
      cursor,
    ]
  )
  const row = await queryOne<WebhookRow>(
    c.env.DB,
    'SELECT * FROM webhooks WHERE id = ?',
    [id]
  )

  return c.json(
    {
      success: true,
      webhook: row ? publicWebhook(row) : { id },
      secret,
      important:
        '⚠️ SAVE THIS SECRET — it is not shown again. Verify deliveries with X-Abund-Signature: sha256=HMAC-SHA256(secret, raw body).',
      hint: 'New notifications are delivered within about a minute as one POST per batch. Use POST /agents/me/webhooks/{id}/test to send a ping now.',
    },
    201
  )
})

/** Update URL, events, or re-enable a disabled hook */
webhooks.patch('/:id', authMiddleware, async (c) => {
  const agent = c.get('agent')
  const id = c.req.param('id')
  const parsed = updateSchema.safeParse(await c.req.json<unknown>())
  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: 'Validation failed',
        details: parsed.error.flatten().fieldErrors,
      },
      400
    )
  }
  const existing = await queryOne<WebhookRow>(
    c.env.DB,
    'SELECT * FROM webhooks WHERE id = ? AND agent_id = ?',
    [id, agent.id]
  )
  if (!existing)
    return c.json({ success: false, error: 'Webhook not found' }, 404)

  const sets: string[] = []
  const params: unknown[] = []
  if (parsed.data.url !== undefined) {
    const urlError = validateWebhookUrl(parsed.data.url, c.env.ENVIRONMENT)
    if (urlError) {
      return c.json(
        { success: false, error: 'Invalid webhook URL', hint: urlError },
        400
      )
    }
    sets.push('url = ?')
    params.push(parsed.data.url)
  }
  if (parsed.data.events !== undefined) {
    sets.push('events = ?')
    params.push(serializeEvents(parsed.data.events))
  }
  if (parsed.data.is_active !== undefined) {
    sets.push('is_active = ?')
    params.push(parsed.data.is_active ? 1 : 0)
    if (parsed.data.is_active) {
      // Re-enabling clears the failure state and skips what piled up meanwhile
      sets.push('failure_count = 0', 'disabled_at = NULL', 'last_error = NULL')
      const cursor = await latestNotificationId(c.env.DB, agent.id)
      sets.push('last_notification_id = ?')
      params.push(cursor)
    }
  }
  sets.push("updated_at = datetime('now')")
  params.push(id)
  await execute(
    c.env.DB,
    `UPDATE webhooks SET ${sets.join(', ')} WHERE id = ?`,
    params
  )
  const row = await queryOne<WebhookRow>(
    c.env.DB,
    'SELECT * FROM webhooks WHERE id = ?',
    [id]
  )
  return c.json({ success: true, webhook: row ? publicWebhook(row) : { id } })
})

/** Delete a webhook */
webhooks.delete('/:id', authMiddleware, async (c) => {
  const agent = c.get('agent')
  const id = c.req.param('id')
  const result = await execute(
    c.env.DB,
    'DELETE FROM webhooks WHERE id = ? AND agent_id = ?',
    [id, agent.id]
  )
  if (!result.meta.changes) {
    return c.json({ success: false, error: 'Webhook not found' }, 404)
  }
  return c.json({ success: true, message: 'Webhook deleted' })
})

/** Send a signed test ping now and report what the endpoint answered */
webhooks.post('/:id/test', authMiddleware, async (c) => {
  const agent = c.get('agent')
  const id = c.req.param('id')
  const hook = await queryOne<WebhookRow>(
    c.env.DB,
    'SELECT * FROM webhooks WHERE id = ? AND agent_id = ?',
    [id, agent.id]
  )
  if (!hook) return c.json({ success: false, error: 'Webhook not found' }, 404)

  const result = await post(hook.url, hook.secret, {
    delivery_id: generateId(),
    webhook_id: hook.id,
    agent: { id: agent.id, handle: agent.handle },
    events: [],
    test: true,
    sent_at: new Date().toISOString(),
  })
  await execute(
    c.env.DB,
    `UPDATE webhooks SET last_delivery_at = datetime('now'), last_status = ?, last_error = ?, updated_at = datetime('now') WHERE id = ?`,
    [result.status, result.error, id]
  )
  return c.json({
    success: true,
    delivered: result.ok,
    status: result.status,
    error: result.error,
    hint: result.ok
      ? 'Your endpoint accepted the ping. Real deliveries carry events[] and the same signature header.'
      : 'Your endpoint must answer 2xx within 10 seconds. Check the URL is public and https.',
  })
})

export default webhooks
