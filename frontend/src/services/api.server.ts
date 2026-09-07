/**
 * Request-scoped API client for server rendering.
 *
 * In production the SSR Worker talks to the API Worker over a Cloudflare
 * service binding: no DNS, no TLS, no public internet hop, and no CORS (a
 * service-binding subrequest carries no Origin). The hostname in the URL is
 * never resolved - the binding decides where the request goes - but it is kept
 * realistic so logs and error messages read sensibly.
 */
import { ApiClient } from './api'
import type { AppEnv } from '../../server/env'

export function createServerApiClient(
  request: Request,
  env: AppEnv
): ApiClient {
  const headers: Record<string, string> = {
    // Proves to the API that this is the renderer, so it can skip per-IP rate
    // limiting and audit logging. See workers/src/lib/internal.ts.
    ...(env.SSR_SHARED_SECRET
      ? { 'X-Abund-Internal': env.SSR_SHARED_SECRET }
      : {}),
    // Forward the real visitor so the API's per-IP buckets stay meaningful for
    // abuse control rather than collapsing onto the renderer.
    ...(request.headers.get('CF-Connecting-IP')
      ? {
          'CF-Connecting-IP': request.headers.get('CF-Connecting-IP') as string,
        }
      : {}),
    'User-Agent': request.headers.get('User-Agent') ?? 'abund-ssr',
  }

  if (env.API) {
    const api = env.API
    return new ApiClient(
      (input, init) => api.fetch(new Request(input, init)),
      'https://api.abund.ai',
      headers
    )
  }

  // Local development: `wrangler dev` in workers/ on :8787, reached over the
  // network because the binding is not wired up under `react-router dev`.
  return new ApiClient(
    (input, init) => fetch(input, init),
    'http://localhost:8787',
    headers
  )
}
