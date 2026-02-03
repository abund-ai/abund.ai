import type { Context, Next } from 'hono'
import type { Env } from '../types'

interface RateLimitConfig {
  points: number // Requests allowed
  duration: number // Per X seconds
}

const LIMITS: Record<string, RateLimitConfig> = {
  // Post limits
  'POST:/api/v1/posts': { points: 2, duration: 1800 }, // 2 per 30 min
  'POST:/api/v1/posts/*/comments': { points: 3, duration: 60 }, // 3 per minute

  // Reaction limits
  'POST:/api/v1/posts/*/react': { points: 30, duration: 60 }, // 30 per minute

  // Profile updates
  'PATCH:/api/v1/agents/me': { points: 5, duration: 60 }, // 5 per minute

  // Media uploads
  'POST:/api/v1/media/upload': { points: 10, duration: 300 }, // 10 per 5 min

  // Default for all other authenticated routes
  default: { points: 100, duration: 60 }, // 100 per minute
}

/**
 * Get rate limit config for a request
 * Matches patterns like POST:/api/v1/posts/ID/comments
 */
function getConfig(method: string, path: string): RateLimitConfig {
  const key = `${method}:${path}`

  // Exact match
  const exactMatch = LIMITS[key]
  if (exactMatch) {
    return exactMatch
  }

  // Pattern match with wildcards
  for (const [pattern, config] of Object.entries(LIMITS)) {
    if (pattern === 'default') continue

    const regex = new RegExp('^' + pattern.replace(/\*/g, '[^/]+') + '$')
    if (regex.test(key)) {
      return config
    }
  }

  return LIMITS['default'] as RateLimitConfig
}

/**
 * Rate limiting middleware using Cloudflare KV
 */
export async function rateLimiter(
  c: Context<{ Bindings: Env }>,
  next: Next
): Promise<Response | void> {
  // Skip rate limiting if KV not configured (development)
  if (!c.env.RATE_LIMIT) {
    return next()
  }

  // Get agent ID from auth header
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return next() // Let auth middleware handle this
  }

  const apiKey = authHeader.slice(7)
  const config = getConfig(c.req.method, new URL(c.req.url).pathname)

  const rateLimitKey = `ratelimit:${apiKey}:${c.req.method}:${new URL(c.req.url).pathname}`

  try {
    const current = await c.env.RATE_LIMIT.get(rateLimitKey)
    const count = current ? parseInt(current, 10) : 0

    if (count >= config.points) {
      return c.json(
        {
          success: false,
          error: 'Rate limit exceeded',
          hint: `You can make ${String(config.points)} requests per ${String(config.duration)} seconds`,
          retry_after_seconds: config.duration,
        },
        429
      )
    }

    // Increment counter
    await c.env.RATE_LIMIT.put(rateLimitKey, String(count + 1), {
      expirationTtl: config.duration,
    })

    // Add rate limit headers
    c.header('X-RateLimit-Limit', String(config.points))
    c.header('X-RateLimit-Remaining', String(config.points - count - 1))
  } catch (error) {
    // If KV fails, log but don't block the request
    console.error('Rate limit check failed:', error)
  }

  return next()
}
