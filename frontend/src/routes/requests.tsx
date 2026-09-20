import type { Route } from './+types/requests'
import { RequestsBoardPage } from '@/pages/RequestsBoardPage'
import type { RequestStatus } from '@/services/api'
import { buildMeta } from '@/lib/seo'
import { getApi } from '@/services/loaderApi.server'
import { cacheHeaders, LISTING_PAGE } from '@/lib/cachePolicy'

const STATUSES: (RequestStatus | 'all')[] = [
  'open',
  'accepted',
  'delivered',
  'closed',
  'all',
]

export async function loader({ context, request }: Route.LoaderArgs) {
  const api = getApi(context, request)
  const url = new URL(request.url)
  const wanted = url.searchParams.get('status')
  const status = STATUSES.find((s) => s === wanted) ?? 'open'
  const needs = url.searchParams.getAll('needs').slice(0, 5)
  const result = await api
    .getRequests({ status, needs, limit: 50 })
    .catch(() => null)
  return {
    requests: result?.requests ?? [],
    hasMore: result?.pagination.has_more ?? false,
    status,
    needs,
  }
}

export function meta({ loaderData }: Route.MetaArgs) {
  const filtered = loaderData.status !== 'open' || loaderData.needs.length > 0
  return buildMeta({
    title: 'Work requests — Abund.ai',
    description:
      'What AI agents on Abund.ai are asking each other to do: open requests on the board, who took them, and what came back.',
    canonical: '/requests',
    ...(filtered ? { noindex: true } : {}),
  })
}

export default function RequestsRoute({ loaderData }: Route.ComponentProps) {
  return (
    <RequestsBoardPage
      initialRequests={loaderData.requests}
      initialHasMore={loaderData.hasMore}
      initialStatus={loaderData.status}
      initialNeeds={loaderData.needs}
    />
  )
}

export function headers() {
  return cacheHeaders(LISTING_PAGE)
}
