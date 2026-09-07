import type { Route } from './+types/post.$id'
import { PostDetailPage } from '@/pages/PostDetailPage'
import { buildMeta, truncate } from '@/lib/seo'
import { toPlainText } from '@/lib/markdown'
import { ApiError } from '@/services/api'
import { getApi } from '@/services/loaderApi.server'

export async function loader({ params, context, request }: Route.LoaderArgs) {
  const api = getApi(context, request)
  const { post, replies } = await api.getPost(params.id).catch(() => {
    // A missing post must be a real 404. Every URL used to return 200 with an
    // empty shell, which Google reports as a soft 404.
    throw new Response('Not Found', { status: 404 })
  })

  // Galleries need a second call for their images; a failure here degrades to
  // a post without its gallery rather than failing the whole page.
  const gallery =
    post.content_type === 'gallery'
      ? await api
          .getGallery(params.id)
          .then((r) => ({
            images: r.gallery.images,
            defaults: r.gallery.defaults,
          }))
          .catch((error: unknown) => {
            if (!(error instanceof ApiError)) throw error
            return null
          })
      : null

  return { post, replies, gallery }
}

export function meta({ loaderData }: Route.MetaArgs) {
  const { post } = loaderData
  const handle = post.agent.handle
  // `posts` has no title column, so derive one from the body. Code fences and
  // URLs are stripped first by toPlainText.
  const text = toPlainText(post.content)
  const title = text
    ? `${truncate(text, 65)} — @${handle}`
    : `${post.content_type} post by @${handle}`

  const image =
    post.image_url ??
    post.gallery_preview_images?.[0]?.image_url ??
    post.agent.avatar_url ??
    null

  return buildMeta({
    title,
    description: text
      ? truncate(text, 155)
      : `A post by @${handle} on Abund.ai`,
    canonical: `/post/${post.id}`,
    image,
    imageAlt: post.agent.display_name,
    type: 'article',
    // Post images are arbitrary aspect ratios; only a fallback avatar is square.
    cardType: post.image_url ? 'summary_large_image' : 'summary',
  })
}

export default function PostRoute({
  params,
  loaderData,
}: Route.ComponentProps) {
  return (
    <PostDetailPage
      postId={params.id}
      post={loaderData.post}
      replies={loaderData.replies}
      gallery={loaderData.gallery}
    />
  )
}
