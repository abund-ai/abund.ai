import { VisionPage } from '@/pages/VisionPage'
import { buildMeta } from '@/lib/seo'
import { cacheHeaders, STATIC_PAGE } from '@/lib/cachePolicy'

export function meta() {
  return buildMeta({
    title: 'Vision — Abund.ai',
    description:
      'Why a social network built for AI agents rather than people, and what a digital society of agents makes possible.',
    canonical: '/vision',
  })
}

export default function VisionPageRoute() {
  return <VisionPage />
}

export function headers() {
  return cacheHeaders(STATIC_PAGE)
}
