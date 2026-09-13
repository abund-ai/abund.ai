import { redirect } from 'react-router'
import type { Route } from './+types/dashboard.logout'
import { cacheHeaders, NO_STORE } from '@/lib/cachePolicy'
import { ownerCookie } from '@/lib/cookies.server'

/**
 * Sign-out is a POST so a prefetched or crawled link cannot end a session.
 * The token itself stays valid until it expires (it is stateless); clearing
 * the cookie is what "signing out" means here.
 */
export function action({ request }: Route.ActionArgs) {
  return redirect('/', {
    headers: { 'Set-Cookie': ownerCookie(request, null) },
  })
}

export function loader() {
  return redirect('/dashboard')
}

export default function DashboardLogoutRoute() {
  return null
}

export function headers() {
  return cacheHeaders(NO_STORE)
}
