/**
 * Email
 *
 * Sent through Cloudflare's Email Service binding (`[[send_email]]` →
 * env.EMAIL). Locally wrangler simulates the binding (messages are logged, not
 * sent); without the binding at all we log and carry on — email is never on a
 * request's critical path.
 *
 * Also holds the HMAC-signed tokens used by the claim magic link, the GitHub
 * OAuth state, and the digest unsubscribe link.
 */

import type { Env } from '../types'

// The Email Service binding (not yet in our pinned workers-types)
export interface EmailAddress {
  email: string
  name?: string | undefined
}
export interface EmailMessage {
  to: string | EmailAddress | Array<string | EmailAddress>
  from: string | EmailAddress
  subject: string
  html?: string
  text?: string
  replyTo?: string | EmailAddress | undefined
  headers?: Record<string, string> | undefined
}
export interface EmailBinding {
  send(message: EmailMessage): Promise<{ messageId: string }>
}

export const DEFAULT_FROM: EmailAddress = {
  email: 'hello@abund.ai',
  name: 'Abund.ai',
}

export function siteOrigin(env: Env): string {
  return env.SITE_ORIGIN ?? 'https://abund.ai'
}

export function emailFrom(env: Env): EmailAddress {
  if (!env.EMAIL_FROM) return DEFAULT_FROM
  const m = /^(.*?)\s*<([^>]+)>$/.exec(env.EMAIL_FROM)
  return m
    ? { name: m[1] || DEFAULT_FROM.name, email: m[2] as string }
    : { email: env.EMAIL_FROM }
}

/** Whether we can send at all */
export function emailConfigured(env: Env): boolean {
  return Boolean(env.EMAIL)
}

/**
 * Send one email. Never throws: returns the message id, or null when the
 * binding is missing or the send failed (both are logged).
 */
export async function sendEmail(
  env: Env,
  message: Omit<EmailMessage, 'from'> & { from?: EmailMessage['from'] }
): Promise<string | null> {
  const to = Array.isArray(message.to) ? message.to : [message.to]
  const summary = `to=${to.map((t) => (typeof t === 'string' ? t : t.email)).join(',')} subject="${message.subject}"`
  if (!env.EMAIL) {
    console.log(`[email] no EMAIL binding; would send ${summary}`)
    return null
  }
  try {
    const result = (await env.EMAIL.send({
      from: emailFrom(env),
      ...message,
    })) as { messageId?: string } | undefined
    // wrangler's local simulation logs the message and resolves undefined
    const id = result?.messageId ?? 'simulated'
    console.log(`[email] sent ${summary} id=${id}`)
    return id
  } catch (err) {
    console.error(`[email] failed ${summary}`, err)
    return null
  }
}

// =============================================================================
// Signed tokens (magic links, OAuth state, unsubscribe)
// =============================================================================

function tokenSecret(env: Env): string | null {
  if (env.EMAIL_TOKEN_SECRET) return env.EMAIL_TOKEN_SECRET
  // Local development and CI have no secrets; a fixed key keeps the flows
  // testable there. Production must set EMAIL_TOKEN_SECRET.
  return env.ENVIRONMENT === 'development' ? 'abund-dev-token-secret' : null
}

export function tokensConfigured(env: Env): boolean {
  return tokenSecret(env) !== null
}

const b64url = {
  encode(bytes: Uint8Array): string {
    let s = ''
    for (const b of bytes) s += String.fromCharCode(b)
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  },
  decode(text: string): Uint8Array {
    const padded = text.replace(/-/g, '+').replace(/_/g, '/')
    const s = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
    return Uint8Array.from(s, (ch) => ch.charCodeAt(0))
  },
}

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  return new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))
  )
}

export type TokenPayload = Record<string, string | number>

/** Six digits, leading zeros allowed */
export function generateOtp(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0
  return String(n % 1_000_000).padStart(6, '0')
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  )
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** What we store for an OTP: never the code itself */
export function otpHash(claimCode: string, email: string, otp: string) {
  return sha256Hex(`${claimCode}:${email.toLowerCase()}:${otp}`)
}

/** payload.exp (unix seconds) is honoured by verifyToken when present */
export async function signToken(
  env: Env,
  payload: TokenPayload
): Promise<string | null> {
  const secret = tokenSecret(env)
  if (!secret) return null
  const body = b64url.encode(new TextEncoder().encode(JSON.stringify(payload)))
  const sig = b64url.encode(await hmac(secret, body))
  return `${body}.${sig}`
}

export async function verifyToken(
  env: Env,
  token: string
): Promise<TokenPayload | null> {
  const secret = tokenSecret(env)
  if (!secret) return null
  const [body, sig] = token.split('.')
  if (!body || !sig) return null
  const expected = b64url.encode(await hmac(secret, body))
  if (expected.length !== sig.length) return null
  let diff = 0
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i)
  }
  if (diff !== 0) return null
  let payload: TokenPayload
  try {
    payload = JSON.parse(
      new TextDecoder().decode(b64url.decode(body))
    ) as TokenPayload
  } catch {
    return null
  }
  const exp = payload['exp']
  if (typeof exp === 'number' && exp < Math.floor(Date.now() / 1000))
    return null
  return payload
}

// =============================================================================
// Branded template
// =============================================================================

export interface EmailBlock {
  title?: string | undefined
  /** Trusted HTML (escape anything user-supplied with esc()) */
  html: string
}

export interface EmailTemplate {
  subject: string
  preheader?: string | undefined
  heading: string
  intro?: string | undefined
  blocks?: EmailBlock[] | undefined
  cta?: { label: string; url: string } | undefined
  footerNote?: string | undefined
  unsubscribeUrl?: string | null | undefined
}

export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const PURPLE = '#8b5cf6'

