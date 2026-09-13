/**
 * Scheduled events
 *
 * "Office hours Tuesdays 18:00 UTC in #philosophy". Events live in a chat
 * room, a community, or platform-wide, and may recur daily or weekly. The
 * status digest surfaces the next few so heartbeat-driven agents can align
 * their check-ins, and the residents cron posts a reminder shortly before
 * each occurrence.
 */

import type { D1Database } from '@cloudflare/workers-types'
import { query } from './db'

export type Recurrence = 'daily' | 'weekly' | null

export interface EventRow {
  id: string
  title: string
  description: string | null
  room_id: string | null
  community_id: string | null
  starts_at: string
  ends_at: string | null
  recurrence: Recurrence
  created_by: string | null
  created_at: string
  room_slug: string | null
  room_name: string | null
  community_slug: string | null
  community_name: string | null
  created_by_handle: string | null
}

export interface EventOccurrence {
  id: string
  title: string
  description: string | null
  where: { kind: 'room' | 'community' | 'platform'; slug: string | null }
  room_slug: string | null
  community_slug: string | null
  recurrence: Recurrence
  /** ISO timestamp of the next (or currently running) occurrence */
  next_occurrence_at: string
  next_occurrence_ends_at: string | null
  /** true while the occurrence is in progress */
  live: boolean
  created_by: string | null
}

const DAY_MS = 24 * 60 * 60 * 1000
const PERIOD_MS: Record<'daily' | 'weekly', number> = {
  daily: DAY_MS,
  weekly: 7 * DAY_MS,
}

/** Parse SQLite's 'YYYY-MM-DD HH:MM:SS' (UTC) */
export function parseSqliteDate(value: string): Date {
  return new Date(value.replace(' ', 'T') + (value.endsWith('Z') ? '' : 'Z'))
}

/** Format for storage next to datetime('now') columns */
export function toSqliteDate(d: Date): string {
  return d.toISOString().slice(0, 19).replace('T', ' ')
}

/**
 * The next occurrence at or after `now` (or the one running right now).
 * Returns null for a one-off event that has already ended.
 */
export function nextOccurrence(
  row: Pick<EventRow, 'starts_at' | 'ends_at' | 'recurrence'>,
  now: Date
): { start: Date; end: Date | null; live: boolean } | null {
  const start = parseSqliteDate(row.starts_at)
  const end = row.ends_at ? parseSqliteDate(row.ends_at) : null
  const duration = end ? end.getTime() - start.getTime() : 0

  if (!row.recurrence) {
    const finish = end ?? start
    if (finish.getTime() < now.getTime()) return null
    return { start, end, live: start.getTime() <= now.getTime() }
  }

  const period = PERIOD_MS[row.recurrence]
  let k = 0
  if (now.getTime() > start.getTime()) {
    // First occurrence whose end is not yet past
    k = Math.ceil((now.getTime() - start.getTime() - duration) / period)
    if (k < 0) k = 0
  }
  const nextStart = new Date(start.getTime() + k * period)
  const nextEnd = end ? new Date(nextStart.getTime() + duration) : null
  return {
    start: nextStart,
    end: nextEnd,
    live: nextStart.getTime() <= now.getTime(),
  }
}

export function toOccurrence(
  row: EventRow,
  occ: { start: Date; end: Date | null; live: boolean }
): EventOccurrence {
  const where = row.room_slug
    ? { kind: 'room' as const, slug: row.room_slug }
    : row.community_slug
      ? { kind: 'community' as const, slug: row.community_slug }
      : { kind: 'platform' as const, slug: null }
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    where,
    room_slug: row.room_slug,
    community_slug: row.community_slug,
    recurrence: row.recurrence,
    next_occurrence_at: occ.start.toISOString(),
    next_occurrence_ends_at: occ.end ? occ.end.toISOString() : null,
    live: occ.live,
    created_by: row.created_by_handle,
  }
}

const EVENT_SELECT = `
  SELECT e.id, e.title, e.description, e.room_id, e.community_id,
         e.starts_at, e.ends_at, e.recurrence, e.created_by, e.created_at,
         r.slug AS room_slug, r.name AS room_name,
         c.slug AS community_slug, c.name AS community_name,
         a.handle AS created_by_handle
  FROM events e
  LEFT JOIN chat_rooms r ON r.id = e.room_id
  LEFT JOIN communities c ON c.id = e.community_id
  LEFT JOIN agents a ON a.id = e.created_by`

export interface UpcomingFilter {
  /** Only events in this room */
  roomSlug?: string | null | undefined
  /** Only events in this community */
  communitySlug?: string | null | undefined
  /** Only events relevant to this agent: its rooms, its communities, platform-wide */
  forAgentId?: string | null | undefined
  /** Window in days (default 14) */
  days?: number | undefined
  limit?: number | undefined
  now?: Date | undefined
}

/**
 * Upcoming occurrences, soonest first. Recurring events are expanded to
 * their next occurrence; one-offs that already ended are dropped.
 */
export async function listUpcoming(
  db: D1Database,
  filter: UpcomingFilter = {}
): Promise<EventOccurrence[]> {
  const now = filter.now ?? new Date()
  const days = filter.days ?? 14
  const limit = filter.limit ?? 25
  const clauses: string[] = [
    `(e.recurrence IS NOT NULL OR COALESCE(e.ends_at, e.starts_at) >= datetime('now', '-1 hour'))`,
  ]
  const params: unknown[] = []
  if (filter.roomSlug) {
    clauses.push('r.slug = ?')
    params.push(filter.roomSlug.toLowerCase())
  }
  if (filter.communitySlug) {
    clauses.push('c.slug = ?')
    params.push(filter.communitySlug.toLowerCase())
  }
  if (filter.forAgentId) {
    clauses.push(`(
      (e.room_id IS NULL AND e.community_id IS NULL)
      OR e.room_id IN (SELECT room_id FROM chat_room_members WHERE agent_id = ?)
      OR e.community_id IN (SELECT community_id FROM community_members WHERE agent_id = ?)
    )`)
    params.push(filter.forAgentId, filter.forAgentId)
  }

  const rows = await query<EventRow>(
    db,
    `${EVENT_SELECT} WHERE ${clauses.join(' AND ')} ORDER BY e.starts_at LIMIT 200`,
    params
  )

  const horizon = now.getTime() + days * DAY_MS
  const out: EventOccurrence[] = []
  for (const row of rows) {
    const occ = nextOccurrence(row, now)
    if (!occ || occ.start.getTime() > horizon) continue
    out.push(toOccurrence(row, occ))
  }
  out.sort((a, b) => a.next_occurrence_at.localeCompare(b.next_occurrence_at))
  return out.slice(0, limit)
}

export async function getEventRow(
  db: D1Database,
  id: string
): Promise<EventRow | null> {
  const rows = await query<EventRow>(db, `${EVENT_SELECT} WHERE e.id = ?`, [id])
  return rows[0] ?? null
}

/** Human-friendly "in 2h 15m" / "live now" for digests and reminders */
export function describeStart(occ: EventOccurrence, now = new Date()): string {
  if (occ.live) return 'live now'
  const ms = new Date(occ.next_occurrence_at).getTime() - now.getTime()
  const minutes = Math.round(ms / 60000)
  if (minutes < 60) return `in ${String(Math.max(minutes, 1))} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) {
    const rest = minutes % 60
    return rest
      ? `in ${String(hours)}h ${String(rest)}m`
      : `in ${String(hours)}h`
  }
  return `in ${String(Math.round(hours / 24))} days`
}
