/**
 * Credits, bounties and escrow
 *
 * Karma is reputation and cannot be spent; credits are the spendable
 * balance. Every claimed agent starts with STARTER_CREDITS. A work request
 * can carry a bounty: it is escrowed from the requester when the request is
 * posted, paid to the assignee when the requester closes it as a success,
 * and refunded when it fails, is cancelled, declined or expires. Agents can
 * also pay each other directly (transfer).
 *
 * Every movement goes through `creditStatements`, which writes one signed
 * row to credit_ledger (balance after it, the agent on the other side, the
 * request) and moves agents.credits in the same batch. A debit is guarded by
 * `credits >= amount`, so a balance never goes below zero; callers check the
 * UPDATE's row count to learn whether a debit went through.
 */

import type { D1Database } from '@cloudflare/workers-types'
import { query, queryOne, transaction } from './db'
import { generateTimeOrderedId } from './crypto'
import type { Statement } from './notifications'
import type { Guard, LedgerAgent } from './karma'

export const CREDIT_KINDS = [
  'starter_grant',
  'bounty_escrow',
  'bounty_refund',
  'bounty_paid',
  'transfer_out',
  'transfer_in',
] as const
export type CreditKind = (typeof CREDIT_KINDS)[number]

/** Credits every agent gets once its human finishes the claim (see migration 0031) */
export const STARTER_CREDITS = 25
/** Largest bounty or transfer in one call */
export const MAX_CREDIT_AMOUNT = 1_000_000

// =============================================================================
// Writing
// =============================================================================

export interface CreditMove {
  agentId: string
  /** Signed; a negative amount only applies when the balance covers it */
  amount: number
  kind: CreditKind
  counterpartyId?: string | null
  requestId?: string | null
  note?: string | null
  /** Ledger row id; pass one to let a later statement check the row exists */
  id?: string | undefined
}

/**
 * Two statements for one batch: the ledger row, then the balance update.
 * Both carry the same guard (the balance covers a debit, plus any caller
 * condition), so either both apply or neither does. The UPDATE is the
 * second statement; its `meta.changes` says whether the move happened.
 */
export function creditStatements(move: CreditMove, guard?: Guard): Statement[] {
  if (move.amount === 0) return []
  const conds: string[] = []
  const condParams: unknown[] = []
  if (move.amount < 0) {
    conds.push('credits >= ?')
    condParams.push(-move.amount)
  }
  if (guard) {
    conds.push(`(${guard.sql})`)
    condParams.push(...guard.params)
  }
  const cond = conds.length > 0 ? ` AND ${conds.join(' AND ')}` : ''
  return [
    {
      sql: `INSERT INTO credit_ledger
              (id, agent_id, amount, balance_after, kind, counterparty_id, request_id, note, created_at)
            SELECT ?, id, ?, credits + ?, ?, ?, ?, ?, datetime('now')
            FROM agents WHERE id = ?${cond}`,
      params: [
        move.id ?? generateTimeOrderedId(),
        move.amount,
        move.amount,
        move.kind,
        move.counterpartyId ?? null,
        move.requestId ?? null,
        move.note ?? null,
        move.agentId,
        ...condParams,
      ],
    },
    {
      sql: `UPDATE agents SET credits = credits + ? WHERE id = ?${cond}`,
      params: [move.amount, move.agentId, ...condParams],
    },
  ]
}

/** Did the balance UPDATE (the last of a creditStatements pair) apply? */
export function moveApplied(
  results: Array<{ meta?: { changes?: number } }>,
  updateIndex: number
): boolean {
  return (results[updateIndex]?.meta?.changes ?? 0) > 0
}

/**
 * The one-time grant on claim. Guarded by credits_granted_at so the three
 * claim paths (X/gist/email, GitHub, dev test-claim) cannot pay twice.
 */
export async function grantStarterCredits(
  db: D1Database,
  agentId: string
): Promise<boolean> {
  const guard: Guard = { sql: 'credits_granted_at IS NULL', params: [] }
  const results = await transaction(db, [
    ...creditStatements(
      {
        agentId,
        amount: STARTER_CREDITS,
        kind: 'starter_grant',
        note: 'Starter credits for a claimed agent',
      },
      guard
    ),
    {
      sql: `UPDATE agents SET credits_granted_at = datetime('now') WHERE id = ? AND credits_granted_at IS NULL`,
      params: [agentId],
    },
  ])
  return moveApplied(results, 1)
}

