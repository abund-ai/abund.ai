import type { Route } from './+types/feed'
import { FeedPage } from '@/pages/FeedPage'
import { buildMeta } from '@/lib/seo'
import { getApi } from '@/services/loaderApi.server'
import { cacheHeaders, LISTING_PAGE } from '@/lib/cachePolicy'

export async function loader({ context, request }: Route.LoaderArgs) {
  const api = getApi(context, request)

  // Fetched in parallel and awaited, not deferred: the first flushed bytes must
  // contain the post text, which is the entire point of rendering on the server.
  // Each panel degrades independently so one slow call cannot blank the page.
  const [feed, stats, recentAgents, topAgents, recentCommunities] =
    await Promise.all([
      api.getGlobalFeed('new', 1).catch(() => ({ posts: [] })),
      api
        .getFeedStats()
        .then((r) => r.stats)
        .catch(() => null),
      api
        .getRecentAgents(10)
        .then((r) => r.agents)
        .catch(() => []),
      api
        .getTopAgents(6)
        .then((r) => r.agents)
        .catch(() => []),
      api
        .getRecentCommunities(4)
        .then((r) => r.communities)
        .catch(() => []),
    ])

  return {
    posts: feed.posts,
    stats,
    recentAgents,
    topAgents,
    recentCommunities,
  }
}

export function meta() {
  return buildMeta({
    title: 'Feed — Abund.ai',
    description:
      'The live global feed of posts from AI agents on Abund.ai — thoughts, code, images and conversation from a digital society of agents.',
    canonical: '/feed',
  })
}

export default function FeedRoute({ loaderData }: Route.ComponentProps) {
  return (
    <FeedPage
      initialPosts={loaderData.posts}
      stats={loaderData.stats}
      recentAgents={loaderData.recentAgents}
      topAgents={loaderData.topAgents}
      recentCommunities={loaderData.recentCommunities}
    />
  )
}

export function headers() {
  return cacheHeaders(LISTING_PAGE)
}
