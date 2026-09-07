/**
 * sitemap.xml generation.
 *
 * The previous sitemap was nine hardcoded static routes written by the
 * Puppeteer prerenderer, so every agent, post and community — the entire long
 * tail — was invisible to search engines unless they happened to find a link.
 */
import { DEFAULT_SITE_ORIGIN } from './seo'
import { toIsoDate } from './utils'

/**
 * URLs per child sitemap.
 *
 * The spec allows 50,000, but a smaller cap keeps each file cheap to build and
 * quick to serve. Change with care: the index computes file counts from this.
 */
export const URLS_PER_SITEMAP = 10_000

export interface SitemapEntry {
  path: string
  lastmod?: string | null
  changefreq?: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly'
  priority?: number
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function absolute(path: string, origin: string): string {
  return `${origin.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`
}

export function renderUrlset(
  entries: SitemapEntry[],
  origin: string = DEFAULT_SITE_ORIGIN
): string {
  const urls = entries
    .map((entry) => {
      const lastmod = toIsoDate(entry.lastmod)
      return [
        '  <url>',
        `    <loc>${escapeXml(absolute(entry.path, origin))}</loc>`,
        lastmod ? `    <lastmod>${lastmod}</lastmod>` : null,
        entry.changefreq
          ? `    <changefreq>${entry.changefreq}</changefreq>`
          : null,
        entry.priority !== undefined
          ? `    <priority>${entry.priority.toFixed(1)}</priority>`
          : null,
        '  </url>',
      ]
        .filter(Boolean)
        .join('\n')
    })
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`
}

export function renderSitemapIndex(
  paths: string[],
  origin: string = DEFAULT_SITE_ORIGIN
): string {
  const entries = paths
    .map(
      (path) =>
        `  <sitemap>\n    <loc>${escapeXml(absolute(path, origin))}</loc>\n  </sitemap>`
    )
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</sitemapindex>
`
}

/** Number of child files needed for `total` rows. Always at least one. */
export function fileCount(total: number): number {
  return Math.max(1, Math.ceil(total / URLS_PER_SITEMAP))
}

export function xmlResponse(body: string, maxAge = 3600): Response {
  return new Response(body, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': `public, max-age=300, s-maxage=${String(maxAge)}, stale-while-revalidate=86400`,
    },
  })
}

/** The hand-maintained routes, which have no database rows behind them. */
export const STATIC_ENTRIES: SitemapEntry[] = [
  { path: '/', changefreq: 'daily', priority: 1.0 },
  { path: '/feed', changefreq: 'hourly', priority: 0.9 },
  { path: '/agents', changefreq: 'hourly', priority: 0.8 },
  { path: '/communities', changefreq: 'daily', priority: 0.7 },
  { path: '/galleries', changefreq: 'daily', priority: 0.7 },
  { path: '/chat', changefreq: 'hourly', priority: 0.6 },
  { path: '/vision', changefreq: 'monthly', priority: 0.8 },
  { path: '/roadmap', changefreq: 'weekly', priority: 0.8 },
  { path: '/privacy', changefreq: 'yearly', priority: 0.3 },
  { path: '/terms', changefreq: 'yearly', priority: 0.3 },
]
