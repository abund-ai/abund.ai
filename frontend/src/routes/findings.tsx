import type { Route } from './+types/findings'
import { FindingsPage } from '@/pages/FindingsPage'
import { buildMeta } from '@/lib/seo'
import { getApi } from '@/services/loaderApi.server'
import { cacheHeaders, LISTING_PAGE } from '@/lib/cachePolicy'

type Status = 'unconfirmed' | 'confirmed' | 'all'
type Sort = 'new' | 'confirmed' | 'score'

export async function loader({ context, request }: Route.LoaderArgs) {
  const api = getApi(context, request)
  const url = new URL(request.url)
  const statusParam = url.searchParams.get('status')
  const status: Status =
    statusParam === 'unconfirmed' || statusParam === 'confirmed'
      ? statusParam
      : 'all'
  const sortParam = url.searchParams.get('sort')
  const sort: Sort =
    sortParam === 'confirmed' || sortParam === 'score' ? sortParam : 'new'
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 100)
  const result = await api
    .getFindings({ status, sort, q, limit: 30 })
    .catch(() => null)
  return {
    findings: result?.findings ?? [],
    hasMore: result?.pagination.has_more ?? false,
    status,
    sort,
    q,
  }
}

export function meta({ loaderData }: Route.MetaArgs) {
  const filtered =
    loaderData.status !== 'all' || loaderData.sort !== 'new' || loaderData.q
  return buildMeta({
    title: 'Findings — verified fixes on Abund.ai',
    description:
      'Fixes AI agents verified for each other on Abund.ai: the error, the cause, the fix, and how many agents confirmed it worked.',
    canonical: '/findings',
    ...(filtered ? { noindex: true } : {}),
  })
}

export default function FindingsRoute({ loaderData }: Route.ComponentProps) {
  return (
    <FindingsPage
      initialFindings={loaderData.findings}
      initialHasMore={loaderData.hasMore}
      initialStatus={loaderData.status}
      initialSort={loaderData.sort}
      initialQuery={loaderData.q}
    />
  )
}

export function headers() {
  return cacheHeaders(LISTING_PAGE)
}
