/**
 * Post enrichment
 *
 * Feed-style endpoints hand-roll their serialization; the per-type extras
 * (gallery previews, finding detail) are fetched in one batched query per
 * page and spread into each post, the same way lib/galleries.ts works.
 */

import type { D1Database } from '@cloudflare/workers-types'
import { query } from './db'
import { isClosed } from './polls'

export interface FindingFields {
  environment: Record<string, string> | null
  error_text: string | null
  cause: string | null
  fix: string
  tags: string[]
  confirm_count: number
  dispute_count: number
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/** Finding detail for every finding among the given posts, keyed by post id */
export async function fetchFindingFieldsFor(
  db: D1Database,
  posts: Array<{ id: string; post_type?: string | null }>
): Promise<Map<string, FindingFields>> {
  const out = new Map<string, FindingFields>()
  // Rows that did not select post_type are checked anyway (one IN query)
  const ids = posts
    .filter((p) => p.post_type === undefined || p.post_type === 'finding')
    .map((p) => p.id)
  if (ids.length === 0) return out
  const rows = await query<{
    post_id: string
    environment: string | null
    error_text: string | null
    cause: string | null
    fix: string
    tags: string
    confirm_count: number
    dispute_count: number
  }>(
    db,
    `SELECT post_id, environment, error_text, cause, fix, tags, confirm_count, dispute_count
     FROM finding_details WHERE post_id IN (${ids.map(() => '?').join(',')})`,
    ids
  )
  for (const r of rows) {
    out.set(r.post_id, {
      environment: parseJson<Record<string, string> | null>(
        r.environment,
        null
      ),
      error_text: r.error_text,
      cause: r.cause,
      fix: r.fix,
      tags: parseJson<string[]>(r.tags, []),
      confirm_count: r.confirm_count,
      dispute_count: r.dispute_count,
    })
  }
  return out
}

/** Spread into a serialized post: `finding` when the post is one */
export function findingFields(
  f: FindingFields | undefined
): { finding: FindingFields } | Record<string, never> {
  return f ? { finding: f } : {}
}

// =============================================================================
// Polls
// =============================================================================

export interface PollOptionFields {
  id: string
  label: string
  position: number
  vote_count: number
  /** Share of voters, 0-100 (a voter may count for several options) */
  percent: number
}

export interface PollFields {
  options: PollOptionFields[]
  total_votes: number
  closes_at: string | null
  is_closed: boolean
  multiple: boolean
}

/** Options and tallies for every poll among the given posts, keyed by post id */
export async function fetchPollFieldsFor(
  db: D1Database,
  posts: Array<{ id: string; post_type?: string | null }>
): Promise<Map<string, PollFields>> {
  const out = new Map<string, PollFields>()
  const ids = posts
    .filter((p) => p.post_type === undefined || p.post_type === 'poll')
    .map((p) => p.id)
  if (ids.length === 0) return out
  const placeholders = ids.map(() => '?').join(',')
  const [details, options] = await Promise.all([
    query<{
      post_id: string
      closes_at: string | null
      multiple: number
      total_votes: number
    }>(
      db,
      `SELECT post_id, closes_at, multiple, total_votes FROM poll_details WHERE post_id IN (${placeholders})`,
      ids
    ),
    query<{
      id: string
      post_id: string
      position: number
      label: string
      vote_count: number
    }>(
      db,
      `SELECT id, post_id, position, label, vote_count FROM poll_options
       WHERE post_id IN (${placeholders}) ORDER BY post_id, position ASC`,
      ids
    ),
  ])
  for (const d of details) {
    const opts = options.filter((o) => o.post_id === d.post_id)
    out.set(d.post_id, {
      options: opts.map((o) => ({
        id: o.id,
        label: o.label,
        position: o.position,
        vote_count: o.vote_count,
        percent:
          d.total_votes > 0
            ? Math.round((o.vote_count / d.total_votes) * 100)
            : 0,
      })),
      total_votes: d.total_votes,
      closes_at: d.closes_at,
      is_closed: isClosed(d.closes_at),
      multiple: Boolean(d.multiple),
    })
  }
  return out
}

/** Spread into a serialized post: `poll` when the post is one */
export function pollFields(
  p: PollFields | undefined
): { poll: PollFields } | Record<string, never> {
  return p ? { poll: p } : {}
}
