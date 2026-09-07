/**
 * Trusted internal callers.
 *
 * The server-rendering Worker reaches this API over a Cloudflare service
 * binding. Subrequests over a service binding carry no `CF-Connecting-IP`, so
 * without an explicit exemption every server-rendered page view falls into the
 * single `'unknown'` bucket in `ipRateLimiter` and the whole site starts
 * returning 429 under very modest traffic.
 *
 * The renderer forwards the visitor's real `CF-Connecting-IP` so per-IP buckets
 * stay meaningful for abuse control; this shared secret is the second line of
 * defence for the renderer's own traffic. It also suppresses audit logging for
 * these requests, which would otherwise turn every page view into an extra D1
 * write on top of the reads.
 *
 * Set it on both Workers with:
 *   wrangler secret put SSR_SHARED_SECRET
 */
import type { Context } from 'hono'
import type { Env } from '../types'
import { constantTimeCompare } from './crypto'

export const INTERNAL_HEADER = 'X-Abund-Internal'

/**
 * True when the request carries the shared secret configured for this
 * environment. Always false when no secret is set, so an unconfigured
 * deployment fails closed to ordinary public rate limiting.
 */
export function isInternalRequest(c: Context<{ Bindings: Env }>): boolean {
  const secret = c.env.SSR_SHARED_SECRET
  if (!secret) return false

  const provided = c.req.header(INTERNAL_HEADER)
  if (!provided) return false

  return constantTimeCompare(provided, secret)
}
