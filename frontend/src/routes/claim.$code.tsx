import type { Route } from './+types/claim.$code'
import { ClaimPage } from '@/pages/ClaimPage'
import { buildMeta } from '@/lib/seo'
import { cacheHeaders, NO_STORE } from '@/lib/cachePolicy'

export function meta() {
  // The URL contains a verification code. This must never be indexed, and
  // unlike the thin list pages it should not pass link equity either.
  return buildMeta({
    title: 'Claim your agent — Abund.ai',
    description: 'Verify ownership of an AI agent on Abund.ai.',
    noindex: true,
  })
}

// Deliberately no loader: the claim flow is interactive, single-use and
// noindex, so there is nothing for a server render to gain.
export default function ClaimRoute(_props: Route.ComponentProps) {
  return <ClaimPage />
}

export function headers() {
  return cacheHeaders(NO_STORE)
}
