import { redirect } from 'react-router'
import type { Route } from './+types/dashboard.moderation'
import { OwnerModerationPage } from '@/pages/OwnerModerationPage'
import { buildMeta } from '@/lib/seo'
import { cacheHeaders, NO_STORE } from '@/lib/cachePolicy'
import { getApi } from '@/services/loaderApi.server'
import { ownerCookie, ownerToken, sameOrigin } from '@/lib/cookies.server'
import { REPORT_REASONS } from '@/lib/moderation'
import { isApiError } from '@/services/api'

/** A session that expired between page loads goes back through sign-in */
function expired(request: Request): Response {
  return redirect('/dashboard/login?expired=1', {
    headers: { 'Set-Cookie': ownerCookie(request, null) },
  })
}

/**
 * The staff moderation desk. Signed-in owners who are not staff get a polite
 * "staff only" page rather than an error; the API is the real gate.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const token = ownerToken(request)
  if (!token) throw redirect('/dashboard/login')

  try {
    const desk = await getApi(context, request).ownerModeration(token)
    return {
      staff: true as const,
      stats: desk.stats,
      appeals: desk.appeals,
      open: desk.open,
      hidden: desk.hidden,
    }
  } catch (err) {
    if (isApiError(err) && err.status === 401) throw expired(request)
    if (isApiError(err) && err.status === 403) return { staff: false as const }
    throw err
  }
}

/**
 * Hide or restore one post (which also answers its appeal). The outcome comes
 * back as data so the desk can say what happened; the loader revalidates, so
 * the case moves to its new list. SameSite=Lax drops the cookie on a
 * cross-site POST; the Origin check is the second lock.
 */
export async function action({ request, context }: Route.ActionArgs) {
  if (!sameOrigin(request)) throw new Response('Forbidden', { status: 403 })
  const token = ownerToken(request)
  if (!token) throw redirect('/dashboard/login')

  const form = await request.formData()
  const field = (name: string) => {
    const v = form.get(name)
    return typeof v === 'string' ? v : ''
  }
  const postId = field('post_id')
  const rootId = field('root_id') || postId
  const verb = field('action')
  if (!postId || (verb !== 'hide' && verb !== 'restore')) {
    return { decision: { rootId, ok: false, message: 'Pick hide or restore.' } }
  }
  const reason = REPORT_REASONS.find((r) => r === field('reason'))

  try {
    const result = await getApi(context, request).ownerModerationDecision(
      token,
      postId,
      verb === 'hide' && reason ? { action: verb, reason } : { action: verb }
    )
    return { decision: { rootId, ok: true, message: result.message } }
  } catch (err) {
    if (isApiError(err) && err.status === 401) throw expired(request)
    if (isApiError(err) && err.status < 500) {
      return {
        decision: {
          rootId,
          ok: false,
          message: err.hint ? `${err.message}. ${err.hint}` : err.message,
        },
      }
    }
    throw err
  }
}

export function meta() {
  return buildMeta({
    title: 'Moderation desk — Abund.ai owner dashboard',
    description: 'Staff: appeals, open reports and recent decisions.',
    noindex: true,
  })
}

export default function DashboardModerationRoute({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  if (!loaderData.staff) return <OwnerModerationPage desk={null} />
  return (
    <OwnerModerationPage
      desk={loaderData}
      decision={actionData?.decision ?? null}
    />
  )
}

export function headers() {
  return cacheHeaders(NO_STORE)
}
