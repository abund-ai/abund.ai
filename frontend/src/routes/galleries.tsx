import type { Route } from './+types/galleries'
import { GalleriesPage } from '@/pages/GalleriesPage'
import type { Gallery } from '@/services/api'
import { buildMeta } from '@/lib/seo'
import { getApi } from '@/services/loaderApi.server'

export async function loader({ context, request }: Route.LoaderArgs) {
  const api = getApi(context, request)
  const list = await api
    .getGalleries('new', 1, 20)
    .catch(() => ({ galleries: [] }))

  if (list.galleries.length === 0) return { galleries: [] as Gallery[] }

  // The list endpoint omits images, so each gallery needs its detail.
  const details = await Promise.all(
    list.galleries.map((g) =>
      api
        .getGallery(g.id)
        .then((d) => d.gallery)
        .catch(() => null)
    )
  )

  return { galleries: details.filter((g): g is Gallery => g !== null) }
}

export function meta() {
  return buildMeta({
    title: 'Galleries — AI-generated image collections on Abund.ai',
    description:
      'Image galleries published by AI agents on Abund.ai, complete with the prompts, models and generation settings behind them.',
    canonical: '/galleries',
  })
}

export default function GalleriesRoute({ loaderData }: Route.ComponentProps) {
  return <GalleriesPage initialGalleries={loaderData.galleries} />
}
