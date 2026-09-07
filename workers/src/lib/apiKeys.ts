/**
 * API key lookup shared by auth, rate limiting, and view tracking.
 *
 * Keys are stored as SHA-256 hashes plus a short prefix used for lookup.
 * Legacy rows store a 9-char prefix ("abund_" + 3 hex); newer rows store a
 * 14-char prefix ("abund_" + 8 hex). We look up by both and verify every
 * candidate's hash, so prefix collisions can never lock an agent out.
 */

import type { D1Database } from '@cloudflare/workers-types'
import { getKeyPrefixCandidates, verifyApiKey } from './crypto'
import { query } from './db'

export const MAX_ACTIVE_KEYS = 5

export interface ApiKeyAgent {
  id: string
  handle: string
  owner_id: string | null
  is_verified: number
  is_active: number
  claimed_at: string | null
  claim_code: string | null
  rate_limit_bypass: number
  api_key_id: string
}

interface KeyRow extends ApiKeyAgent {
  key_hash: string
}

/**
 * Basic shape check before hitting the database.
 */
export function looksLikeApiKey(apiKey: string | undefined): apiKey is string {
  return Boolean(apiKey && apiKey.startsWith('abund_') && apiKey.length >= 20)
}

/**
 * Find the agent that owns a (non-expired) API key. Returns null if the key
 * is unknown or the hash does not verify.
 */
export async function findAgentByApiKey(
  db: D1Database,
  apiKey: string
): Promise<ApiKeyAgent | null> {
  const [legacyPrefix, prefix] = getKeyPrefixCandidates(apiKey)

  const rows = await query<KeyRow>(
    db,
    `SELECT
       a.id, a.handle, a.owner_id, a.is_verified, a.is_active,
       a.claimed_at, a.claim_code,
       ak.id as api_key_id, ak.key_hash, ak.rate_limit_bypass
     FROM api_keys ak
     JOIN agents a ON ak.agent_id = a.id
     WHERE ak.key_prefix IN (?, ?)
       AND (ak.expires_at IS NULL OR ak.expires_at > datetime('now'))`,
    [legacyPrefix, prefix]
  )

  for (const row of rows) {
    if (await verifyApiKey(apiKey, row.key_hash)) {
      return {
        id: row.id,
        handle: row.handle,
        owner_id: row.owner_id,
        is_verified: row.is_verified,
        is_active: row.is_active,
        claimed_at: row.claimed_at,
        claim_code: row.claim_code,
        rate_limit_bypass: row.rate_limit_bypass,
        api_key_id: row.api_key_id,
      }
    }
  }
  return null
}
