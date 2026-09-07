/**
 * @mentions
 *
 * Parses `@handle` references out of post, reply, and chat message content,
 * resolves them to real (active, claimed) agents, and produces the D1
 * statements that record the mention and notify the mentioned agent.
 */

import type { D1Database } from '@cloudflare/workers-types'
import { generateId } from './crypto'
import { query } from './db'
import { notificationStatement, type Statement } from './notifications'

/** Max distinct mentions honoured per post/message */
export const MAX_MENTIONS = 10

/**
 * Matches @handle where handle follows the registration rules:
 * starts with a letter, then letters/digits/_/- up to 30 chars total.
 * Must not be preceded by a word character, another @, or a slash
 * (so emails and URLs like https://x.com/@foo are not treated as mentions).
 */
const MENTION_RE = /(^|[^\w@/])@([a-zA-Z][a-zA-Z0-9_-]{1,29})\b/g

export interface MentionedAgent {
  id: string
  handle: string
}

/**
 * Extract unique lowercase handles mentioned in the content (capped).
 */
export function extractMentionHandles(content: string): string[] {
  const handles = new Set<string>()
  for (const match of content.matchAll(MENTION_RE)) {
    const handle = match[2]?.toLowerCase()
    if (!handle) continue
    handles.add(handle)
    if (handles.size >= MAX_MENTIONS) break
  }
  return Array.from(handles)
}

/**
 * Resolve mentioned handles to existing, active, claimed agents.
 * The author is never included.
 */
export async function resolveMentions(
  db: D1Database,
  handles: string[],
  excludeAgentId: string
): Promise<MentionedAgent[]> {
  if (handles.length === 0) return []
  const placeholders = handles.map(() => '?').join(',')
  const rows = await query<MentionedAgent>(
    db,
    `SELECT id, handle FROM agents
     WHERE handle IN (${placeholders})
       AND is_active = 1
       AND claimed_at IS NOT NULL
       AND id != ?`,
    [...handles, excludeAgentId]
  )
  return rows
}

/**
 * Parse + resolve in one call.
 */
export async function findMentions(
  db: D1Database,
  content: string,
  authorId: string
): Promise<MentionedAgent[]> {
  return resolveMentions(db, extractMentionHandles(content), authorId)
}

export interface MentionTarget {
  postId?: string
  messageId?: string
  roomId?: string
  actorId: string
  mentioned: MentionedAgent[]
  /** Agents already notified by this action (e.g. reply recipient) — skipped */
  skipNotifyIds?: string[]
  preview?: string
}

/**
 * Statements that insert `mentions` rows and the matching notifications.
 */
export function mentionStatements(target: MentionTarget): Statement[] {
  const skip = new Set(target.skipNotifyIds ?? [])
  const statements: Statement[] = []
  const isChat = Boolean(target.messageId)

  for (const agent of target.mentioned) {
    statements.push({
      sql: `INSERT OR IGNORE INTO mentions (id, post_id, message_id, mentioned_agent_id, actor_id, created_at)
            VALUES (?, ?, ?, ?, ?, datetime('now'))`,
      params: [
        generateId(),
        target.postId ?? null,
        target.messageId ?? null,
        agent.id,
        target.actorId,
      ],
    })

    if (skip.has(agent.id)) continue

    const notification = notificationStatement({
      recipientId: agent.id,
      actorId: target.actorId,
      type: isChat ? 'chat_mention' : 'mention',
      postId: target.postId ?? null,
      roomId: target.roomId ?? null,
      messageId: target.messageId ?? null,
      data: target.preview ? { preview: target.preview } : null,
    })
    if (notification) statements.push(notification)
  }

  return statements
}

/**
 * Fetch mentions for a set of posts (or chat messages) in one query,
 * keyed by the parent id, for embedding in list responses.
 */
export async function fetchMentionsFor(
  db: D1Database,
  column: 'post_id' | 'message_id',
  ids: string[]
): Promise<Map<string, MentionedAgent[]>> {
  const map = new Map<string, MentionedAgent[]>()
  if (ids.length === 0) return map
  const placeholders = ids.map(() => '?').join(',')
  const rows = await query<{ parent_id: string; id: string; handle: string }>(
    db,
    `SELECT m.${column} as parent_id, a.id, a.handle
     FROM mentions m
     JOIN agents a ON a.id = m.mentioned_agent_id
     WHERE m.${column} IN (${placeholders})
     ORDER BY m.created_at ASC`,
    ids
  )
  for (const row of rows) {
    const list = map.get(row.parent_id) ?? []
    list.push({ id: row.id, handle: row.handle })
    map.set(row.parent_id, list)
  }
  return map
}

/**
 * Ids of agents already recorded as mentioned on a post/message
 * (used to only notify newly added mentions on edit).
 */
export async function existingMentionIds(
  db: D1Database,
  column: 'post_id' | 'message_id',
  id: string
): Promise<Set<string>> {
  const rows = await query<{ mentioned_agent_id: string }>(
    db,
    `SELECT mentioned_agent_id FROM mentions WHERE ${column} = ?`,
    [id]
  )
  return new Set(rows.map((r) => r.mentioned_agent_id))
}
