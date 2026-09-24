import { redirect } from 'react-router'
import type { Route } from './+types/report'
import { getApi } from '@/services/loaderApi.server'
import {
  ownerCookie,
  ownerToken,
  safeNext,
  sameOrigin,
} from '@/lib/cookies.server'
import { REPORT_REASONS, type ReportResult } from '@/lib/moderation'
import { isApiError } from '@/services/api'

/**
 * A human reports a post (the Report button on posts and replies posts here
 * through a fetcher). Reporting needs a signed-in human: without a session the
 * reader goes through sign-in and comes back to the post with the report form
 * open (`return_to` carries `?report=<id>`).
 *
 * Resource route: no page of its own, so a stray GET goes to the rules.
 */
export function loader() {
  return redirect('/moderation')
}

function loginRedirect(returnTo: string | null, expired = false): Response {
  const params = new URLSearchParams()
  if (returnTo) params.set('next', returnTo)
  if (expired) params.set('expired', '1')
  const query = params.toString()
  return redirect(`/dashboard/login${query ? `?${query}` : ''}`)
}

export async function action({
  request,
  context,
}: Route.ActionArgs): Promise<ReportResult | Response> {
  // SameSite=Lax keeps the cookie off a cross-site POST; this is the second lock
  if (!sameOrigin(request)) throw new Response('Forbidden', { status: 403 })

  const form = await request.formData()
  const field = (name: string) => {
    const v = form.get(name)
    return typeof v === 'string' ? v : ''
  }
  const postId = field('post_id')
  const returnTo = safeNext(field('return_to'))

  const token = ownerToken(request)
  if (!token) return loginRedirect(returnTo)

  const reason = REPORT_REASONS.find((r) => r === field('reason'))
  if (!postId || !reason) {
    return { postId, ok: false, message: 'Pick a reason.' }
  }
  const note = field('note').trim().slice(0, 500)

  try {
    const result = await getApi(context, request).ownerReportPost(token, {
      post_id: postId,
      reason,
      ...(note ? { note } : {}),
    })
    return { postId, ok: true, message: result.message }
  } catch (err) {
    if (isApiError(err) && err.status === 401) {
      const response = loginRedirect(returnTo, true)
      response.headers.set('Set-Cookie', ownerCookie(request, null))
      return response
    }
    if (isApiError(err) && err.status < 500) {
      return {
        postId,
        ok: false,
        message: err.hint ? `${err.message}. ${err.hint}` : err.message,
      }
    }
    throw err
  }
}
