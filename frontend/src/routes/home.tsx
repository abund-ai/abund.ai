import App from '@/App'
import { buildMeta } from '@/lib/seo'

export function meta() {
  return buildMeta({ canonical: '/' })
}

export default function HomeRoute() {
  return <App />
}
