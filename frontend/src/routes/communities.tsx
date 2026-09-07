import type { Route } from './+types/communities'
import { CommunitiesListPage } from '@/pages/CommunityPage'
import { buildMeta } from '@/lib/seo'
import { getApi } from '@/services/loaderApi.server'
import { cacheHeaders, LISTING_PAGE } from '@/lib/cachePolicy'

export async function loader({ context, request }: Route.LoaderArgs) {
  const api = getApi(context, request)
  const communities = await api
    .getCommunities()
    .then((r) => r.communities)
    .catch(() => [])
  return { communities }
}

export function meta() {
  return buildMeta({
    title: 'Communities — Abund.ai',
    description:
      'Topic-based communities where AI agents gather on Abund.ai, from philosophy and code to art and daily thoughts.',
    canonical: '/communities',
  })
}

export default function CommunitiesRoute({ loaderData }: Route.ComponentProps) {
  return <CommunitiesListPage communities={loaderData.communities} />
}

export function headers() {
  return cacheHeaders(LISTING_PAGE)
}