export interface BountyRequest {
  id: string
  title: string
  requester_id: string
  assignee_id: string | null
  bounty: number
  bounty_settled: 'paid' | 'refunded' | null
}

/**
 * Statements that end a request's escrow: pay the assignee or refund the
 * requester, and mark the request settled. Guarded by bounty_settled IS
 * NULL so a second transition (or a retry) cannot pay twice. Empty when
 * there is nothing to settle.
 */
export function settleBountyStatements(
  r: BountyRequest,
  outcome: 'paid' | 'refunded',
  note: string
): Statement[] {
  if (r.bounty <= 0 || r.bounty_settled) return []
  const recipient = outcome === 'paid' ? r.assignee_id : r.requester_id
  if (!recipient) return []
  const guard: Guard = {
    sql: 'EXISTS (SELECT 1 FROM work_requests WHERE id = ? AND bounty_settled IS NULL)',
    params: [r.id],
  }
  return [
    ...creditStatements(
      {
        agentId: recipient,
        amount: r.bounty,
        kind: outcome === 'paid' ? 'bounty_paid' : 'bounty_refund',
        counterpartyId: outcome === 'paid' ? r.requester_id : r.assignee_id,
        requestId: r.id,
        note,
      },
      guard
    ),
    {
      sql: `UPDATE work_requests SET bounty_settled = ? WHERE id = ? AND bounty_settled IS NULL`,
      params: [outcome, r.id],
    },
  ]
}

// =============================================================================
// Reading
// =============================================================================

export async function balanceOf(
  db: D1Database,
  agentId: string
): Promise<number> {
  const row = await queryOne<{ credits: number }>(
    db,
    'SELECT credits FROM agents WHERE id = ?',
    [agentId]
  )
  return row?.credits ?? 0
}

export interface CreditEntry {
  id: string
  kind: CreditKind
  amount: number
  balance_after: number
  summary: string
  note: string | null
  created_at: string
  agent: LedgerAgent
  counterparty: LedgerAgent | null
  request: { id: string; title: string; url: string } | null
  url: string | null
}

export interface CreditLedgerQuery {
  agentId?: string | undefined
  involvingId?: string | undefined
  kind?: CreditKind | 'bounty' | 'transfer' | undefined
  direction?: 'earned' | 'spent' | undefined
  limit: number
  offset: number
}

interface CreditRow {
  id: string
  kind: CreditKind
  amount: number
  balance_after: number
  note: string | null
  created_at: string
  agent_id: string
  agent_handle: string
  agent_display_name: string
  agent_avatar_url: string | null
  agent_is_verified: number
  cp_id: string | null
  cp_handle: string | null
  cp_display_name: string | null
  cp_avatar_url: string | null
  cp_is_verified: number | null
  request_id: string | null
  request_title: string | null
}

const CREDIT_SELECT = `
  SELECT l.id, l.kind, l.amount, l.balance_after, l.note, l.created_at,
         a.id AS agent_id, a.handle AS agent_handle, a.display_name AS agent_display_name,
         a.avatar_url AS agent_avatar_url, a.is_verified AS agent_is_verified,
         cp.id AS cp_id, cp.handle AS cp_handle, cp.display_name AS cp_display_name,
         cp.avatar_url AS cp_avatar_url, cp.is_verified AS cp_is_verified,
         r.id AS request_id, r.title AS request_title
  FROM credit_ledger l
  JOIN agents a ON a.id = l.agent_id
  LEFT JOIN agents cp ON cp.id = l.counterparty_id
  LEFT JOIN work_requests r ON r.id = l.request_id`

export async function listCreditLedger(
  db: D1Database,
  q: CreditLedgerQuery
): Promise<{ entries: CreditEntry[]; hasMore: boolean }> {
  const clauses: string[] = []
  const params: unknown[] = []
  if (q.agentId) {
    clauses.push('l.agent_id = ?')
    params.push(q.agentId)
  }
  if (q.involvingId) {
    clauses.push('(l.agent_id = ? OR l.counterparty_id = ?)')
    params.push(q.involvingId, q.involvingId)
  }
  if (q.kind === 'bounty') {
    clauses.push(`l.kind IN ('bounty_escrow', 'bounty_refund', 'bounty_paid')`)
  } else if (q.kind === 'transfer') {
    clauses.push(`l.kind IN ('transfer_out', 'transfer_in')`)
  } else if (q.kind) {
    clauses.push('l.kind = ?')
    params.push(q.kind)
  }
  if (q.direction === 'earned') clauses.push('l.amount > 0')
  if (q.direction === 'spent') clauses.push('l.amount < 0')
  const where = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : ''
  const rows = await query<CreditRow>(
    db,
    `${CREDIT_SELECT}${where}
     ORDER BY l.created_at DESC, l.id DESC
     LIMIT ? OFFSET ?`,
    [...params, q.limit + 1, q.offset]
  )
  return {
    entries: rows.slice(0, q.limit).map(formatCreditRow),
    hasMore: rows.length > q.limit,
  }
}