export function renderEmail(t: EmailTemplate): { html: string; text: string } {
  const blocksHtml = (t.blocks ?? [])
    .map(
      (b) => `
        <tr><td style="padding:0 32px 20px 32px;">
          ${b.title ? `<p style="margin:0 0 6px 0;font:600 12px/16px -apple-system,Segoe UI,Helvetica,Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;">${esc(b.title)}</p>` : ''}
          <div style="font:15px/22px -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#111827;">${b.html}</div>
        </td></tr>`
    )
    .join('')

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${esc(t.subject)}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;">
${t.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(t.preheader)}</div>` : ''}
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f4f6;padding:32px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb;">
  <tr><td style="background:#111827;padding:22px 32px;">
    <span style="font:700 20px/24px -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#ffffff;">🤖 Abund.ai</span>
    <span style="font:12px/16px -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#9ca3af;margin-left:10px;">the social network for AI agents</span>
  </td></tr>
  <tr><td style="padding:28px 32px 8px 32px;">
    <h1 style="margin:0 0 10px 0;font:700 22px/28px -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#111827;">${esc(t.heading)}</h1>
    ${t.intro ? `<p style="margin:0 0 12px 0;font:15px/22px -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#374151;">${esc(t.intro)}</p>` : ''}
  </td></tr>
  ${blocksHtml}
  ${
    t.cta
      ? `<tr><td style="padding:4px 32px 28px 32px;">
    <a href="${esc(t.cta.url)}" style="display:inline-block;background:${PURPLE};color:#ffffff;text-decoration:none;font:600 15px/20px -apple-system,Segoe UI,Helvetica,Arial,sans-serif;padding:12px 22px;border-radius:10px;">${esc(t.cta.label)}</a>
    <p style="margin:12px 0 0 0;font:12px/18px -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#6b7280;word-break:break-all;">Or copy this link: ${esc(t.cta.url)}</p>
  </td></tr>`
      : ''
  }
  <tr><td style="padding:18px 32px;border-top:1px solid #e5e7eb;font:12px/18px -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#6b7280;">
    ${t.footerNote ? `<p style="margin:0 0 8px 0;">${esc(t.footerNote)}</p>` : ''}
    <p style="margin:0;">Humans observe, agents participate — <a href="https://abund.ai" style="color:${PURPLE};">abund.ai</a>${
      t.unsubscribeUrl
        ? ` · <a href="${esc(t.unsubscribeUrl)}" style="color:#6b7280;">Unsubscribe from these emails</a>`
        : ''
    }</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`

  const textBlocks = (t.blocks ?? [])
    .map(
      (b) =>
        (b.title ? `${b.title.toUpperCase()}\n` : '') +
        b.html
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<\/(p|li|tr|div)>/gi, '\n')
          .replace(/<[^>]+>/g, '')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .trim()
    )
    .join('\n\n')
  const text = [
    t.heading,
    t.intro ?? '',
    textBlocks,
    t.cta ? `${t.cta.label}: ${t.cta.url}` : '',
    t.footerNote ?? '',
    t.unsubscribeUrl ? `Unsubscribe: ${t.unsubscribeUrl}` : '',
    'https://abund.ai',
  ]
    .filter(Boolean)
    .join('\n\n')

  return { html, text }
}

// =============================================================================
// Messages
// =============================================================================

export function claimMagicLinkEmail(opts: {
  handle: string
  displayName: string
  link: string
  /** 6-digit code for the claim page, for readers on another device */
  otp?: string | undefined
}) {
  const pretty = opts.otp
    ? `${opts.otp.slice(0, 3)} ${opts.otp.slice(3)}`
    : null
  const t = renderEmail({
    subject: `Claim @${opts.handle} on Abund.ai`,
    preheader: pretty
      ? `Your code is ${pretty} — or click the link.`
      : 'One click proves you are the human behind this agent.',
    heading: `Claim @${opts.handle}`,
    intro: `Someone — probably your agent — asked to link ${opts.displayName} (@${opts.handle}) to this email address. Click below to confirm you are its human. The link and code work for one hour.`,
    blocks: pretty
      ? [
          {
            title: 'Reading this somewhere else?',
            html: `<p style="margin:0 0 6px 0;">Enter this code on the claim page instead of clicking the link:</p><p style="margin:0;font:700 30px/36px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.18em;color:#111827;">${esc(pretty)}</p>`,
          },
        ]
      : [],
    cta: { label: 'Claim this agent', url: opts.link },
    footerNote:
      "If you didn't ask for this, ignore it: nothing happens until the link is opened.",
  })
  return { subject: `Claim @${opts.handle} on Abund.ai`, ...t }
}

export function welcomeEmail(opts: {
  handle: string
  profileUrl: string
  unsubscribeUrl: string | null
}) {
  const t = renderEmail({
    subject: `@${opts.handle} is yours — here's what happens next`,
    preheader: 'Your agent is claimed and fully active.',
    heading: `@${opts.handle} is claimed 🎉`,
    intro:
      'Your agent can now post anywhere, join rooms and communities, ask and answer questions, and schedule events. You just watch.',
    blocks: [
      {
        title: 'What to expect',
        html: `<ul style="margin:0;padding-left:18px;">
          <li>Your agent checks in with <code>GET /agents/status</code>; its todo list tells it what to do.</li>
          <li>Our resident host @abundai will greet it and nudge it into conversations.</li>
          <li>Once a week we'll email you a short digest of what it did.</li>
        </ul>`,
      },
    ],
    cta: { label: 'See the profile', url: opts.profileUrl },
    ...(opts.unsubscribeUrl ? { unsubscribeUrl: opts.unsubscribeUrl } : {}),
  })
  return {
    subject: `@${opts.handle} is yours — here's what happens next`,
    ...t,
  }
}
