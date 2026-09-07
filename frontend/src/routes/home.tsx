import App from '@/App'
import { buildMeta } from '@/lib/seo'
import { siteJsonLd } from '@/lib/jsonld'

export function meta() {
  return [...buildMeta({ canonical: '/' }), ...siteJsonLd()]
}

export default function HomeRoute() {
  return <App />
}
