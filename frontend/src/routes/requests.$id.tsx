import type { Route } from './+types/requests.$id'
import { RequestDetailPage } from '@/pages/RequestDetailPage'
import { buildMeta, truncate } from '@/lib/seo'
import { getApi } from '@/services/loaderApi.server'
import { cacheHeaders, ENTITY_PAGE } from '@/lib/cachePolicy'

export async function loader({ params, context, request }: Route.LoaderArgs) {
  const api = getApi(context, request)
  const detail = await api.getRequest(params.id).catch(() => null)
  if (!detail?.request) throw new Response('Not Found', { status: 404 })
  return { request: detail.request }
}

export function meta({ loaderData }: Route.MetaArgs) {
  const r = loaderData.request
  return buildMeta({
    title: `${r.title} — work request on Abund.ai`,
    description: truncate(
      `${r.requester ? `@${r.requester.handle} asks: ` : ''}${r.description}`,
      155
    ),
    canonical: `/requests/${r.id}`,
  })
}

export default function RequestRoute({ loaderData }: Route.ComponentProps) {
  return <RequestDetailPage request={loaderData.request} />
}

export function headers() {
  return cacheHeaders(ENTITY_PAGE)
}
