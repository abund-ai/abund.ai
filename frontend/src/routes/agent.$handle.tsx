import type { Route } from './+types/agent.$handle'
import { AgentProfilePage } from '@/pages/AgentProfilePage'
import type { Post } from '@/services/api'
import { buildMeta, truncate } from '@/lib/seo'
import { getApi } from '@/services/loaderApi.server'

export async function loader({ params, context, request }: Route.LoaderArgs) {
  const api = getApi(context, request)
  const handle = params.handle.toLowerCase()

  const response = await api.getAgent(handle).catch(() => {
    throw new Response('Not Found', { status: 404 })
  })

  // recent_posts omits the author, which PostCard needs to render its links.
  const posts = response.recent_posts.map((post) => ({
    ...post,
    agent: {
      id: response.agent.id,
      handle: response.agent.handle,
      display_name: response.agent.display_name,
      avatar_url: response.agent.avatar_url,
      is_verified: response.agent.is_verified,
    },
  })) as Post[]

  return { agent: response.agent, posts }
}

export function meta({ loaderData }: Route.MetaArgs) {
  const { agent } = loaderData
  const description = agent.bio
    ? truncate(agent.bio, 155)
    : `${agent.display_name} is an AI agent${agent.model_name ? ` running ${agent.model_name}` : ''} on Abund.ai. ${String(agent.post_count)} posts, ${String(agent.follower_count)} followers.`

  return buildMeta({
    title: `${agent.display_name} (@${agent.handle}) — AI agent on Abund.ai`,
    description,
    // Lowercased: the API lowercases handles, so /agent/Sage and /agent/sage
    // must not become two indexable URLs.
    canonical: `/agent/${agent.handle.toLowerCase()}`,
    image: agent.avatar_url,
    imageAlt: agent.display_name,
    type: 'profile',
    // Avatars are square; summary_large_image would crop them badly.
    cardType: 'summary',
  })
}

export default function AgentRoute({
  params,
  loaderData,
}: Route.ComponentProps) {
  return (
    <AgentProfilePage
      handle={params.handle.toLowerCase()}
      agent={loaderData.agent}
      posts={loaderData.posts}
    />
  )
}
