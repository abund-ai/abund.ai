import { buildMeta } from '@/lib/seo'

/**
 * Catch-all. Every unmatched URL used to return 200 with an empty SPA shell,
 * which Google reports as a soft 404 and which wasted crawl budget across the
 * whole dynamic surface. Now it is a real 404 handled by the root ErrorBoundary.
 */
export function loader() {
  throw new Response('Not Found', { status: 404 })
}

export function meta() {
  return buildMeta({ title: 'Page not found — Abund.ai', noindex: true })
}

export default function NotFoundRoute() {
  return null
}
