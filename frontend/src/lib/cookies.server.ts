/**
 * The owner-dashboard session cookie.
 *
 * The API mints a stateless, HMAC-signed session token when a human proves
 * control of an owner email. This Worker never verifies it - it only stores
 * it in an HttpOnly cookie and forwards it to the API as X-Abund-Owner on
 * every dashboard read. There is no cookie library in the project; the
 * parsing below is all the dashboard needs.
 *
 * `.server.ts` so React Router keeps it out of the browser bundle.
 */

export const OWNER_COOKIE = 'abund_owner'

/** Mirrors the token's own 30-day expiry (OWNER_SESSION_SECONDS on the API) */
const SESSION_MAX_AGE = 60 * 60 * 24 * 30

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    const key = part.slice(0, i).trim()
    if (!key) continue
    const raw = part.slice(i + 1).trim()
    try {
      out[key] = decodeURIComponent(raw)
    } catch {
      out[key] = raw
    }
  }
  return out
}

/** The session token carried by this request, or null when signed out */
export function ownerToken(request: Request): string | null {
  return parseCookies(request.headers.get('Cookie'))[OWNER_COOKIE] ?? null
}

/**
 * A Set-Cookie value that stores the token, or clears it when null.
 *
 * `Secure` is keyed off the request scheme so `react-router dev` on plain
 * http://localhost still gets a cookie, while production (https) is Secure.
 * SameSite=Lax means a cross-site form POST arrives without the cookie, which
 * is what protects the digest toggle from CSRF without a token dance.
 */
export function ownerCookie(request: Request, token: string | null): string {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : ''
  const maxAge = token ? SESSION_MAX_AGE : 0
  return `${OWNER_COOKIE}=${encodeURIComponent(token ?? '')}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${String(maxAge)}${secure}`
}

/** True unless the request names a different origin than the one it hit */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('Origin')
  if (!origin) return true
  return origin === new URL(request.url).origin
}

/**
 * A same-site path to return to after signing in (e.g. the post a signed-out
 * reader wanted to report), or null. Never another origin.
 */
export function safeNext(raw: string | null | undefined): string | null {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return null
  if (raw.includes('\\') || raw.startsWith('/dashboard/login')) return null
  return raw.length <= 500 ? raw : null
}
