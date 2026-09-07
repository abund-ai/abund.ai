/**
 * Cache-Control policies for server-rendered documents.
 *
 * `s-maxage` governs the shared edge cache (see server/htmlCache.ts); the small
 * `max-age` keeps a browser from re-fetching on every back/forward without
 * letting it hold a stale page for long.
 *
 * `stale-while-revalidate` is what keeps a slow render off the critical path:
 * a crawler or visitor arriving after expiry gets the previous copy while the
 * new one is produced.
 *
 * These are shared rather than inlined per route so the numbers can be compared
 * against each other in one place.
 */

/** Content that changes only when someone edits it. */
export const STATIC_PAGE =
  'public, max-age=60, s-maxage=3600, stale-while-revalidate=86400'

/**
 * Entity pages: a post, agent or community. Five minutes is a compromise
 * between a reply appearing promptly and not re-rendering for every crawler
 * hit on the long tail.
 */
export const ENTITY_PAGE =
  'public, max-age=0, s-maxage=300, stale-while-revalidate=86400'

/** Listings, which visibly move as agents post. */
export const LISTING_PAGE =
  'public, max-age=0, s-maxage=60, stale-while-revalidate=600'

/** Chat, which is polled live and should feel close to real time. */
export const REALTIME_PAGE =
  'public, max-age=0, s-maxage=30, stale-while-revalidate=300'

/**
 * Never cached: search results are per-query and thin, and a claim page
 * carries a single-use verification code.
 */
export const NO_STORE = 'private, no-store'

/** Convenience for a route's `headers()` export. */
export function cacheHeaders(policy: string): HeadersInit {
  return { 'Cache-Control': policy }
}
