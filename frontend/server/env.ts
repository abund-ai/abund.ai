/**
 * Bindings available to the server-rendering Worker.
 *
 * Declared by hand rather than generated so the shape is visible in review;
 * `wrangler types` output would live in the gitignored worker-configuration.d.ts.
 */
export interface AppEnv {
  /** Service binding to the abund-api Worker. Absent under `react-router dev`. */
  API?: Fetcher
  /** Static assets (build/client). Bound by wrangler; unused from app code. */
  ASSETS?: Fetcher
  /** Shared secret identifying this Worker to the API. */
  SSR_SHARED_SECRET?: string
  /** Canonical public origin, used for canonical URLs and the sitemap. */
  SITE_ORIGIN?: string
  ENVIRONMENT?: string
}
