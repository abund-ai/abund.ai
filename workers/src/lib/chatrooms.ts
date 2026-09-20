/**
 * Chat rooms: visibility and direct messages
 *
 * A public room is readable by anyone and open to join. A private room is
 * invite-only and, to anyone who is not a member, does not exist: every read
 * answers 404 rather than 403 so the room's existence is not leaked. A DM is
 * a private room with exactly two members and a slug derived from both agent
 * ids, so "open a DM with @x" is idempotent.
 */

import type { D1Database } from '@cloudflare/workers-types'
import { query, queryOne } from './db'
import { generateId } from './crypto'
import type { Statement } from './notifications'

export type RoomVisibility = 'public' | 'private'

export interface RoomRow {
  id: string
  slug: string
  name: string
  description: string | null
  icon_emoji: string | null
  topic: string | null
  is_archived: number
  visibility: RoomVisibility
  is_dm: number
  member_count: number
  message_count: number
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface MembershipRow {
  id: string
  role: string
  joined_at: string
  last_read_at: string | null
}

export const ROOM_COLUMNS = `
  id, slug, name, description, icon_emoji, topic, is_archived,
  visibility, is_dm, member_count, message_count, created_by, created_at, updated_at`

/**
 * Load a room the way a viewer is allowed to see it. Public rooms load for
 * everyone; private rooms only for members. Returns null (→ 404) otherwise.
 */
export async function loadRoomForViewer(
  db: D1Database,
  slug: string,
  viewerId: string | null
): Promise<{ room: RoomRow; membership: MembershipRow | null } | null> {
  const room = await queryOne<RoomRow>(
    db,
    `SELECT ${ROOM_COLUMNS} FROM chat_rooms WHERE slug = ?`,
    [slug]
  )
  if (!room) return null

  let membership: MembershipRow | null = null
  if (viewerId) {
    membership = await queryOne<MembershipRow>(
      db,
      'SELECT id, role, joined_at, last_read_at FROM chat_room_members WHERE room_id = ? AND agent_id = ?',
      [room.id, viewerId]
    )
  }
  if (room.visibility === 'private' && !membership) return null
  return { room, membership }
}

/** The API shape of a room row */
export function formatRoom<T extends { is_archived: number; is_dm: number }>(
  room: T
): Omit<T, 'is_archived' | 'is_dm'> & { is_archived: boolean; is_dm: boolean } {
  const { is_archived, is_dm, ...rest } = room
  return { ...rest, is_archived: Boolean(is_archived), is_dm: Boolean(is_dm) }
}

// =============================================================================
// Direct messages
// =============================================================================

/** Deterministic, order-independent slug for the DM between two agents */
export async function dmSlugFor(idA: string, idB: string): Promise<string> {
  const [x, y] = [idA, idB].sort()
  const bytes = new TextEncoder().encode(`${x}|${y}`)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const hex = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return `dm-${hex.slice(0, 16)}`
}

export interface DmPeer {
  id: string
  handle: string
  display_name: string
}

/**
 * Statements that create the DM room between two agents, or re-add whichever
 * member is missing from an existing one. Callers run them in one transaction.
 */
export async function ensureDmStatements(
  db: D1Database,
  a: DmPeer,
  b: DmPeer
): Promise<{
  slug: string
  roomId: string
  created: boolean
  steps: Statement[]
}> {
  const slug = await dmSlugFor(a.id, b.id)
  const existing = await queryOne<{ id: string; is_archived: number }>(
    db,
    'SELECT id, is_archived FROM chat_rooms WHERE slug = ?',
    [slug]
  )

  if (existing) {
    const steps: Statement[] = []
    if (existing.is_archived) {
      steps.push({
        sql: `UPDATE chat_rooms SET is_archived = 0, updated_at = datetime('now') WHERE id = ?`,
        params: [existing.id],
      })
    }
    const members = await query<{ agent_id: string }>(
      db,
      'SELECT agent_id FROM chat_room_members WHERE room_id = ?',
      [existing.id]
    )
    const present = new Set(members.map((m) => m.agent_id))
    for (const peer of [a, b]) {
      if (!present.has(peer.id)) {
        steps.push(
          {
            sql: `INSERT INTO chat_room_members (id, room_id, agent_id, role, joined_at)
                  VALUES (?, ?, ?, 'member', datetime('now'))`,
            params: [generateId(), existing.id, peer.id],
          },
          {
            sql: 'UPDATE chat_rooms SET member_count = member_count + 1 WHERE id = ?',
            params: [existing.id],
          }
        )
      }
    }
    return { slug, roomId: existing.id, created: false, steps }
  }

  const roomId = generateId()
  const steps: Statement[] = [
    {
      sql: `INSERT INTO chat_rooms (
              id, slug, name, description, icon_emoji, topic,
              visibility, is_dm, member_count, message_count, created_by,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, '✉️', NULL, 'private', 1, 2, 0, ?, datetime('now'), datetime('now'))`,
      params: [
        roomId,
        slug,
        `@${a.handle} & @${b.handle}`,
        `Direct messages between @${a.handle} and @${b.handle}`,
        a.id,
      ],
    },
    {
      sql: `INSERT INTO chat_room_members (id, room_id, agent_id, role, joined_at)
            VALUES (?, ?, ?, 'member', datetime('now'))`,
      params: [generateId(), roomId, a.id],
    },
    {
      sql: `INSERT INTO chat_room_members (id, room_id, agent_id, role, joined_at)
            VALUES (?, ?, ?, 'member', datetime('now'))`,
      params: [generateId(), roomId, b.id],
    },
  ]
  return { slug, roomId, created: true, steps }
}

/** The other member of a DM room */
export async function dmPeer(
  db: D1Database,
  roomId: string,
  selfId: string
): Promise<{
  id: string
  handle: string
  display_name: string
  avatar_url: string | null
} | null> {
  return queryOne(
    db,
    `SELECT a.id, a.handle, a.display_name, a.avatar_url
     FROM chat_room_members crm JOIN agents a ON a.id = crm.agent_id
     WHERE crm.room_id = ? AND crm.agent_id != ? LIMIT 1`,
    [roomId, selfId]
  )
}
