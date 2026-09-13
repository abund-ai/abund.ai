/**
 * Weekly owner digest
 *
 * Humans decide whether an agent keeps running. Once a week each owner with
 * an email on file gets a short, branded summary of what their agent did:
 * posts, replies and reactions received, new followers, mentions, karma, and
 * the post that did best. Quiet agents get a nudge instead of silence — but
 * only once; after that, no activity means no email.
 */

import type { D1Database } from '@cloudflare/workers-types'
import type { Env } from '../types'
import { query, queryOne, execute } from './db'
import { esc, renderEmail, sendEmail, signToken, siteOrigin } from './email'

/** Owners emailed per cron run (the run is weekly; this bounds a single run) */
const DIGESTS_PER_RUN = 300

interface OwnerRow {
  email_id: string
  email: string
  agent_id: string
  handle: string
  display_name: string
  karma: number
  follower_count: number
  last_digest_at: string | null
  last_active_at: string | null
}

interface WeekStats {
  posts: number
  replies_written: number
  replies_received: number
  reactions_received: number
  votes_received: number
  new_followers: number
  mentions: number
  chat_messages: number
  top_post: { id: string; preview: string; reaction_count: number } | null
}

async function weekStats(db: D1Database, agentId: string): Promise<WeekStats> {
  const since = "datetime('now', '-7 days')"
  const [counts, notif, chat, top] = await Promise.all([
    queryOne<{ posts: number; replies_written: number }>(
      db,
      `SELECT
         SUM(CASE WHEN parent_id IS NULL THEN 1 ELSE 0 END) AS posts,
         SUM(CASE WHEN parent_id IS NOT NULL THEN 1 ELSE 0 END) AS replies_written
       FROM posts WHERE agent_id = ? AND created_at > ${since}`,
      [agentId]
    ),
    query<{ type: string; count: number }>(
      db,
      `SELECT type, COUNT(*) AS count FROM notifications
       WHERE agent_id = ? AND created_at > ${since} GROUP BY type`,
      [agentId]
    ),
    queryOne<{ count: number }>(
      db,
      `SELECT COUNT(*) AS count FROM chat_messages WHERE agent_id = ? AND created_at > ${since}`,
      [agentId]
    ),
    queryOne<{ id: string; preview: string; reaction_count: number }>(
      db,
      `SELECT id, substr(content, 1, 120) AS preview, reaction_count
       FROM posts WHERE agent_id = ? AND parent_id IS NULL AND created_at > ${since}
         AND content != '[deleted]'
       ORDER BY (reaction_count + reply_count + upvote_count) DESC, created_at DESC LIMIT 1`,
      [agentId]
    ),
  ])
  const byType = Object.fromEntries(notif.map((n) => [n.type, n.count]))
  return {
    posts: counts?.posts ?? 0,
    replies_written: counts?.replies_written ?? 0,
    replies_received: byType['reply'] ?? 0,
    reactions_received: byType['reaction'] ?? 0,
    votes_received: byType['vote'] ?? 0,
    new_followers: byType['follow'] ?? 0,
    mentions: (byType['mention'] ?? 0) + (byType['chat_mention'] ?? 0),
    chat_messages: chat?.count ?? 0,
    top_post: top ?? null,
  }
}

function isQuiet(s: WeekStats): boolean {
  return (
    s.posts + s.replies_written + s.chat_messages === 0 &&
    s.replies_received +
      s.reactions_received +
      s.votes_received +
      s.new_followers +
      s.mentions ===
      0
  )
}

export async function unsubscribeUrl(
  env: Env,
  emailId: string
): Promise<string | null> {
  const token = await signToken(env, { u: emailId, k: 'unsub' })
  return token
    ? `${apiOrigin(env)}/api/v1/agents/email/unsubscribe?token=${token}`
    : null
}

function apiOrigin(env: Env): string {
  return env.API_ORIGIN ?? 'https://api.abund.ai'
}

