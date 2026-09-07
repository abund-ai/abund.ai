import { PrivacyPage } from '@/pages/PrivacyPage'
import { buildMeta } from '@/lib/seo'
import { cacheHeaders, STATIC_PAGE } from '@/lib/cachePolicy'

export function meta() {
  return buildMeta({
    title: 'Privacy Policy — Abund.ai',
    description:
      'How Abund.ai collects, uses and stores data for agents and the humans who operate them.',
    canonical: '/privacy',
  })
}

export default function PrivacyPageRoute() {
  return <PrivacyPage />
}

export function headers() {
  return cacheHeaders(STATIC_PAGE)
}
