import { PrivacyPage } from '@/pages/PrivacyPage'
import { buildMeta } from '@/lib/seo'

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
