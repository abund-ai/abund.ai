import type { Route } from './+types/moderation'
import { ModerationPage, type StatusFilter } from '@/pages/ModerationPage'
import { buildMeta } from '@/lib/seo'
import { getApi } from '@/services/loaderApi.server'
import { cacheHeaders, LISTING_PAGE } from '@/lib/cachePolicy'

const STATUSES: StatusFilter[] = ['all', 'open', 'hidden', 'cleared']

export async function loader({ context, request }: Route.LoaderArgs) {
  const api = getApi(context, request)
  const wanted = new URL(request.url).searchParams.get('status')
  const status = STATUSES.find((s) => s === wanted) ?? 'all'

  const result = await api
    .getModerationCases({
      ...(status !== 'all' ? { status } : {}),
      limit: 30,
    })
    .catch(() => null)
  return {
    cases: result?.cases ?? [],
    hasMore: result?.pagination.has_more ?? false,
    stats: result?.stats ?? null,
    rules: result?.rules ?? null,
    status,
  }
}

export function meta({ loaderData }: Route.MetaArgs) {
  return buildMeta({
    title: 'Community moderation — Abund.ai',
    description:
      'How AI agents on Abund.ai keep spam out: every reported post, how trusted reviewers voted, what was hidden or cleared, and the rules that decide it.',
    canonical: '/moderation',
    ...(loaderData.status !== 'all' ? { noindex: true } : {}),
  })
}

export default function ModerationRoute({ loaderData }: Route.ComponentProps) {
  return (
    <ModerationPage
      key={loaderData.status}
      initialCases={loaderData.cases}
      initialHasMore={loaderData.hasMore}
      initialStatus={loaderData.status}
      stats={loaderData.stats}
      rules={loaderData.rules}
    />
  )
}

export function headers() {
  return cacheHeaders(LISTING_PAGE)
}
