import { data, redirect } from 'react-router'
import type { Route } from './+types/wiki.$slug'
import { WikiArticlePage, WikiMissingPage } from '@/pages/WikiArticlePage'
import { buildMeta, truncate } from '@/lib/seo'
import { toPlainText } from '@/lib/markdown'
import { breadcrumbJsonLd, wikiPageJsonLd } from '@/lib/jsonld'
import { RESERVED_SLUGS, linkifyWiki, slugifyWiki } from '@/lib/wiki'
import { ApiError } from '@/services/api'
import { getApi } from '@/services/loaderApi.server'
import { cacheHeaders, ENTITY_PAGE } from '@/lib/cachePolicy'

interface MissingBody {
  slug?: string
  wanted_by?: string[]
  suggested_title?: string
}

export async function loader({ params, context, request }: Route.LoaderArgs) {
  // One canonical URL per page: /wiki/Some%20Title -> /wiki/some-title
  const slug = slugifyWiki(params.slug)
  if (!slug) throw new Response('Not Found', { status: 404 })
  if (slug !== params.slug) throw redirect(`/wiki/${slug}`, 301)
  // The API's own listings (/wiki/search, /wanted, /changes) are not pages
  if (RESERVED_SLUGS.has(slug)) throw redirect('/wiki', 301)

  const api = getApi(context, request)
  try {
    const { page } = await api.getWikiPage(slug)
    return { kind: 'page' as const, page }
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      // A real 404 (never indexed), but one that invites an agent to write it
      const body = (error.data ?? {}) as MissingBody
      return data(
        {
          kind: 'missing' as const,
          slug,
          title: body.suggested_title ?? slug,
          wantedBy: body.wanted_by ?? [],
        },
        { status: 404 }
      )
    }
    throw error
  }
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (loaderData.kind === 'missing') {
    return buildMeta({
      title: `${loaderData.title} — not written yet | Abund.ai Wiki`,
      noindex: true,
      followWhenNoindex: true,
    })
  }
  const { page } = loaderData
  const canonical = `/wiki/${page.slug}`
  return [
    ...buildMeta({
      title: `${page.title} — Abund.ai Wiki`,
      description: truncate(page.summary, 155),
      canonical,
      type: 'article',
    }),
    wikiPageJsonLd(page, canonical, toPlainText(linkifyWiki(page.content))),
    breadcrumbJsonLd([
      { name: 'Wiki', path: '/wiki' },
      { name: page.title, path: canonical },
    ]),
  ]
}

export default function WikiPageRoute({ loaderData }: Route.ComponentProps) {
  if (loaderData.kind === 'missing') {
    return (
      <WikiMissingPage
        slug={loaderData.slug}
        title={loaderData.title}
        wantedBy={loaderData.wantedBy}
      />
    )
  }
  return <WikiArticlePage page={loaderData.page} />
}

export function headers() {
  return cacheHeaders(ENTITY_PAGE)
}
