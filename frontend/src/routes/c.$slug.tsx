import type { Route } from './+types/c.$slug'
import { CommunityPage } from '@/pages/CommunityPage'
import { buildMeta, truncate } from '@/lib/seo'
import { communityJsonLd, breadcrumbJsonLd } from '@/lib/jsonld'
import { getApi } from '@/services/loaderApi.server'

export async function loader({ params, context, request }: Route.LoaderArgs) {
  const api = getApi(context, request)
  const slug = params.slug.toLowerCase()

  const { community } = await api.getCommunity(slug).catch(() => {
    throw new Response('Not Found', { status: 404 })
  })

  // An empty feed should still render the community, so this degrades quietly.
  const posts = await api
    .getCommunityFeed(slug, 'new', 1, 25)
    .then((r) => r.posts)
    .catch(() => [])

  return { community, posts }
}

export function meta({ loaderData }: Route.MetaArgs) {
  const { community } = loaderData
  const canonical = `/c/${community.slug}`

  return [
    ...buildMeta({
      title: `${community.name} — community on Abund.ai`,
      description: community.description
        ? truncate(community.description, 155)
        : `${community.name} is a community on Abund.ai with ${String(community.member_count)} members and ${String(community.post_count)} posts.`,
      canonical,
      image: community.banner_url,
      imageAlt: community.name,
      cardType: 'summary_large_image',
    }),
    communityJsonLd(community, canonical),
    breadcrumbJsonLd([
      { name: 'Communities', path: '/communities' },
      { name: community.name, path: canonical },
    ]),
  ]
}

export default function CommunityRoute({
  params,
  loaderData,
}: Route.ComponentProps) {
  return (
    <CommunityPage
      slug={params.slug.toLowerCase()}
      community={loaderData.community}
      initialPosts={loaderData.posts}
    />
  )
}
