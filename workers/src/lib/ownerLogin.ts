/**
 * Owner sign-in
 *
 * The human behind an agent signs in to the read-only dashboard with the
 * email address on file for that agent. There are no passwords: a request
 * mails a 6-digit code and a one-hour magic link; either one yields a
 * stateless, HMAC-signed 30-day session token that the web Worker keeps in an
 * HttpOnly cookie and forwards to this API as the X-Abund-Owner header.
 *
 * Sessions cannot be revoked individually: rotating EMAIL_TOKEN_SECRET is the
 * only kill switch, and that also invalidates live claim links. Acceptable for
 * a read-only view plus a digest toggle.
 *
 * The same challenge serves both the human-initiated request and the
 * agent-initiated "here is my human's email" flow, so there is exactly one
 * verify path.
 */

import type { D1Database } from '@cloudflare/workers-types'
import type { Env } from '../types'
import { execute, queryOne } from './db'
import { generateOtp, sha256Hex, signToken, siteOrigin } from './email'

/** Wrong guesses allowed before a sign-in challenge is thrown away */
export const OWNER_OTP_MAX_ATTEMPTS = 5

/** How long the session cookie lives (mirrored in the web Worker's Max-Age) */
export const OWNER_SESSION_SECONDS = 60 * 60 * 24 * 30

/** Token kinds; each consumer checks its own so one can never stand in for another */
export const OWNER_LOGIN_TOKEN_KIND = 'owner-login'
export const OWNER_SESSION_TOKEN_KIND = 'owner'

/**
 * What we store for a sign-in code: never the code itself. The namespace
 * keeps it distinct from claim OTP hashes (a claim code is uppercase hex).
 */
export function ownerLoginOtpHash(email: string, otp: string) {
  return sha256Hex(`${OWNER_LOGIN_TOKEN_KIND}:${email.toLowerCase()}:${otp}`)
}

export function dashboardUrl(env: Env): string {
  return `${siteOrigin(env)}/dashboard`
}

export interface OwnerLoginChallenge {
  otp: string
  token: string
  link: string
}

/**
 * Create (or replace) the live challenge for an address and return what to
 * email. Throws only if tokens are not configured, which callers check first.
 */
export async function createOwnerLoginChallenge(
  env: Env,
  email: string
): Promise<OwnerLoginChallenge> {
  const normalized = email.toLowerCase()
  const otp = generateOtp()
  await execute(
    env.DB,
    `INSERT INTO owner_login_challenges (email, otp_hash, attempts, expires_at, created_at)
     VALUES (?, ?, 0, datetime('now', '+1 hour'), datetime('now'))
     ON CONFLICT(email) DO UPDATE SET
       otp_hash = excluded.otp_hash, attempts = 0,
       expires_at = excluded.expires_at, created_at = excluded.created_at`,
    [normalized, await ownerLoginOtpHash(normalized, otp)]
  )
  const token = await signToken(env, {
    k: OWNER_LOGIN_TOKEN_KIND,
    e: normalized,
    exp: Math.floor(Date.now() / 1000) + 60 * 60,
  })
  if (!token) throw new Error('Owner sign-in tokens are not configured')
  const link = `${dashboardUrl(env)}/login?token=${encodeURIComponent(token)}`
  return { otp, token, link }
}

/** Seconds since the live challenge for this address was created, or null */
export async function secondsSinceChallenge(
  db: D1Database,
  email: string
): Promise<number | null> {
  const row = await queryOne<{ age: number }>(
    db,
    `SELECT CAST((julianday('now') - julianday(created_at)) * 86400 AS INTEGER) AS age
     FROM owner_login_challenges WHERE email = ?`,
    [email.toLowerCase()]
  )
  return row ? row.age : null
}

export type OtpVerification =
  | { ok: true }
  | { ok: false; error: string; hint: string }

/**
 * Check a code against the live challenge. A wrong guess burns one attempt;
 * a right one deletes the challenge so it cannot be replayed.
 */
export async function verifyOwnerLoginOtp(
  db: D1Database,
  email: string,
  otp: string
): Promise<OtpVerification> {
  const normalized = email.toLowerCase()
  const challenge = await queryOne<{
    otp_hash: string
    attempts: number
    expires_at: string
  }>(
    db,
    'SELECT otp_hash, attempts, expires_at FROM owner_login_challenges WHERE email = ?',
    [normalized]
  )
  const expired =
    !challenge ||
    new Date(challenge.expires_at.replace(' ', 'T') + 'Z').getTime() <
      Date.now()
  if (!challenge || expired || challenge.attempts >= OWNER_OTP_MAX_ATTEMPTS) {
    return {
      ok: false,
      error: 'Code expired',
      hint: 'Request a new code',
    }
  }
  const expected = await ownerLoginOtpHash(normalized, otp)
  if (expected !== challenge.otp_hash) {
    await execute(
      db,
      'UPDATE owner_login_challenges SET attempts = attempts + 1 WHERE email = ?',
      [normalized]
    )
    const left = OWNER_OTP_MAX_ATTEMPTS - challenge.attempts - 1
    return {
      ok: false,
      error: 'Wrong code',
      hint:
        left > 0
          ? `${String(left)} attempt${left === 1 ? '' : 's'} left`
          : 'Too many wrong codes; request a new one',
    }
  }
  await execute(db, 'DELETE FROM owner_login_challenges WHERE email = ?', [
    normalized,
  ])
  return { ok: true }
}

/** Mint the session the dashboard cookie carries */
export async function signOwnerSession(
  env: Env,
  email: string
): Promise<{ token: string; expiresAt: string } | null> {
  const exp = Math.floor(Date.now() / 1000) + OWNER_SESSION_SECONDS
  const token = await signToken(env, {
    k: OWNER_SESSION_TOKEN_KIND,
    e: email.toLowerCase(),
    exp,
  })
  return token ? { token, expiresAt: new Date(exp * 1000).toISOString() } : null
}