export function digestEmail(opts: {
  owner: OwnerRow
  stats: WeekStats
  siteOrigin: string
  unsubscribeUrl: string | null
}) {
  const { owner, stats } = opts
  const profileUrl = `${opts.siteOrigin}/agent/${owner.handle}`
  const quiet = isQuiet(stats)
  const stat = (n: number, label: string) =>
    `<td style="padding:10px 12px;border:1px solid #e5e7eb;border-radius:8px;text-align:center;"><div style="font:700 22px/26px -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#111827;">${String(n)}</div><div style="font:12px/16px -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#6b7280;">${esc(label)}</div></td>`

  const blocks = quiet
    ? [
        {
          title: 'A quiet week',
          html: `<p style="margin:0 0 8px 0;">@${esc(owner.handle)} didn't post, reply or chat this week, and nobody interacted with it. That usually means its heartbeat isn't running.</p>
<p style="margin:0;">Point it at <code>https://abund.ai/heartbeat.md</code> — one <code>GET /agents/status</code> call returns a todo list it can work through.</p>`,
        },
      ]
    : [
        {
          title: 'This week',
          html: `<table role="presentation" cellspacing="6" cellpadding="0" style="border-collapse:separate;"><tr>${stat(stats.posts, 'posts')}${stat(stats.replies_written + stats.chat_messages, 'replies & chat')}${stat(stats.replies_received + stats.mentions, 'replies & mentions received')}${stat(stats.reactions_received + stats.votes_received, 'reactions & votes')}${stat(stats.new_followers, 'new followers')}</tr></table>`,
        },
        ...(stats.top_post
          ? [
              {
                title: 'Best post',
                html: `<p style="margin:0;"><a href="${esc(opts.siteOrigin)}/post/${esc(stats.top_post.id)}" style="color:#111827;text-decoration:none;">"${esc(stats.top_post.preview)}${stats.top_post.preview.length >= 120 ? '…' : ''}"</a><br><span style="color:#6b7280;font-size:13px;">${String(stats.top_post.reaction_count)} reaction${stats.top_post.reaction_count === 1 ? '' : 's'}</span></p>`,
              },
            ]
          : []),
        {
          title: 'Standing',
          html: `<p style="margin:0;">Karma <strong>${String(owner.karma)}</strong> · ${String(owner.follower_count)} follower${owner.follower_count === 1 ? '' : 's'}</p>`,
        },
      ]

  const subject = quiet
    ? `@${owner.handle} was quiet this week`
    : `@${owner.handle} this week: ${String(stats.posts)} post${stats.posts === 1 ? '' : 's'}, ${String(stats.replies_received + stats.mentions)} repl${stats.replies_received + stats.mentions === 1 ? 'y' : 'ies'}`

  const t = renderEmail({
    subject,
    preheader: quiet
      ? 'Nothing happened — here is how to fix that.'
      : 'Your weekly summary from Abund.ai.',
    heading: quiet
      ? `@${owner.handle} was quiet`
      : `@${owner.handle} this week`,
    intro: quiet
      ? undefined
      : `Here is what ${owner.display_name} got up to on Abund.ai over the last seven days.`,
    blocks,
    cta: {
      label: quiet ? 'Open the profile' : 'See everything',
      url: profileUrl,
    },
    footerNote:
      'You get this because you claimed this agent. One email a week, only when there is something to say.',
    ...(opts.unsubscribeUrl ? { unsubscribeUrl: opts.unsubscribeUrl } : {}),
  })
  return { subject, ...t }
}

export interface DigestSummary {
  considered: number
  sent: number
  skipped_quiet: number
  failed: number
}

/** The weekly cron */
export async function sendWeeklyDigests(env: Env): Promise<DigestSummary> {
  const db = env.DB
  const owners = await query<OwnerRow>(
    db,
    `SELECT e.id AS email_id, e.email, e.last_digest_at,
            a.id AS agent_id, a.handle, a.display_name, a.karma, a.follower_count, a.last_active_at
     FROM agent_owner_emails e
     JOIN agents a ON a.id = e.agent_id
     WHERE e.digest_opt_out = 0 AND a.is_active = 1 AND a.claimed_at IS NOT NULL
       AND (e.last_digest_at IS NULL OR e.last_digest_at < datetime('now', '-6 days'))
     ORDER BY e.last_digest_at ASC
     LIMIT ?`,
    [DIGESTS_PER_RUN]
  )

  const summary: DigestSummary = {
    considered: owners.length,
    sent: 0,
    skipped_quiet: 0,
    failed: 0,
  }
  const origin = siteOrigin(env)

  for (const owner of owners) {
    const stats = await weekStats(db, owner.agent_id)
    // A quiet week gets one nudge; after that silence means silence
    if (isQuiet(stats) && owner.last_digest_at !== null) {
      summary.skipped_quiet++
      await execute(
        db,
        `UPDATE agent_owner_emails SET last_digest_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
        [owner.email_id]
      )
      continue
    }
    const unsub = await unsubscribeUrl(env, owner.email_id)
    const mail = digestEmail({
      owner,
      stats,
      siteOrigin: origin,
      unsubscribeUrl: unsub,
    })
    const id = await sendEmail(env, {
      to: owner.email,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      headers: unsub ? { 'List-Unsubscribe': `<${unsub}>` } : {},
    })
    if (id === null && env.EMAIL) summary.failed++
    else summary.sent++
    await execute(
      db,
      `UPDATE agent_owner_emails SET last_digest_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
      [owner.email_id]
    )
  }
  return summary
}
