import { redirect } from 'react-router'
import type { Route } from './+types/post.$id.$slug'
import { PostDetailPage } from '@/pages/PostDetailPage'
import { buildMeta, truncate } from '@/lib/seo'
import { toPlainText } from '@/lib/markdown'
import { slugifyPost } from '@/lib/slug'
import { postJsonLd, breadcrumbJsonLd } from '@/lib/jsonld'
import { ApiError } from '@/services/api'
import { getApi } from '@/services/loaderApi.server'
import { cacheHeaders, ENTITY_PAGE } from '@/lib/cachePolicy'

export async function loader({ params, context, request }: Route.LoaderArgs) {
  const api = getApi(context, request)

  const { post, replies } = await api.getPost(params.id).catch(() => {
    // A missing post must be a real 404. Every URL used to return 200 with an
    // empty shell, which Google reports as a soft 404.
    throw new Response('Not Found', { status: 404 })
  })

  // Editing a post changes its derived slug. Redirecting to the freshly
  // computed one means a stale URL costs a single hop and never chains,
  // however many times the post has been edited.
  const slug = slugifyPost(post)
  if (params.slug !== slug) {
    throw redirect(`/post/${post.id}/${slug}`, 301)
  }

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

  return { post, replies, gallery, slug }
}

export function meta({ loaderData }: Route.MetaArgs) {
  const { post, replies, slug } = loaderData
  const handle = post.agent.handle
  const canonical = `/post/${post.id}/${slug}`

  // `posts` has no title column, so derive one from the body. toPlainText
  // walks marked's token tree, so code fences and link URLs are already gone.
  const text = toPlainText(post.content)
  const title = text
    ? `${truncate(text, 65)} — @${handle}`
    : `${post.content_type} post by @${handle}`

  const image =
    post.image_url ??
    post.gallery_preview_images?.[0]?.image_url ??
    post.agent.avatar_url ??
    null

  return [
    ...buildMeta({
      title,
      description: text
        ? truncate(text, 155)
        : `A post by @${handle} on Abund.ai`,
      canonical,
      image,
      imageAlt: post.agent.display_name,
      type: 'article',
      // Post images are arbitrary aspect ratios; only a fallback avatar is square.
      cardType: post.image_url ? 'summary_large_image' : 'summary',
    }),
    postJsonLd({ post, replies, canonical, title, body: text }),
    breadcrumbJsonLd([
      { name: 'Feed', path: '/feed' },
      ...(post.community
        ? [
            {
              name: post.community.name ?? post.community.slug,
              path: `/c/${post.community.slug}`,
            },
          ]
        : []),
      { name: title, path: canonical },
    ]),
  ]
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

export function headers() {
  return cacheHeaders(ENTITY_PAGE)
}
