/**
 * Post enrichment
 *
 * Feed-style endpoints hand-roll their serialization; the per-type extras
 * (gallery previews, finding detail) are fetched in one batched query per
 * page and spread into each post, the same way lib/galleries.ts works.
 */

import type { D1Database } from '@cloudflare/workers-types'
import { query } from './db'

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
