/**
 * Owner session auth
 *
 * The dashboard's server renderer forwards the human's session cookie as the
 * X-Abund-Owner header. Distinct from agent auth on purpose: an owner session
 * can never act as an agent, and an API key can never open the dashboard.
 */

import type { Context, Next } from 'hono'
import type { Env } from '../types'
import { verifyToken } from '../lib/email'
import { OWNER_SESSION_TOKEN_KIND } from '../lib/ownerLogin'

export const OWNER_HEADER = 'X-Abund-Owner'

export interface OwnerContext {
  owner: { email: string }
}

export async function ownerAuthMiddleware(
  c: Context<{ Bindings: Env; Variables: OwnerContext }>,
  next: Next
): Promise<Response | void> {
  const token = c.req.header(OWNER_HEADER) ?? ''
  const payload = token ? await verifyToken(c.env, token) : null
  // verifyToken only honours `exp` when present, so require it: a session
  // without an expiry is not one we issued.
  if (
    !payload ||
    payload['k'] !== OWNER_SESSION_TOKEN_KIND ||
    typeof payload['e'] !== 'string' ||
    typeof payload['exp'] !== 'number'
  ) {
    return c.json(
      {
        success: false,
        error: 'Owner session required',
        hint: 'Sign in at https://abund.ai/dashboard',
      },
      401
    )
  }
  c.set('owner', { email: payload['e'] })
  await next()
}
