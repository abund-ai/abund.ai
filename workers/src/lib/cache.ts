/**
 * Caching Layer
 *
 * KV-based caching for frequently accessed data to reduce D1 load.
 * Uses stale-while-revalidate pattern for optimal performance.
 */

interface CacheOptions {
  /** TTL in seconds */
  ttl: number
  /**
   * When false, bypass the cache entirely and just call the fetcher.
   *
   * Callers use this to opt out for authenticated requests: several read
   * endpoints run `optionalAuthMiddleware` and fold viewer-specific state
   * (`is_following`, `user_reaction`, `user_vote`, `is_member`, `role`) into
   * the response, so only anonymous responses are shareable. Anonymous is the
   * traffic that matters here anyway - crawlers, logged-out humans and the
   * server-side renderer.
   */
  enabled?: boolean
}

/** Generic KV interface for cache operations (avoids type conflicts) */
interface KVCache {
  get(key: string, type?: string): Promise<string | null>
  get<T = unknown>(key: string, type: 'json'): Promise<T | null>
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number }
  ): Promise<void>
  delete(key: string): Promise<void>
  list(options?: { prefix?: string }): Promise<{ keys: { name: string }[] }>
}

// Default TTLs for different data types
export const CACHE_TTL = {
  AGENT_PROFILE: 300, // 5 minutes
  COMMUNITY: 600, // 10 minutes
  FEED_PAGE: 60, // 1 minute (first 3 pages only)
  TRENDING: 120, // 2 minutes
  STATS: 300, // 5 minutes
  POST: 60, // 1 minute (view counts move constantly)
} as const

/**
 * Get cached value, or fetch and cache it.
 *
 * A `null`/`undefined` result is never cached, so a handler can signal
 * "not found" by returning null without poisoning the cache with a negative
 * for the whole TTL - which would otherwise make a newly created agent or
 * community 404 for minutes after it appears.
 *
 * KV failures are swallowed: the cache is an optimisation and must never turn
 * a working read into an error.
 */
export async function getOrSet<T>(
  cache: KVCache | undefined,
  key: string,
  fetcher: () => Promise<T>,
  options: CacheOptions
): Promise<T> {
  if (!cache || options.enabled === false) {
    return fetcher()
  }

  const cacheKey = `cache:${key}`

  try {
    const cached = await cache.get(cacheKey, 'json')
    if (cached !== null) {
      return cached as T
    }
  } catch (error) {
    console.error('Cache read failed:', error)
  }

  const data = await fetcher()

  if (data !== null && data !== undefined) {
    try {
      await cache.put(cacheKey, JSON.stringify(data), {
        expirationTtl: options.ttl,
      })
    } catch (error) {
      console.error('Cache write failed:', error)
    }
  }

  return data
}

/**
 * Invalidate cached value
 */
export async function invalidate(
  cache: KVCache | undefined,
  key: string
): Promise<void> {
  if (!cache) return
  try {
    await cache.delete(`cache:${key}`)
  } catch (error) {
    console.error('Cache invalidate failed:', error)
  }
}

/**
 * Invalidate multiple cached values by pattern prefix
 */
/**
 * Invalidate every cached value under a prefix.
 *
 * Note this relies on KV `list`, which is eventually consistent and rate
 * limited - so it is a latency optimisation, not a correctness mechanism. The
 * short TTLs in CACHE_TTL are what actually bound staleness.
 */
export async function invalidatePrefix(
  cache: KVCache | undefined,
  prefix: string
): Promise<void> {
  if (!cache) return
  try {
    const list = await cache.list({ prefix: `cache:${prefix}` })
    await Promise.all(list.keys.map((k) => cache.delete(k.name)))
  } catch (error) {
    console.error('Cache prefix invalidate failed:', error)
  }
}

// =============================================================================
// Cache Key Builders
// =============================================================================

export const cacheKey = {
  agent: (handle: string) => `agent:${handle}`,
  agentById: (id: string) => `agent:id:${id}`,
  community: (slug: string) => `community:${slug}`,
  feed: (sort: string, page: number) => `feed:${sort}:${page}`,
  communityFeed: (slug: string, sort: string, page: number) =>
    `community:${slug}:feed:${sort}:${page}`,
  trending: (page: number) => `feed:trending:${page}`,
  agentPosts: (handle: string, page: number) => `agent:${handle}:posts:${page}`,
  agentDirectory: (sort: string, page: number) =>
    `agent:directory:${sort}:${page}`,
  post: (id: string) => `post:${id}`,
  stats: () => 'stats',
}

/**
 * Invalidate everything a post mutation makes stale: every cached feed page,
 * trending, and the platform stats counters.
 *
 * Call this alongside `bumpVersion` on create/edit/delete. Prefer passing it to
 * `waitUntil` - it costs a KV list plus N deletes, which should not sit in the
 * mutation's critical path.
 */
export async function invalidateFeeds(
  cache: KVCache | undefined
): Promise<void> {
  if (!cache) return
  await Promise.all([
    invalidatePrefix(cache, 'feed:'),
    invalidate(cache, cacheKey.stats()),
  ])
}

// =============================================================================
// Version Tracking (Smart Polling)
// =============================================================================

/**
 * Version keys for smart polling.
 * Each resource type gets a version stamp in KV that bumps on mutations.
 * Clients poll lightweight /version endpoints to detect changes.
 */
export const versionKey = {
  feed: () => 'version:feed',
  chatroom: (slug: string) => `version:chatroom:${slug}`,
}

/**
 * Bump the version for a resource (call after mutations).
 * Stores current timestamp as the version string with 24h TTL.
 */
export async function bumpVersion(
  cache: KVCache | undefined,
  key: string
): Promise<void> {
  if (!cache) return
  await cache.put(key, String(Date.now()), { expirationTtl: 86400 })
}

// =============================================================================
// Cache Decorators (for use in routes)
// =============================================================================

/**
 * Check if we should cache this feed page
 * Only cache first 3 pages to avoid memory bloat
 */
export function shouldCacheFeedPage(page: number): boolean {
  return page <= 3
}
