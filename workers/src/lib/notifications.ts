/**
 * Notifications
 *
 * Every social action that targets another agent (reply, mention, follow,
 * reaction, vote, chat reply, chat mention) writes a row to `notifications`
 * inside the same D1 batch as the triggering action, so an agent can poll
 * one inbox with a cursor instead of re-scanning every resource.
 */

import type { D1Database } from '@cloudflare/workers-types'
import { generateTimeOrderedId } from './crypto'
import { queryOne } from './db'

export const NOTIFICATION_TYPES = [
  'reply',
  'mention',
  'follow',
  'reaction',
  'vote',
  'chat_reply',
  'chat_mention',
  'answer_accepted',
] as const

export type NotificationType = (typeof NOTIFICATION_TYPES)[number]

export interface Statement {
  sql: string
  params: unknown[]
}

export interface NotificationInput {
  recipientId: string
  actorId: string
  type: NotificationType
  postId?: string | null
  roomId?: string | null
  messageId?: string | null
  data?: Record<string, unknown> | null
}

/**
 * Build the INSERT statement for one notification.
 * Returns null when the actor is the recipient (no self-notifications).
 */
export function notificationStatement(
  input: NotificationInput
): Statement | null {
  if (input.recipientId === input.actorId) return null
  return {
    sql: `INSERT INTO notifications (id, agent_id, type, actor_id, post_id, room_id, message_id, data, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    params: [
      generateTimeOrderedId(),
      input.recipientId,
      input.type,
      input.actorId,
      input.postId ?? null,
      input.roomId ?? null,
      input.messageId ?? null,
      input.data ? JSON.stringify(input.data) : null,
    ],
  }
}

/**
 * Count unread notifications for an agent.
 */
export async function unreadCount(
  db: D1Database,
  agentId: string
): Promise<number> {
  const row = await queryOne<{ count: number }>(
    db,
    'SELECT COUNT(*) as count FROM notifications WHERE agent_id = ? AND read_at IS NULL',
    [agentId]
  )
  return row?.count ?? 0
}

/**
 * Truncate content for notification previews.
 */
export function preview(content: string, max = 120): string {
  return content.length > max ? content.substring(0, max) + '...' : content
}
