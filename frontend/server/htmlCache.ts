/**
 * Edge cache for server-rendered HTML.
 *
 * Cloudflare does not cache a Worker's own responses automatically, so without
 * this every page view costs a full render plus the API reads behind it. Those
 * reads are already cached in KV on the API side, but the render is not.
 *
 * Uses the Cache API explicitly rather than a dashboard Cache Rule: the policy
 * then lives in the repository, is reviewable, and behaves the same under
 * `wrangler dev`.
 *
 * ## The cache key
 *
 * A synthetic URL rather than the request URL, which is what lets the entry
 * vary by language without `Vary: Cookie` — and `Vary: Cookie` would make the
 * cache useless, since almost every visitor carries some cookie.
 *
 *   https://html-cache.abund.internal/<build>/<lang><pathname><search>
 *
 * Theme is deliberately *not* in the key. The rendered HTML carries no theme
 * class (see root.tsx); an inline script applies it before paint, so one cached
 * document serves light and dark visitors alike.
 */
import { resolveLanguage } from '../src/i18n/i18n.server'

/** Marks hits so a stale page can be diagnosed from the response alone. */
export const CACHE_STATUS_HEADER = 'X-Abund-Cache'

const CACHE_KEY_ORIGIN = 'https://html-cache.abund.internal'

/**
 * `caches.default` is a Workers extension, and the DOM lib's `CacheStorage`
 * (pulled in by `lib: ["DOM"]` for the client code) does not declare it.
 */
function defaultCache(): Cache {
  return (caches as unknown as { default: Cache }).default
}

/**
 * Statuses worth storing. 301 is included because the slug redirects are
 * derived from post content and are hit by every stale or unslugged link.
 */
const CACHEABLE_STATUSES = new Set([200, 301])

function isCacheable(response: Response): boolean {
  if (!CACHEABLE_STATUSES.has(response.status)) return false

  // The route's own `headers()` export has the final say. `cache.put` also
  // rejects no-store outright, so this avoids a thrown error in waitUntil.
  const control = response.headers.get('Cache-Control') ?? ''
  if (/no-store|private/i.test(control)) return false

  // Something has to say how long to keep it; an entry with no freshness
  // information is not worth storing.
  return /s-maxage|max-age/i.test(control)
}

function buildCacheKey(request: Request, buildVersion: string): Request {
  const url = new URL(request.url)
  const lang = resolveLanguage(request)

  return new Request(
    `${CACHE_KEY_ORIGIN}/${buildVersion}/${lang}${url.pathname}${url.search}`,
    { method: 'GET' }
  )
}

interface HtmlCacheOptions {
  request: Request
  ctx: ExecutionContext
  /**
   * Changes on every deploy, so a release implicitly invalidates the whole
   * cache instead of needing a manual purge or a hand-bumped constant.
   */
  buildVersion: string
  render: () => Promise<Response>
}

export async function withHtmlCache({
  request,
  ctx,
  buildVersion,
  render,
}: HtmlCacheOptions): Promise<Response> {
  // Only GET is safe to serve from cache, and an authenticated request could
  // legitimately render something visitor-specific.
  if (request.method !== 'GET' || request.headers.has('Authorization')) {
    return render()
  }

  const cache = defaultCache()
  const key = buildCacheKey(request, buildVersion)

  const hit = await cache.match(key)
  if (hit) {
    const headers = new Headers(hit.headers)
    headers.set(CACHE_STATUS_HEADER, 'HIT')
    return new Response(hit.body, {
      status: hit.status,
      statusText: hit.statusText,
      headers,
    })
  }

  const response = await render()

  if (isCacheable(response)) {
    // Stored as rendered, without the status header, so a later hit is not
    // mislabelled as a miss. The cache is an optimisation: a rejected put
    // (the API refuses some responses outright) must not surface as an error.
    ctx.waitUntil(
      cache.put(key, response.clone()).catch((error: unknown) => {
        console.error('HTML cache put failed:', error)
      })
    )
  }

  const headers = new Headers(response.headers)
  headers.set(CACHE_STATUS_HEADER, 'MISS')
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
