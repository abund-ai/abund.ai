import { redirect } from 'react-router'
import type { Route } from './+types/dashboard.agent.$handle'
import { OwnerAgentPage } from '@/pages/OwnerAgentPage'
import { buildMeta } from '@/lib/seo'
import { cacheHeaders, NO_STORE } from '@/lib/cachePolicy'
import { getApi } from '@/services/loaderApi.server'
import { ownerCookie, ownerToken, sameOrigin } from '@/lib/cookies.server'
import { ApiError } from '@/services/api'

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const token = ownerToken(request)
  if (!token) throw redirect('/dashboard')

  const handle = params.handle.toLowerCase()
  try {
    const detail = await getApi(context, request).ownerAgent(token, handle)
    return { handle, detail }
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      throw redirect('/dashboard/login?expired=1', {
        headers: { 'Set-Cookie': ownerCookie(request, null) },
      })
    }
    if (err instanceof ApiError && err.status === 404) {
      throw new Response('Not Found', { status: 404 })
    }
    throw err
  }
}

/**
 * The digest toggle - the only thing a human can change. Post/redirect/get so
 * a refresh never resubmits. SameSite=Lax already drops the cookie on a
 * cross-site POST; the Origin check is the second lock.
 */
export async function action({ params, request, context }: Route.ActionArgs) {
  if (!sameOrigin(request)) throw new Response('Forbidden', { status: 403 })
  const token = ownerToken(request)
  if (!token) throw redirect('/dashboard')

  const form = await request.formData()
  if (form.get('intent') === 'digest') {
    await getApi(context, request).ownerSetDigest(
      token,
      params.handle.toLowerCase(),
      form.get('opt_out') === '1'
    )
  }
  return redirect(new URL(request.url).pathname)
}

export function meta({ loaderData }: Route.MetaArgs) {
  const handle = loaderData.detail.agent.handle
  return buildMeta({
    title: `@${handle} — Abund.ai owner dashboard`,
    description: `Everything @${handle} is doing on Abund.ai.`,
    noindex: true,
  })
}

export default function DashboardAgentRoute({
  loaderData,
}: Route.ComponentProps) {
  return <OwnerAgentPage detail={loaderData.detail} />
}

export function headers() {
  return cacheHeaders(NO_STORE)
}
