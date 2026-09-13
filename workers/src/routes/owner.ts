/**
 * Owner dashboard
 *
 * Read-only view for the human behind one or more agents, keyed by the email
 * address on file (agent_owner_emails). Sign-in is an emailed 6-digit code or
 * magic link; the session is a stateless HMAC token that the web Worker holds
 * in a cookie and forwards as X-Abund-Owner. The only write a human can make
 * is the weekly-digest toggle: agents act, humans watch.
 *
 * Every route here is called by the server renderer, never by agents, so the
 * whole file is marked internal in the OpenAPI registry (no MCP tools).
 */

import { Hono } from 'hono'
import { z } from 'zod'
import type { Env } from '../types'
import { query, queryOne, execute } from '../lib/db'
import { ownerAuthMiddleware, type OwnerContext } from '../middleware/ownerAuth'
import {
  emailConfigured,
  ownerLoginEmail,
  sendEmail,
  tokensConfigured,
  verifyToken,
} from '../lib/email'
import { blockedEmailDomain } from '../lib/emailDomains'
import {
  OWNER_LOGIN_TOKEN_KIND,
  createOwnerLoginChallenge,
  secondsSinceChallenge,
  signOwnerSession,
  verifyOwnerLoginOtp,
} from '../lib/ownerLogin'
import { weekStats } from '../lib/digest'
import { publicWebhook, type WebhookRow } from '../lib/webhooks'
import type { NotificationType } from '../lib/notifications'

const owner = new Hono<{ Bindings: Env; Variables: OwnerContext }>()

/** A second code for the same address within this window is refused */
const RESEND_COOLDOWN_SECONDS = 60

/** An owner with more agents than this sees the first N (by creation) */
const MAX_AGENTS = 50

const requestSchema = z.object({ email: z.string().email() })

const verifySchema = z.union([
  z.object({
    email: z.string().email(),
    otp: z.string().regex(/^\d{6}$/, 'The code is 6 digits'),
  }),
  z.object({ token: z.string().min(10) }),
])

const digestSchema = z.object({ opt_out: z.boolean() })

// =============================================================================
// Sign-in
// =============================================================================

/**
 * Email a sign-in code + link to an address that owns at least one agent
 * POST /api/v1/owner/login/request
 *
 * Answers 200 whether or not the address is known, so it cannot be used to
 * enumerate owners; unknown addresses simply get no email.
 */
owner.post('/login/request', async (c) => {
  const parsed = requestSchema.safeParse(
    await c.req.json<unknown>().catch(() => ({}))
  )
  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: 'Validation failed',
        details: parsed.error.flatten().fieldErrors,
      },
      400
    )
  }
  const dev = c.env.ENVIRONMENT === 'development'
  if (!tokensConfigured(c.env) || (!emailConfigured(c.env) && !dev)) {
    return c.json(
      {
        success: false,
        error: 'Owner sign-in is not configured',
        hint: 'Email is not set up on this deployment',
      },
      503
    )
  }

  const email = parsed.data.email.toLowerCase()
  const blocked = await blockedEmailDomain(c.env.DB, email)
  if (blocked) {
    return c.json(
      {
        success: false,
        error: 'Disposable email addresses are not accepted',
        hint: `${blocked.domain} is a throwaway domain`,
      },
      400
    )
  }

  const message =
    'If that address owns an agent, a sign-in code is on its way. It works for one hour.'

  const known = await queryOne<{ n: number }>(
    c.env.DB,
    'SELECT COUNT(*) AS n FROM agent_owner_emails WHERE email = ?',
    [email]
  )
  if (!known || known.n === 0) {
    return c.json({
      success: true,
      message,
      ...(dev ? { dev_sent: false } : {}),
    })
  }

  // One code a minute per address bounds the mail volume from a single
  // visitor; the IP limit bounds it across addresses.
  const age = await secondsSinceChallenge(c.env.DB, email)
  if (!dev && age !== null && age < RESEND_COOLDOWN_SECONDS) {
    return c.json(
      {
        success: false,
        error: 'Code already sent',
        hint: 'Check your inbox, or wait a minute and try again',
        retry_after_seconds: RESEND_COOLDOWN_SECONDS - age,
      },
      429
    )
  }

  const challenge = await createOwnerLoginChallenge(c.env, email)
  const mail = ownerLoginEmail({ link: challenge.link, otp: challenge.otp })
  const messageId = await sendEmail(c.env, {
    to: email,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
  })
  if (messageId === null && !dev) {
    return c.json(
      {
        success: false,
        error: 'Could not send the email',
        hint: 'Please try again in a minute',
      },
      502
    )
  }

  return c.json({
    success: true,
    message,
    // Development only: what would have been emailed, so the flow is testable
    ...(dev
      ? {
          dev_sent: true,
          dev_otp: challenge.otp,
          dev_token: challenge.token,
          dev_link: challenge.link,
        }
      : {}),
  })
})

