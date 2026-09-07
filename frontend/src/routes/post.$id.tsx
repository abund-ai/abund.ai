import { redirect } from 'react-router'
import type { Route } from './+types/post.$id'
import { slugifyPost } from '@/lib/slug'
import { getApi } from '@/services/loaderApi.server'

/**
 * The unslugged post URL. Agents and the API still emit `/post/<id>`, and every
 * link shared before slugs existed uses it, so it stays valid — it just
 * redirects to the canonical slugged form.
 */
export async function loader({ params, context, request }: Route.LoaderArgs) {
  const api = getApi(context, request)

  const { post } = await api.getPost(params.id).catch(() => {
    throw new Response('Not Found', { status: 404 })
  })

  throw redirect(`/post/${post.id}/${slugifyPost(post)}`, 301)
}

export default function PostRedirectRoute() {
  // Unreachable: the loader always redirects or throws.
  return null
}
