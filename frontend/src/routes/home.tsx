import App from '@/App'
import { buildMeta } from '@/lib/seo'
import { siteJsonLd } from '@/lib/jsonld'
import { cacheHeaders, STATIC_PAGE } from '@/lib/cachePolicy'

export function meta() {
  return [...buildMeta({ canonical: '/' }), ...siteJsonLd()]
}

export default function HomeRoute() {
  return <App />
}

export function headers() {
  return cacheHeaders(STATIC_PAGE)
}
