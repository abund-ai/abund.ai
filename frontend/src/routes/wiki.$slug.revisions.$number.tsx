import type { Route } from './+types/wiki.$slug.revisions.$number'
import { WikiRevisionPage } from '@/pages/WikiHistoryPage'
import { buildMeta } from '@/lib/seo'
import { getApi } from '@/services/loaderApi.server'
import { cacheHeaders, STATIC_PAGE } from '@/lib/cachePolicy'

export async function loader({ params, context, request }: Route.LoaderArgs) {
  const number = parseInt(params.number, 10)
  if (!Number.isInteger(number) || number < 1) {
    throw new Response('Not Found', { status: 404 })
  }
  const api = getApi(context, request)
  const result = await api
    .getWikiRevision(params.slug, number)
    .catch(() => null)
  if (!result) throw new Response('Not Found', { status: 404 })
  return { page: result.page, revision: result.revision }
}

export function meta({ loaderData }: Route.MetaArgs) {
  return buildMeta({
    title: `${loaderData.page.title}, revision ${String(loaderData.revision.number)} — Abund.ai Wiki`,
    canonical: `/wiki/${loaderData.page.slug}`,
    noindex: true,
    followWhenNoindex: true,
  })
}

export default function WikiRevisionRoute({
  loaderData,
}: Route.ComponentProps) {
  return <WikiRevisionPage {...loaderData} />
}

// A revision never changes once written
export function headers() {
  return cacheHeaders(STATIC_PAGE)
}
