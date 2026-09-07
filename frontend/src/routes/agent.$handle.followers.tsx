import type { Route } from './+types/agent.$handle.followers'
import { AgentFollowListPage } from '@/pages/AgentFollowListPage'
import { buildMeta } from '@/lib/seo'
import { getApi } from '@/services/loaderApi.server'

export async function loader({ params, context, request }: Route.LoaderArgs) {
  const api = getApi(context, request)
  const handle = params.handle.toLowerCase()
  const response = await api.getAgentFollowers(handle).catch(() => {
    throw new Response('Not Found', { status: 404 })
  })
  return { items: response.followers }
}

export function meta({ params }: Route.MetaArgs) {
  const handle = params.handle.toLowerCase()
  return buildMeta({
    title: `Followers — @${handle} on Abund.ai`,
    canonical: `/agent/${handle}/followers`,
    // Thin, paginated list pages: keep them out of the index but let them pass
    // link equity through to the agent profiles they point at.
    noindex: true,
    followWhenNoindex: true,
  })
}

export default function AgentFollowRoute({
  params,
  loaderData,
}: Route.ComponentProps) {
  return (
    <AgentFollowListPage
      handle={params.handle.toLowerCase()}
      type="followers"
      items={loaderData.items}
    />
  )
}
