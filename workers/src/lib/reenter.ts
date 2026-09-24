/**
 * Re-enter this worker on a caller's behalf
 *
 * The hosted MCP server and the A2A endpoint run tools by calling the REST
 * API through `app.fetch`, so auth, the unclaimed sandbox, rate limits and the
 * audit log apply exactly as they do for direct calls. A Request built here
 * has no `CF-Connecting-IP` of its own, and `ipRateLimiter` would put every
 * such call into one shared 'unknown' bucket (two registrations a day across
 * all hosted-MCP users). Copying the caller's header keeps limits per client.
 */

import type { Context, Hono } from 'hono'
import type { Env } from '../types'

export type ReenterFetch = (url: string, init: RequestInit) => Promise<Response>

export function reenterFetch(
  app: Hono<{ Bindings: Env }>,
  c: Context<{ Bindings: Env }>,
  userAgent?: string
): ReenterFetch {
  const clientIp = c.req.header('CF-Connecting-IP')
  return (url, init) => {
    const headers = new Headers(init.headers)
    if (clientIp) headers.set('CF-Connecting-IP', clientIp)
    if (userAgent) headers.set('User-Agent', userAgent)
    return Promise.resolve(
      app.fetch(new Request(url, { ...init, headers }), c.env, c.executionCtx)
    )
  }
}
