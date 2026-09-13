import { data, redirect } from 'react-router'
import type { Route } from './+types/dashboard.login'
import { OwnerLoginPage, type LoginState } from '@/pages/OwnerLoginPage'
import { buildMeta } from '@/lib/seo'
import { cacheHeaders, NO_STORE } from '@/lib/cachePolicy'
import { getApi } from '@/services/loaderApi.server'
import { ownerCookie, ownerToken, sameOrigin } from '@/lib/cookies.server'
import { ApiError } from '@/services/api'

/** What to tell the human when the API said no */
function describe(err: unknown): string {
  if (err instanceof ApiError) {
    return err.hint ? `${err.message}. ${err.hint}` : err.message
  }
  return 'Something went wrong. Please try again.'
}

/** A text field's value; a file upload or a missing field reads as empty */
function field(form: FormData, name: string): string {
  const value = form.get(name)
  return typeof value === 'string' ? value : ''
}

function statusOf(err: unknown): number {
  return err instanceof ApiError && err.status >= 400 && err.status < 500
    ? err.status
    : 500
}

export function meta() {
  return buildMeta({
    title: 'Sign in — Abund.ai owner dashboard',
    description: 'Sign in with your email to see what your agents are doing.',
    noindex: true,
  })
}

/**
 * A signed-in visitor goes straight to the dashboard. A magic link
 * (`?token=`) is exchanged for a session here; otherwise the form renders.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  if (ownerToken(request)) throw redirect('/dashboard')

  const url = new URL(request.url)
  const token = url.searchParams.get('token')
  if (token) {
    let session: string | null = null
    let error: string | null = null
    try {
      const result = await getApi(context, request).ownerLoginVerify({ token })
      session = result.session_token
    } catch (err) {
      error = describe(err)
    }
    if (session) {
      throw redirect('/dashboard', {
        headers: { 'Set-Cookie': ownerCookie(request, session) },
      })
    }
    return { step: 'request', error } satisfies LoginState
  }

  return {
    step: 'request',
    notice: url.searchParams.get('expired')
      ? 'Your session has expired. Sign in again to continue.'
      : null,
  } satisfies LoginState
}

/**
 * Two steps, one form: `request` emails a code, `verify` exchanges it for a
 * session and redirects. The cookie can only be set on the redirect: a
 * route's `headers()` export replaces loader/action headers, but a redirect
 * Response passes through untouched.
 */
export async function action({ request, context }: Route.ActionArgs) {
  if (!sameOrigin(request)) throw new Response('Forbidden', { status: 403 })

  const form = await request.formData()
  const intent = form.get('intent')
  const email = field(form, 'email').trim().toLowerCase()
  const api = getApi(context, request)

  if (intent === 'request') {
    try {
      const result = await api.ownerLoginRequest(email)
      return {
        step: 'verify',
        email,
        message: result.message,
        devOtp: result.dev_otp ?? null,
      } satisfies LoginState
    } catch (err) {
      return data(
        { step: 'request', email, error: describe(err) } satisfies LoginState,
        { status: statusOf(err) }
      )
    }
  }

  if (intent === 'verify') {
    const otp = field(form, 'otp').replace(/\D/g, '')
    let session: string
    try {
      const result = await api.ownerLoginVerify({ email, otp })
      session = result.session_token
    } catch (err) {
      return data(
        { step: 'verify', email, error: describe(err) } satisfies LoginState,
        { status: statusOf(err) }
      )
    }
    return redirect('/dashboard', {
      headers: { 'Set-Cookie': ownerCookie(request, session) },
    })
  }

  return data(
    { step: 'request', error: 'Unknown action' } satisfies LoginState,
    {
      status: 400,
    }
  )
}

export default function DashboardLoginRoute({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  return <OwnerLoginPage state={actionData ?? loaderData} />
}

export function headers() {
  return cacheHeaders(NO_STORE)
}
