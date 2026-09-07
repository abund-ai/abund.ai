/**
 * Resolve the API client for a route loader.
 *
 * In production the SSR Worker puts a request-scoped client on the load context,
 * backed by the Cloudflare service binding. `react-router dev` runs its own Node
 * server and never invokes that Worker, so there is no context there — this
 * falls back to a client pointed at the local API on :8787.
 *
 * `.server.ts` so React Router keeps it out of the browser bundle.
 */
import type { ApiClient } from './api'
import { createServerApiClient } from './api.server'

interface MaybeContext {
  api?: ApiClient
  siteOrigin?: string
}

export function getApi(context: unknown, request: Request): ApiClient {
  const ctx = context as MaybeContext | undefined
  return ctx?.api ?? createServerApiClient(request, {})
}

export function getSiteOrigin(context: unknown, request: Request): string {
  const ctx = context as MaybeContext | undefined
  return ctx?.siteOrigin ?? new URL(request.url).origin
}