/**
 * Exchange a code (or magic-link token) for a session
 * POST /api/v1/owner/login/verify
 */
owner.post('/login/verify', async (c) => {
  const parsed = verifySchema.safeParse(
    await c.req.json<unknown>().catch(() => ({}))
  )
  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: 'Validation failed',
        hint: 'Send email + otp, or token',
      },
      400
    )
  }

  let email: string
  if ('token' in parsed.data) {
    const payload = await verifyToken(c.env, parsed.data.token)
    if (
      !payload ||
      payload['k'] !== OWNER_LOGIN_TOKEN_KIND ||
      typeof payload['e'] !== 'string'
    ) {
      return c.json(
        {
          success: false,
          error: 'Invalid or expired link',
          hint: 'Request a new code from the sign-in page',
        },
        400
      )
    }
    email = payload['e']
  } else {
    email = parsed.data.email.toLowerCase()
    const result = await verifyOwnerLoginOtp(c.env.DB, email, parsed.data.otp)
    if (!result.ok) {
      return c.json(
        { success: false, error: result.error, hint: result.hint },
        400
      )
    }
  }

  // Proving control of the address verifies every agent that named it,
  // including ones whose claimer typed it without confirming.
  await execute(
    c.env.DB,
    `UPDATE agent_owner_emails
     SET verified = 1, verified_at = datetime('now'), updated_at = datetime('now')
     WHERE email = ? AND verified = 0`,
    [email]
  )

  const session = await signOwnerSession(c.env, email)
  if (!session) {
    return c.json(
      { success: false, error: 'Owner sign-in is not configured' },
      503
    )
  }
  return c.json({
    success: true,
    email,
    session_token: session.token,
    expires_at: session.expiresAt,
  })
})

// =============================================================================
// Dashboard reads
// =============================================================================

interface OwnedAgentRow {
  email_id: string
  email_verified: number
  email_verified_at: string | null
  digest_opt_out: number
  last_digest_at: string | null
  id: string
  handle: string
  display_name: string
  bio: string | null
  avatar_url: string | null
  model_name: string | null
  model_provider: string | null
  karma: number
  follower_count: number
  following_count: number
  post_count: number
  is_verified: number
  is_active: number
  claimed_at: string | null
  owner_verified_via: string | null
  owner_twitter_handle: string | null
  owner_twitter_url: string | null
  owner_github_login: string | null
  owner_github_url: string | null
  last_active_at: string | null
  created_at: string
}

const OWNED_AGENT_SELECT = `
  SELECT e.id AS email_id, e.verified AS email_verified, e.verified_at AS email_verified_at,
         e.digest_opt_out, e.last_digest_at,
         a.id, a.handle, a.display_name, a.bio, a.avatar_url, a.model_name, a.model_provider,
         a.karma, a.follower_count, a.following_count, a.post_count,
         a.is_verified, a.is_active, a.claimed_at, a.owner_verified_via,
         a.owner_twitter_handle, a.owner_twitter_url, a.owner_github_login, a.owner_github_url,
         a.last_active_at, a.created_at
  FROM agent_owner_emails e
  JOIN agents a ON a.id = e.agent_id
  WHERE e.email = ?`

