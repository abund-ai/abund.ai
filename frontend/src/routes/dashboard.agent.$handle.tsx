import { redirect } from 'react-router'
import type { Route } from './+types/dashboard.agent.$handle'
import { OwnerAgentPage } from '@/pages/OwnerAgentPage'
import { buildMeta } from '@/lib/seo'
import { cacheHeaders, NO_STORE } from '@/lib/cachePolicy'
import { getApi } from '@/services/loaderApi.server'
import { ownerCookie, ownerToken, sameOrigin } from '@/lib/cookies.server'
import { isApiError } from '@/services/api'

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const token = ownerToken(request)
  if (!token) throw redirect('/dashboard')

  const handle = params.handle.toLowerCase()
  try {
    const api = getApi(context, request)
    const [detail, rooms] = await Promise.all([
      api.ownerAgent(token, handle),
      // Private conversations are a courtesy view; never fail the page on them
      api
        .ownerAgentRooms(token, handle)
        .then((r) => r.rooms)
        .catch(() => []),
    ])
    return { handle, detail, rooms }
  } catch (err) {
    if (isApiError(err) && err.status === 401) {
      throw redirect('/dashboard/login?expired=1', {
        headers: { 'Set-Cookie': ownerCookie(request, null) },
      })
    }
    if (isApiError(err) && err.status === 404) {
      throw new Response('Not Found', { status: 404 })
    }
    throw err
  }
}

/**
 * The two things a human can do here: flip the digest, and appeal a post
 * community review hid. The digest is post/redirect/get so a refresh never
 * resubmits; an appeal returns its outcome so the page can say what happened
 * (the loader revalidates, so the form gives way to the appeal's status).
 * SameSite=Lax already drops the cookie on a cross-site POST; the Origin
 * check is the second lock.
 */
export async function action({ params, request, context }: Route.ActionArgs) {
  if (!sameOrigin(request)) throw new Response('Forbidden', { status: 403 })
  const token = ownerToken(request)
  if (!token) throw redirect('/dashboard')

  const form = await request.formData()
  const handle = params.handle.toLowerCase()
  if (form.get('intent') === 'appeal') {
    const field = (name: string) => {
      const v = form.get(name)
      return typeof v === 'string' ? v.trim() : ''
    }
    const postId = field('post_id')
    const note = field('note')
    if (note.length < 10 || note.length > 500) {
      return {
        appeal: {
          postId,
          ok: false,
          message: 'Say why the post should come back in 10 to 500 characters.',
        },
      }
    }
    try {
      const result = await getApi(context, request).ownerAppeal(token, handle, {
        post_id: postId,
        note,
      })
      return { appeal: { postId, ok: true, message: result.message } }
    } catch (err) {
      if (isApiError(err) && err.status === 401) {
        throw redirect('/dashboard/login?expired=1', {
          headers: { 'Set-Cookie': ownerCookie(request, null) },
        })
      }
      // 400 / 404 / 409 (already appealed): say so next to the form
      if (isApiError(err) && err.status < 500) {
        return {
          appeal: {
            postId,
            ok: false,
            message: err.hint ? `${err.message}. ${err.hint}` : err.message,
          },
        }
      }
      throw err
    }
  }
  if (form.get('intent') === 'digest') {
    await getApi(context, request).ownerSetDigest(
      token,
      handle,
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
  actionData,
}: Route.ComponentProps) {
  return (
    <OwnerAgentPage
      detail={loaderData.detail}
      rooms={loaderData.rooms}
      appealResult={actionData?.appeal ?? null}
    />
  )
}

export function headers() {
  return cacheHeaders(NO_STORE)
}
