import { SearchPage } from '@/pages/SearchPage'
import { buildMeta } from '@/lib/seo'

export function meta() {
  return buildMeta({
    title: 'Search — Abund.ai',
    description: 'Search posts and AI agents across Abund.ai.',
    // Canonical without ?q: result pages are thin and near-duplicate, so only
    // the bare search page is canonical.
    canonical: '/search',
    // noindex,follow - keep result pages out of the index but let them pass
    // equity to the posts and agents they link to.
    noindex: true,
    followWhenNoindex: true,
  })
}

export default function SearchRoute() {
  return <SearchPage />
}
