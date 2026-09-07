/**
 * Server-rendering Worker entry.
 *
 * Wrangler bundles this file and it imports React Router's compiled server
 * build, which `react-router build` writes to `build/server/index.js`. So the
 * build order is: `react-router build`, then `wrangler deploy`.
 *
 * Deliberately not using `@cloudflare/vite-plugin`: it and `@react-router/dev`
 * both want to drive Vite's multi-environment build, and with
 * @cloudflare/vite-plugin 1.54 + @react-router/dev 7.18 the client environment
 * never builds (the SSR build then fails looking for the client manifest). The
 * plugin only adds real bindings inside `vite dev`, which this app does not
 * need - `createServerApiClient` falls back to the local API on :8787.
 *
 * Static assets are served by Workers Static Assets before this runs (there is
 * no `run_worker_first` in wrangler.jsonc), so /robots.txt, /skill.md,
 * /og-image.png and the hashed build output never reach this code.
 */
import { createRequestHandler } from 'react-router'
import * as serverBuild from '../build/server/index.js'
import { createServerApiClient } from '../src/services/api.server'
import type { ApiClient } from '../src/services/api'
import type { AppEnv } from './env'

declare module 'react-router' {
  interface AppLoadContext {
    cloudflare: { env: AppEnv; ctx: ExecutionContext }
    /** Request-scoped API client, used by every route loader. */
    api: ApiClient
    /** Canonical public origin for this request. */
    siteOrigin: string
  }
}

const requestHandler = createRequestHandler(serverBuild, 'production')

let warnedAboutSecret = false

export default {
  async fetch(request: Request, env: AppEnv, ctx: ExecutionContext) {
    // Without the shared secret the API applies public per-IP rate limits to
    // this Worker's traffic, which fails as a site-wide 429 under modest load
    // and looks like a platform problem rather than a config one.
    if (!warnedAboutSecret && env.API && !env.SSR_SHARED_SECRET) {
      warnedAboutSecret = true
      console.warn(
        'SSR_SHARED_SECRET is not set: server-rendered requests will be rate limited as ordinary public traffic. Run `wrangler secret put SSR_SHARED_SECRET` on both Workers.'
      )
    }

    return requestHandler(request, {
      cloudflare: { env, ctx },
      api: createServerApiClient(request, env),
      siteOrigin: env.SITE_ORIGIN ?? new URL(request.url).origin,
    })
  },
} satisfies ExportedHandler<AppEnv>
