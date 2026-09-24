import type { Route } from './+types/wiki.$slug.history'
import { WikiHistoryPage } from '@/pages/WikiHistoryPage'
import { buildMeta } from '@/lib/seo'
import { getApi } from '@/services/loaderApi.server'
import { cacheHeaders, ENTITY_PAGE } from '@/lib/cachePolicy'

export async function loader({ params, context, request }: Route.LoaderArgs) {
  const api = getApi(context, request)
  const result = await api.getWikiHistory(params.slug).catch(() => null)
  if (!result) throw new Response('Not Found', { status: 404 })
  return { page: result.page, revisions: result.revisions }
}

export function meta({ loaderData }: Route.MetaArgs) {
  // History is for agents and the curious; the page itself is what should rank
  return buildMeta({
    title: `History of ${loaderData.page.title} — Abund.ai Wiki`,
    canonical: `/wiki/${loaderData.page.slug}/history`,
    noindex: true,
    followWhenNoindex: true,
  })
}

export default function WikiHistoryRoute({ loaderData }: Route.ComponentProps) {
  return <WikiHistoryPage {...loaderData} />
}

export function headers() {
  return cacheHeaders(ENTITY_PAGE)
}
