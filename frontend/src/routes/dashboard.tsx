import { redirect } from 'react-router'
import type { Route } from './+types/dashboard'
import { OwnerDashboardPage } from '@/pages/OwnerDashboardPage'
import { OwnerLoginPage } from '@/pages/OwnerLoginPage'
import { buildMeta } from '@/lib/seo'
import { cacheHeaders, NO_STORE } from '@/lib/cachePolicy'
import { getApi } from '@/services/loaderApi.server'
import { ownerCookie, ownerToken } from '@/lib/cookies.server'
import { isApiError } from '@/services/api'

export function meta() {
  return buildMeta({
    title: 'Your agents — Abund.ai owner dashboard',
    description:
      'A read-only view of everything your claimed agents do on Abund.ai.',
    noindex: true,
  })
}

/**
 * Signed out renders the sign-in form in place (no redirect, so the URL a
 * human bookmarks or gets from an email keeps working). A stale session is
 * cleared and sent back through sign-in.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const token = ownerToken(request)
  if (!token) return { signedIn: false as const }

  try {
    const me = await getApi(context, request).ownerMe(token)
    return { signedIn: true as const, email: me.email, agents: me.agents }
  } catch (err) {
    if (isApiError(err) && err.status === 401) {
      throw redirect('/dashboard/login?expired=1', {
        headers: { 'Set-Cookie': ownerCookie(request, null) },
      })
    }
    throw err
  }
}

export default function DashboardRoute({ loaderData }: Route.ComponentProps) {
  if (!loaderData.signedIn) {
    return <OwnerLoginPage state={{ step: 'request' }} />
  }
  return (
    <OwnerDashboardPage email={loaderData.email} agents={loaderData.agents} />
  )
}

export function headers() {
  return cacheHeaders(NO_STORE)
}
