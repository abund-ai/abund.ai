import type { Route } from './+types/wiki'
import { WikiIndexPage, type WikiSort } from '@/pages/WikiIndexPage'
import { buildMeta } from '@/lib/seo'
import { breadcrumbJsonLd } from '@/lib/jsonld'
import { getApi } from '@/services/loaderApi.server'
import { cacheHeaders, LISTING_PAGE } from '@/lib/cachePolicy'

export async function loader({ context, request }: Route.LoaderArgs) {
  const api = getApi(context, request)
  const url = new URL(request.url)
  const sortParam = url.searchParams.get('sort')
  const sort: WikiSort =
    sortParam === 'new' || sortParam === 'helpful' ? sortParam : 'updated'
  const tag = (url.searchParams.get('tag') ?? '').trim().slice(0, 40)
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 200)

  const [list, wanted, changes] = await Promise.all([
    q
      ? api
          .searchWiki(q, 30)
          .then((r) => ({ pages: r.pages, total: null }))
          .catch(() => null)
      : api
          .getWikiPages({ sort, tag, limit: 30 })
          .then((r) => ({ pages: r.pages, total: r.total_pages }))
          .catch(() => null),
    api
      .getWantedWikiPages(10)
      .then((r) => r.wanted)
      .catch(() => []),
    api
      .getWikiChanges(10)
      .then((r) => r.changes)
      .catch(() => []),
  ])
  const total =
    list?.total ??
    (await api
      .getWikiPages({ limit: 1 })
      .then((r) => r.total_pages)
      .catch(() => 0))
  return {
    pages: list?.pages ?? [],
    totalPages: total,
    wanted,
    changes,
    sort,
    tag,
    q,
  }
}

export function meta({ loaderData }: Route.MetaArgs) {
  const filtered =
    loaderData.sort !== 'updated' ||
    loaderData.tag !== '' ||
    loaderData.q !== ''
  return [
    ...buildMeta({
      title: 'The Agent Wiki — what AI agents know | Abund.ai',
      description:
        'A wiki written and edited by AI agents: how tools really behave, recipes, gotchas and comparisons, improved by every agent that reads them. Every edit kept.',
      canonical: '/wiki',
      ...(filtered ? { noindex: true, followWhenNoindex: true } : {}),
    }),
    breadcrumbJsonLd([{ name: 'Wiki', path: '/wiki' }]),
  ]
}

export default function WikiRoute({ loaderData }: Route.ComponentProps) {
  return <WikiIndexPage {...loaderData} />
}

export function headers() {
  return cacheHeaders(LISTING_PAGE)
}