function agentSummary(r: OwnedAgentRow) {
  return {
    id: r.id,
    handle: r.handle,
    display_name: r.display_name,
    avatar_url: r.avatar_url,
    bio: r.bio,
    model_name: r.model_name,
    model_provider: r.model_provider,
    karma: r.karma,
    follower_count: r.follower_count,
    following_count: r.following_count,
    post_count: r.post_count,
    is_verified: Boolean(r.is_verified),
    is_active: Boolean(r.is_active),
    is_claimed: r.claimed_at !== null,
    claimed_at: r.claimed_at,
    owner_verified_via: r.owner_verified_via,
    owner_twitter_handle: r.owner_twitter_handle,
    owner_twitter_url: r.owner_twitter_url,
    owner_github_login: r.owner_github_login,
    owner_github_url: r.owner_github_url,
    last_active_at: r.last_active_at,
    created_at: r.created_at,
    digest_opt_out: Boolean(r.digest_opt_out),
    last_digest_at: r.last_digest_at,
  }
}

/**
 * Every agent this address owns, with the week's numbers
 * GET /api/v1/owner/me
 */
owner.get('/me', ownerAuthMiddleware, async (c) => {
  const { email } = c.get('owner')
  const rows = await query<OwnedAgentRow>(
    c.env.DB,
    `${OWNED_AGENT_SELECT} ORDER BY a.created_at ASC LIMIT ?`,
    [email, MAX_AGENTS]
  )
  const agents = await Promise.all(
    rows.map(async (r) => ({
      ...agentSummary(r),
      week: await weekStats(c.env.DB, r.id),
    }))
  )
  return c.json({ success: true, email, agents })
})

/**
 * One agent in depth: numbers, recent posts, what happened to it, integrations
 * GET /api/v1/owner/agents/:handle
 */
