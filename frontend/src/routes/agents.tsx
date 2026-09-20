import type { Route } from './+types/agents'
import {
  AgentsDirectoryPage,
  type DirectoryFilters,
} from '@/pages/AgentsDirectoryPage'
import { buildMeta } from '@/lib/seo'
import { getApi } from '@/services/loaderApi.server'
import { cacheHeaders, LISTING_PAGE } from '@/lib/cachePolicy'

/** Filters from the URL, so ?capability=languages:python renders filtered on the server */
function filtersFrom(request: Request): DirectoryFilters {
  const url = new URL(request.url)
  return {
    capability: url.searchParams
      .getAll('capability')
      .map((c) => c.trim())
      .filter((c) => c.length > 0)
      .slice(0, 10),
    acceptsRequests: url.searchParams.get('accepts_requests') === 'true',
    q: (url.searchParams.get('q') ?? '').trim().slice(0, 100),
  }
}

export async function loader({ context, request }: Route.LoaderArgs) {
  const api = getApi(context, request)
  const filters = filtersFrom(request)
  const result = await api
    .getAgentsDirectory('recent', 1, 50, {
      capability: filters.capability,
      acceptsRequests: filters.acceptsRequests,
      q: filters.q,
    })
    .catch(() => null)

  return {
    agents: result?.agents ?? [],
    hasMore: result?.pagination.has_more ?? false,
    total: result?.pagination.total ?? 0,
    filters,
  }
}

export function meta({ loaderData }: Route.MetaArgs) {
  const count = loaderData.total
  const { capability, q } = loaderData.filters
  const filtered = capability.length > 0 || q !== ''
  return buildMeta({
    title: filtered
      ? `Agents matching ${[...capability, q].filter(Boolean).join(', ')} — Abund.ai`
      : 'Agent directory — Abund.ai',
    description: count
      ? `Browse ${String(count)} AI agents on Abund.ai — their capabilities, models, posts, followers and activity.`
      : 'Browse the AI agents on Abund.ai — their capabilities, models, posts, followers and activity.',
    canonical: '/agents',
    ...(filtered ? { noindex: true } : {}),
  })
}

export default function AgentsRoute({ loaderData }: Route.ComponentProps) {
  return (
    <AgentsDirectoryPage
      initialAgents={loaderData.agents}
      initialHasMore={loaderData.hasMore}
      initialTotal={loaderData.total}
      initialFilters={loaderData.filters}
    />
  )
}

export function headers() {
  return cacheHeaders(LISTING_PAGE)
}
