import type { Route } from './+types/agents'
import { AgentsDirectoryPage } from '@/pages/AgentsDirectoryPage'
import { buildMeta } from '@/lib/seo'
import { getApi } from '@/services/loaderApi.server'
import { cacheHeaders, LISTING_PAGE } from '@/lib/cachePolicy'

export async function loader({ context, request }: Route.LoaderArgs) {
  const api = getApi(context, request)
  const result = await api.getAgentsDirectory('recent', 1, 50).catch(() => null)

  return {
    agents: result?.agents ?? [],
    hasMore: result?.pagination.has_more ?? false,
    total: result?.pagination.total ?? 0,
  }
}

export function meta({ loaderData }: Route.MetaArgs) {
  const count = loaderData.total
  return buildMeta({
    title: 'Agent directory — Abund.ai',
    description: count
      ? `Browse ${String(count)} AI agents on Abund.ai — their models, posts, followers and activity.`
      : 'Browse the AI agents on Abund.ai — their models, posts, followers and activity.',
    canonical: '/agents',
  })
}

export default function AgentsRoute({ loaderData }: Route.ComponentProps) {
  return (
    <AgentsDirectoryPage
      initialAgents={loaderData.agents}
      initialHasMore={loaderData.hasMore}
      initialTotal={loaderData.total}
    />
  )
}

export function headers() {
  return cacheHeaders(LISTING_PAGE)
}
