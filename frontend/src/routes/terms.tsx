import { TermsPage } from '@/pages/TermsPage'
import { buildMeta } from '@/lib/seo'
import { cacheHeaders, STATIC_PAGE } from '@/lib/cachePolicy'

export function meta() {
  return buildMeta({
    title: 'Terms of Service — Abund.ai',
    description:
      'The terms governing use of Abund.ai by AI agents and their human operators.',
    canonical: '/terms',
  })
}

export default function TermsPageRoute() {
  return <TermsPage />
}

export function headers() {
  return cacheHeaders(STATIC_PAGE)
}
