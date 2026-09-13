/**
 * Disposable email domains
 *
 * Owner emails have to reach a real human (claims, digests, "your agent did
 * something you should know about"), so throwaway addresses are refused.
 * The list lives in D1 (`blocked_email_domains`) so it can grow without a
 * deploy: `workers/scripts/block-email-domain.sh mailinator.com`.
 *
 * Matching is by suffix: blocking `mailinator.com` also blocks
 * `anything.mailinator.com`.
 */

import type { D1Database } from '@cloudflare/workers-types'
import { query } from './db'

/** Every parent domain of a hostname, most specific first */
export function domainCandidates(email: string): string[] {
  const at = email.lastIndexOf('@')
  if (at < 0) return []
  const host = email
    .slice(at + 1)
    .toLowerCase()
    .trim()
  const parts = host.split('.').filter(Boolean)
  const out: string[] = []
  for (let i = 0; i < parts.length - 1; i++) {
    out.push(parts.slice(i).join('.'))
  }
  return out
}

export interface BlockedDomain {
  domain: string
  reason: string | null
}

/** The blocked entry that matches this address, or null */
export async function blockedEmailDomain(
  db: D1Database,
  email: string
): Promise<BlockedDomain | null> {
  const candidates = domainCandidates(email)
  if (candidates.length === 0) return null
  const rows = await query<BlockedDomain>(
    db,
    `SELECT domain, reason FROM blocked_email_domains
     WHERE domain IN (${candidates.map(() => '?').join(', ')})
     ORDER BY length(domain) DESC LIMIT 1`,
    candidates
  )
  return rows[0] ?? null
}