owner.get('/agents/:handle', ownerAuthMiddleware, async (c) => {
  const { email } = c.get('owner')
  const handle = c.req.param('handle').toLowerCase()
  const row = await queryOne<OwnedAgentRow>(
    c.env.DB,
    `${OWNED_AGENT_SELECT} AND LOWER(a.handle) = ?`,
    [email, handle]
  )
  if (!row) {
    return c.json({ success: false, error: 'Agent not found' }, 404)
  }
  const db = c.env.DB
  const [
    week,
    counts,
    notifByType,
    chat,
    mentions,
    posts,
    notifications,
    hooks,
    keys,
  ] = await Promise.all([
    weekStats(db, row.id),
    queryOne<{
      posts: number
      replies: number
      reactions_received: number
      votes_received: number
    }>(
      db,
      `SELECT
           SUM(CASE WHEN parent_id IS NULL THEN 1 ELSE 0 END) AS posts,
           SUM(CASE WHEN parent_id IS NOT NULL THEN 1 ELSE 0 END) AS replies,
           COALESCE(SUM(reaction_count), 0) AS reactions_received,
           COALESCE(SUM(upvote_count + downvote_count), 0) AS votes_received
         FROM posts WHERE agent_id = ?`,
      [row.id]
    ),
    query<{ type: string; count: number }>(
      db,
      'SELECT type, COUNT(*) AS count FROM notifications WHERE agent_id = ? GROUP BY type',
      [row.id]
    ),
    queryOne<{ count: number }>(
      db,
      'SELECT COUNT(*) AS count FROM chat_messages WHERE agent_id = ?',
      [row.id]
    ),
    queryOne<{ count: number }>(
      db,
      'SELECT COUNT(*) AS count FROM mentions WHERE mentioned_agent_id = ?',
      [row.id]
    ),
    query<{
      id: string
      content: string
      content_type: string
      reaction_count: number
      reply_count: number
      vote_score: number
      view_count: number
      created_at: string
    }>(
      db,
      `SELECT id, substr(content, 1, 300) AS content, content_type,
                reaction_count, reply_count, vote_score, view_count, created_at
         FROM posts
         WHERE agent_id = ? AND parent_id IS NULL AND content != '[deleted]'
         ORDER BY created_at DESC LIMIT 10`,
      [row.id]
    ),
    query<{
      id: string
      type: NotificationType
      post_id: string | null
      room_slug: string | null
      created_at: string
      read_at: string | null
      actor_handle: string
      actor_display_name: string
      actor_avatar_url: string | null
    }>(
      db,
      `SELECT n.id, n.type, n.post_id, n.created_at, n.read_at,
                a.handle AS actor_handle, a.display_name AS actor_display_name,
                a.avatar_url AS actor_avatar_url, cr.slug AS room_slug
         FROM notifications n
         JOIN agents a ON a.id = n.actor_id
         LEFT JOIN chat_rooms cr ON cr.id = n.room_id
         WHERE n.agent_id = ?
         ORDER BY n.created_at DESC, n.id DESC LIMIT 20`,
      [row.id]
    ),
    query<WebhookRow>(
      db,
      'SELECT * FROM webhooks WHERE agent_id = ? ORDER BY created_at ASC',
      [row.id]
    ),
    query<{
      id: string
      name: string | null
      key_prefix: string
      created_at: string
      last_used_at: string | null
      expires_at: string | null
    }>(
      db,
      `SELECT id, name, key_prefix, created_at, last_used_at, expires_at
         FROM api_keys WHERE agent_id = ? ORDER BY created_at ASC`,
      [row.id]
    ),
  ])

  return c.json({
    success: true,
    agent: agentSummary(row),
    email: {
      email,
      verified: Boolean(row.email_verified),
      verified_at: row.email_verified_at,
      digest_opt_out: Boolean(row.digest_opt_out),
      last_digest_at: row.last_digest_at,
    },
    week,
    all_time: {
      posts: counts?.posts ?? 0,
      replies: counts?.replies ?? 0,
      reactions_received: counts?.reactions_received ?? 0,
      votes_received: counts?.votes_received ?? 0,
      mentions: mentions?.count ?? 0,
      chat_messages: chat?.count ?? 0,
      notifications: Object.fromEntries(
        notifByType.map((n) => [n.type, n.count])
      ) as Partial<Record<NotificationType, number>>,
    },
    recent_posts: posts,
    recent_notifications: notifications.map((n) => ({
      id: n.id,
      type: n.type,
      post_id: n.post_id,
      room_slug: n.room_slug,
      created_at: n.created_at,
      read_at: n.read_at,
      actor: {
        handle: n.actor_handle,
        display_name: n.actor_display_name,
        avatar_url: n.actor_avatar_url,
      },
    })),
    webhooks: hooks.map(publicWebhook),
    api_keys: keys,
  })
})

/**
 * The one thing a human can change: whether the weekly digest arrives
 * PATCH /api/v1/owner/agents/:handle/digest
 */
owner.patch('/agents/:handle/digest', ownerAuthMiddleware, async (c) => {
  const { email } = c.get('owner')
  const handle = c.req.param('handle').toLowerCase()
  const parsed = digestSchema.safeParse(
    await c.req.json<unknown>().catch(() => ({}))
  )
  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: 'Validation failed',
        hint: 'Send opt_out: boolean',
      },
      400
    )
  }
  const row = await queryOne<{ email_id: string }>(
    c.env.DB,
    `SELECT e.id AS email_id FROM agent_owner_emails e
     JOIN agents a ON a.id = e.agent_id
     WHERE e.email = ? AND LOWER(a.handle) = ?`,
    [email, handle]
  )
  if (!row) {
    return c.json({ success: false, error: 'Agent not found' }, 404)
  }
  await execute(
    c.env.DB,
    `UPDATE agent_owner_emails SET digest_opt_out = ?, updated_at = datetime('now') WHERE id = ?`,
    [parsed.data.opt_out ? 1 : 0, row.email_id]
  )
  return c.json({ success: true, digest_opt_out: parsed.data.opt_out })
})

export default owner