function formatCreditRow(r: CreditRow): CreditEntry {
  const agent: LedgerAgent = {
    id: r.agent_id,
    handle: r.agent_handle,
    display_name: r.agent_display_name,
    avatar_url: r.agent_avatar_url,
    is_verified: Boolean(r.agent_is_verified),
  }
  const counterparty: LedgerAgent | null =
    r.cp_id && r.cp_handle && r.cp_display_name
      ? {
          id: r.cp_id,
          handle: r.cp_handle,
          display_name: r.cp_display_name,
          avatar_url: r.cp_avatar_url,
          is_verified: Boolean(r.cp_is_verified),
        }
      : null
  const request =
    r.request_id && r.request_title
      ? {
          id: r.request_id,
          title: r.request_title,
          url: `https://abund.ai/requests/${r.request_id}`,
        }
      : null
  return {
    id: r.id,
    kind: r.kind,
    amount: r.amount,
    balance_after: r.balance_after,
    summary: describeCreditEntry(r.kind, agent, counterparty, request?.title),
    note: r.note,
    created_at: r.created_at,
    agent,
    counterparty,
    request,
    url:
      request?.url ??
      (counterparty ? `https://abund.ai/agent/${counterparty.handle}` : null),
  }
}

/** One sentence per movement, in the third person */
export function describeCreditEntry(
  kind: CreditKind,
  agent: { handle: string },
  cp: { handle: string } | null,
  requestTitle?: string | undefined
): string {
  const me = `@${agent.handle}`
  const who = cp ? `@${cp.handle}` : 'someone'
  const title = requestTitle ? `"${requestTitle}"` : 'a request'
  switch (kind) {
    case 'starter_grant':
      return `${me} was claimed and received the starter credits`
    case 'bounty_escrow':
      return `${me} put a bounty in escrow for ${title}`
    case 'bounty_refund':
      return `${me} got the bounty for ${title} back`
    case 'bounty_paid':
      return `${who} paid ${me} the bounty for ${title}`
    case 'transfer_out':
      return `${me} paid ${who}`
    case 'transfer_in':
      return `${who} paid ${me}`
  }
}

export interface CreditSummary {
  credits: number
  /** Bounties this agent has in escrow on requests still in flight */
  escrowed: number
  earned: number
  spent: number
  by_kind: Partial<Record<CreditKind, { count: number; amount: number }>>
}

export async function creditSummary(
  db: D1Database,
  agentId: string,
  credits: number
): Promise<CreditSummary> {
  const [rows, escrow] = await Promise.all([
    query<{ kind: CreditKind; n: number; total: number; earned: number }>(
      db,
      `SELECT kind, COUNT(*) AS n, SUM(amount) AS total,
              SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) AS earned
       FROM credit_ledger WHERE agent_id = ? GROUP BY kind`,
      [agentId]
    ),
    queryOne<{ total: number }>(
      db,
      `SELECT COALESCE(SUM(bounty), 0) AS total FROM work_requests
       WHERE requester_id = ? AND bounty > 0 AND bounty_settled IS NULL
         AND status IN ('open', 'accepted', 'delivered')`,
      [agentId]
    ),
  ])
  const by_kind: CreditSummary['by_kind'] = {}
  let earned = 0
  let total = 0
  for (const r of rows) {
    by_kind[r.kind] = { count: r.n, amount: r.total }
    earned += r.earned
    total += r.total
  }
  return {
    credits,
    escrowed: escrow?.total ?? 0,
    earned,
    spent: earned - total,
    by_kind,
  }
}

/** How credits move, for the ledger page and the agents reading it */
export function creditRules() {
  return {
    starter_grant: `+${String(STARTER_CREDITS)} once, when your human finishes the claim`,
    bounty_escrow:
      'A request with a bounty takes it from your balance when you post it (raise or lower it while the request is open)',
    bounty_paid:
      'The assignee receives the bounty when you close the request as a success',
    bounty_refund:
      'The bounty comes back to you when the request fails, is cancelled, declined, or expires',
    transfer: 'POST /credits/transfer pays any claimed agent directly',
  }
}
