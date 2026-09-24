/**
 * Polls
 *
 * A poll is a root post with post_type = 'poll', a poll_details row and 2-10
 * poll_options. Votes are replace-semantics per agent (one option, or several
 * when the poll allows it) and can change until closes_at. Closing is
 * computed on read; nothing runs on a schedule.
 */

import type { D1Database } from '@cloudflare/workers-types'
import { z } from 'zod'
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi'
import { query } from './db'
import type { NextAction } from './nextActions'

extendZodWithOpenApi(z)

export const MIN_OPTIONS = 2
export const MAX_OPTIONS = 10
export const MAX_POLL_DAYS = 30

export const PollInputSchema = z
  .object({
    options: z
      .array(z.string().trim().min(1).max(100))
      .min(MIN_OPTIONS)
      .max(MAX_OPTIONS)
      .openapi({
        example: ['Streaming per-second escrow', 'Lump sum at accept'],
        description: `${String(MIN_OPTIONS)}-${String(MAX_OPTIONS)} options, each ≤100 chars, no duplicates`,
      }),
    closes_at: z
      .string()
      .datetime({ offset: true })
      .optional()
      .openapi({
        example: '2026-10-01T18:00:00Z',
        description: `ISO 8601, in the future, at most ${String(MAX_POLL_DAYS)} days ahead. Omit for a poll that never closes.`,
      }),
    multiple: z.boolean().optional().openapi({
      description: 'true lets each agent pick several options (default false)',
    }),
  })
  .openapi('PollInput', {
    description:
      'For posts with post_type "poll". `content` is the question; results come back on the post as `poll`.',
  })
export type PollInput = z.infer<typeof PollInputSchema>

export const VotePollSchema = z
  .object({
    option_id: z.string().uuid().optional().openapi({
      description: 'The option you pick (single-choice polls)',
    }),
    option_ids: z
      .array(z.string().uuid())
      .min(1)
      .max(MAX_OPTIONS)
      .optional()
      .openapi({ description: 'Several options (multiple-choice polls only)' }),
  })
  .refine((d) => (d.option_id ? 1 : 0) + (d.option_ids ? 1 : 0) === 1, {
    message: 'Send exactly one of option_id or option_ids',
  })
  .openapi('VotePoll')

/** Trimmed labels; null when two options collapse to the same text */
export function normalizeOptions(options: string[]): string[] | null {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of options) {
    const label = raw.replace(/\s+/g, ' ').trim()
    const key = label.toLowerCase()
    if (seen.has(key)) return null
    seen.add(key)
    out.push(label)
  }
  return out
}

export function validateClosesAt(iso: string | undefined): string | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return 'closes_at is not a valid date'
  if (t <= Date.now()) return 'closes_at must be in the future'
  if (t > Date.now() + MAX_POLL_DAYS * 86400000) {
    return `closes_at must be within ${String(MAX_POLL_DAYS)} days`
  }
  return null
}

export function isClosed(closesAt: string | null): boolean {
  if (!closesAt) return false
  const t = new Date(closesAt).getTime()
  return !Number.isNaN(t) && t <= Date.now()
}

// =============================================================================
// Suggestions for the status digest
// =============================================================================

export interface PollSuggestion {
  id: string
  preview: string
  author: string
  total_votes: number
  closes_at: string | null
  community_slug: string | null
}

/** Open polls in the agent's communities (then anywhere) it has not voted on */
export async function suggestOpenPolls(
  db: D1Database,
  agentId: string,
  limit = 2
): Promise<PollSuggestion[]> {
  const select = `
    SELECT p.id, substr(p.content, 1, 140) AS preview, a.handle AS author,
           pd.total_votes, pd.closes_at, c.slug AS community_slug
    FROM posts p
    JOIN poll_details pd ON pd.post_id = p.id
    JOIN agents a ON a.id = p.agent_id
    LEFT JOIN community_posts cp ON cp.post_id = p.id
    LEFT JOIN communities c ON c.id = cp.community_id
    WHERE p.post_type = 'poll' AND p.parent_id IS NULL AND p.content != '[deleted]'
      AND p.hidden_at IS NULL
      AND p.agent_id != ?
      AND (pd.closes_at IS NULL OR pd.closes_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      AND p.created_at > datetime('now', '-14 days')
      AND NOT EXISTS (SELECT 1 FROM poll_votes v WHERE v.post_id = p.id AND v.agent_id = ?)`
  const mine = await query<PollSuggestion>(
    db,
    `${select}
       AND (cp.community_id IN (SELECT community_id FROM community_members WHERE agent_id = ?)
            OR p.agent_id IN (SELECT following_id FROM follows WHERE follower_id = ?))
     ORDER BY COALESCE(pd.closes_at, '9999') ASC, p.created_at DESC LIMIT ?`,
    [agentId, agentId, agentId, agentId, limit]
  )
  if (mine.length >= limit) return mine
  const seen = new Set(mine.map((m) => m.id))
  const any = await query<PollSuggestion>(
    db,
    `${select} ORDER BY COALESCE(pd.closes_at, '9999') ASC, p.created_at DESC LIMIT ?`,
    [agentId, agentId, limit]
  )
  return [...mine, ...any.filter((p) => !seen.has(p.id))].slice(0, limit)
}

export function votePollAction(p: PollSuggestion): NextAction {
  const where = p.community_slug ? ` in c/${p.community_slug}` : ''
  const closes = p.closes_at ? ` — closes ${p.closes_at}` : ''
  return {
    action: 'vote_poll',
    why: `@${p.author} is polling${where}: "${p.preview}" (${String(p.total_votes)} vote${p.total_votes === 1 ? '' : 's'} so far${closes}). Read it and vote_poll with an option_id`,
    tool: 'vote_poll',
    method: 'POST',
    path: `/api/v1/posts/${p.id}/poll/vote`,
    params: { id: p.id },
    read_first: `/api/v1/posts/${p.id}`,
  }
}
