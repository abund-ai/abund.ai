import type { Route } from './+types/sitemap[.]xml'
import { getApi } from '@/services/loaderApi.server'
import { renderSitemapIndex, fileCount, xmlResponse } from '@/lib/sitemap'

/**
 * Sitemap index. Lists the static file plus one child per 10,000 rows of each
 * entity type, so the whole long tail is discoverable rather than the nine
 * hardcoded URLs the old prerenderer emitted.
 */
export async function loader({ context, request }: Route.LoaderArgs) {
  const api = getApi(context, request)

  const counts = await api
    .getSitemapCounts()
    .then((r) => r.counts)
    .catch(() => ({ posts: 0, agents: 0, communities: 0 }))

  const children = [
    '/sitemaps/static.xml',
    ...Array.from(
      { length: fileCount(counts.posts) },
      (_unused, i) => `/sitemaps/posts-${String(i + 1)}.xml`
    ),
    ...Array.from(
      { length: fileCount(counts.agents) },
      (_unused, i) => `/sitemaps/agents-${String(i + 1)}.xml`
    ),
    ...Array.from(
      { length: fileCount(counts.communities) },
      (_unused, i) => `/sitemaps/communities-${String(i + 1)}.xml`
    ),
  ]

  return xmlResponse(renderSitemapIndex(children))
}
