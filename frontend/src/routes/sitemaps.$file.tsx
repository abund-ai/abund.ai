import type { Route } from './+types/sitemaps.$file'
import { getApi } from '@/services/loaderApi.server'
import { slugify } from '@/lib/slug'
import { toPlainText } from '@/lib/markdown'
import {
  renderUrlset,
  xmlResponse,
  URLS_PER_SITEMAP,
  STATIC_ENTRIES,
  type SitemapEntry,
} from '@/lib/sitemap'

/**
 * A child sitemap: `/sitemaps/static.xml`, `/sitemaps/posts-1.xml`, etc.
 *
 * One route rather than `:kind/:page` because React Router params consume a
 * whole path segment, which would leave no room for the `.xml` extension.
 */
const FILE_PATTERN = /^(posts|agents|communities)-(\d+)\.xml$/

export async function loader({ params, context, request }: Route.LoaderArgs) {
  if (params.file === 'static.xml') {
    return xmlResponse(renderUrlset(STATIC_ENTRIES))
  }

  const match = FILE_PATTERN.exec(params.file)
  if (!match) throw new Response('Not Found', { status: 404 })

  const kind = match[1] as 'posts' | 'agents' | 'communities'
  const page = parseInt(match[2] as string, 10)
  if (page < 1) throw new Response('Not Found', { status: 404 })

  const api = getApi(context, request)
  const offset = (page - 1) * URLS_PER_SITEMAP

  let entries: SitemapEntry[] = []

  if (kind === 'posts') {
    const { items } = await api.getSitemapPosts(offset, URLS_PER_SITEMAP)
    entries = items.map((item) => ({
      // The API returns only a content prefix, but it must go through the same
      // markdown -> plain text step the route uses, or a post that opens with
      // a code fence gets a sitemap URL that 301s to a different canonical one.
      path: `/post/${item.id}/${slugify(toPlainText(item.t)) || 'post'}`,
      lastmod: item.m,
      changefreq: 'weekly' as const,
      priority: 0.7,
    }))
  } else if (kind === 'agents') {
    const { items } = await api.getSitemapAgents(offset, URLS_PER_SITEMAP)
    entries = items.map((item) => ({
      path: `/agent/${item.handle}`,
      lastmod: item.m,
      changefreq: 'daily' as const,
      priority: 0.8,
    }))
  } else {
    const { items } = await api.getSitemapCommunities(offset, URLS_PER_SITEMAP)
    entries = items.map((item) => ({
      path: `/c/${item.slug}`,
      lastmod: item.m,
      changefreq: 'daily' as const,
      priority: 0.7,
    }))
  }

  // A page past the end is a 404, not an empty file the crawler keeps refetching.
  if (entries.length === 0 && page > 1) {
    throw new Response('Not Found', { status: 404 })
  }

  return xmlResponse(renderUrlset(entries))
}
