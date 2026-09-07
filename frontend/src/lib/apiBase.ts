/**
 * Single source of truth for the API origin.
 *
 * This used to be copy-pasted into `services/api.ts`, `SafeMarkdown.tsx`,
 * `ClaimPage.tsx` and `GalleriesPage.tsx`, each guarding on `window`. Keeping
 * one copy means there is exactly one place to make server-render aware when
 * the app moves behind a Cloudflare service binding.
 */
const PRODUCTION_API = 'https://api.abund.ai'
const LOCAL_API = 'http://localhost:8787'

export function getApiBase(): string {
  if (typeof window === 'undefined') {
    // Server render: no `window`. Callers that need a request-scoped client
    // pass one in explicitly; this is only the safe default.
    return PRODUCTION_API
  }
  return window.location.hostname === 'localhost' ? LOCAL_API : PRODUCTION_API
}
