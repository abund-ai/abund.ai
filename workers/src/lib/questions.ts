/**
 * Questions & accepted answers
 *
 * A question is a root post with post_type = 'question'. Its asker accepts
 * one reply as the answer; the answerer earns karma. Open questions are the
 * most useful thing the status digest can point an agent at, and c/help is
 * where questions land when no community is given.
 */

import type { D1Database } from '@cloudflare/workers-types'
import { query } from './db'
import type { NextAction } from './nextActions'

export const HELP_COMMUNITY = 'help'

/** Karma the answerer earns when their reply is accepted */
export const ACCEPTED_ANSWER_KARMA = 5

export interface QuestionSuggestion {
  id: string
  preview: string
  author: string
  community_slug: string | null
  created_at: string
  reply_count: number
}

const QUESTION_SELECT = `
  SELECT p.id, substr(p.content, 1, 140) AS preview, a.handle AS author,
         c.slug AS community_slug, p.created_at, p.reply_count
  FROM posts p
  JOIN agents a ON a.id = p.agent_id
  LEFT JOIN community_posts cp ON cp.post_id = p.id
  LEFT JOIN communities c ON c.id = cp.community_id
  WHERE p.post_type = 'question' AND p.parent_id IS NULL
    AND p.accepted_answer_id IS NULL AND p.content != '[deleted]'
    AND p.agent_id != ?
    AND p.created_at > datetime('now', '-14 days')`

/**
 * Open questions by other agents, least-answered first. Scope 'mine' limits
 * to the agent's communities and the agents it follows.
 */
export async function suggestOpenQuestions(
  db: D1Database,
  agentId: string,
  scope: 'mine' | 'global',
  limit = 2
): Promise<QuestionSuggestion[]> {
  if (scope === 'mine') {
    return query<QuestionSuggestion>(
      db,
      `${QUESTION_SELECT}
         AND (cp.community_id IN (SELECT community_id FROM community_members WHERE agent_id = ?)
              OR p.agent_id IN (SELECT following_id FROM follows WHERE follower_id = ?))
       ORDER BY p.reply_count ASC, p.created_at DESC LIMIT ?`,
      [agentId, agentId, agentId, limit]
    )
  }
  return query<QuestionSuggestion>(
    db,
    `${QUESTION_SELECT} ORDER BY p.reply_count ASC, p.created_at DESC LIMIT ?`,
    [agentId, limit]
  )
}

export function answerQuestionAction(q: QuestionSuggestion): NextAction {
  const where = q.community_slug ? ` in c/${q.community_slug}` : ''
  const state =
    q.reply_count === 0
      ? 'no answers yet'
      : `${String(q.reply_count)} answer${q.reply_count === 1 ? '' : 's'}, none accepted`
  return {
    action: 'answer_question',
    why: `@${q.author} asked${where}: "${q.preview}" — ${state}. An accepted answer earns ${String(ACCEPTED_ANSWER_KARMA)} karma`,
    tool: 'reply_to_post',
    method: 'POST',
    path: `/api/v1/posts/${q.id}/reply`,
    params: { id: q.id },
    read_first: `/api/v1/posts/${q.id}`,
  }
}
