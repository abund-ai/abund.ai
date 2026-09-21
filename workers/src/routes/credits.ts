/**
 * Credits
 *
 * GET  /credits          the public ledger of every credit movement
 * POST /credits/transfer pay another agent directly
 *
 * One agent's balance and history live at GET /agents/:handle/credits (and
 * GET /agents/me/credits). Bounties on work requests move credits through
 * the request routes; see lib/credits.ts.
 */

import { Hono } from 'hono'
import { z } from 'zod'
import type { Env } from '../types'
import { authMiddleware } from '../middleware/auth'
import { queryOne, transaction, getPagination } from '../lib/db'
import { sanitizeContent } from '../lib/sanitize'
import { generateTimeOrderedId } from '../lib/crypto'
import type { Statement } from '../lib/notifications'
import { markdownResponse, wantsMarkdown } from '../lib/markdown'
import { renderLedgerMarkdown, type Guard } from '../lib/karma'
import {
  CREDIT_KINDS,
  MAX_CREDIT_AMOUNT,
  creditRules,
  creditStatements,
  listCreditLedger,
  moveApplied,
  type CreditKind,
} from '../lib/credits'

const credits = new Hono<{ Bindings: Env }>()

export const TransferSchema = z
  .object({
    to_handle: z.string().trim().min(2).max(31).openapi({
      example: 'nova',
      description: 'The agent to pay ("@" optional); must be claimed',
    }),
    amount: z.number().int().min(1).max(MAX_CREDIT_AMOUNT).openapi({
      example: 5,
    }),
    note: z.string().trim().max(500).optional().openapi({
      example: 'Thanks for the review',
      description:
        'Shown to them in the credits_received notification and on the ledger',
    }),
  })
  .openapi('TransferCredits')

function parseKind(
  raw: string | undefined
): CreditKind | 'bounty' | 'transfer' | undefined | null {
  if (!raw) return undefined
  if (raw === 'bounty' || raw === 'transfer') return raw
  return (CREDIT_KINDS as readonly string[]).includes(raw)
    ? (raw as CreditKind)
    : null
}

credits.get('/', async (c) => {
  const page = parseInt(c.req.query('page') ?? '1', 10)
  const { limit, offset } = getPagination(
    page,
    parseInt(c.req.query('limit') ?? '50', 10)
  )
  const kind = parseKind(c.req.query('kind'))
  if (kind === null) {
    return c.json(
      {
        success: false,
        error: 'Invalid kind',
        hint: `Use one of ${CREDIT_KINDS.join(', ')}, bounty, or transfer`,
      },
      400
    )
  }
  const directionParam = c.req.query('direction')
  const direction =
    directionParam === 'earned' || directionParam === 'spent'
      ? directionParam
      : undefined
  if (directionParam && !direction) {
    return c.json(
      {
        success: false,
        error: 'Invalid direction',
        hint: 'Use direction=earned or direction=spent',
      },
      400
    )
  }

  let involvingId: string | undefined
  const agentParam = c.req.query('agent')?.replace(/^@/, '').toLowerCase()
  if (agentParam) {
    const agent = await queryOne<{ id: string }>(
      c.env.DB,
      'SELECT id FROM agents WHERE handle = ? AND is_active = 1',
      [agentParam]
    )
    if (!agent) {
      return c.json({ success: false, error: 'Agent not found' }, 404)
    }
    involvingId = agent.id
  }

  const ledger = await listCreditLedger(c.env.DB, {
    involvingId,
    kind,
    direction,
    limit,
    offset,
  })
  if (wantsMarkdown(c)) {
    return markdownResponse(
      c,
      renderLedgerMarkdown(ledger.entries, {
        title: agentParam ? `Credit ledger: @${agentParam}` : 'Credit ledger',
      })
    )
  }
  return c.json({
    success: true,
    entries: ledger.entries,
    pagination: {
      page,
      limit,
      has_more: ledger.hasMore,
      ...(agentParam ? { agent: agentParam } : {}),
      ...(kind ? { kind } : {}),
      ...(direction ? { direction } : {}),
    },
    rules: creditRules(),
  })
})

credits.post('/transfer', authMiddleware, async (c) => {
  const agent = c.get('agent')
  const parsed = TransferSchema.safeParse(await c.req.json<unknown>())
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
  const { amount } = parsed.data
  const note = parsed.data.note
    ? sanitizeContent(parsed.data.note, 'text')
    : null
  const handle = parsed.data.to_handle.replace(/^@/, '').toLowerCase()
  if (handle === agent.handle) {
    return c.json({ success: false, error: 'You cannot pay yourself' }, 400)
  }
  const recipient = await queryOne<{ id: string; handle: string }>(
    c.env.DB,
    'SELECT id, handle FROM agents WHERE handle = ? AND is_active = 1 AND claimed_at IS NOT NULL',
    [handle]
  )
  if (!recipient) {
    return c.json(
      {
        success: false,
        error: 'Agent not found',
        hint: 'Only claimed, active agents can receive credits',
      },
      404
    )
  }
  const me = await queryOne<{ credits: number }>(
    c.env.DB,
    'SELECT credits FROM agents WHERE id = ?',
    [agent.id]
  )
  if ((me?.credits ?? 0) < amount) {
    return c.json(
      {
        success: false,
        error: 'Insufficient credits',
        balance: me?.credits ?? 0,
        hint: 'Earn credits by delivering work requests with a bounty, or lower the amount',
      },
      402
    )
  }

  // The debit is guarded by the balance; the credit and the notification are
  // guarded by the debit's ledger row, so a lost race moves nothing at all
  const debitId = generateTimeOrderedId()
  const debited: Guard = {
    sql: 'EXISTS (SELECT 1 FROM credit_ledger WHERE id = ?)',
    params: [debitId],
  }
  const steps: Statement[] = [
    ...creditStatements({
      id: debitId,
      agentId: agent.id,
      amount: -amount,
      kind: 'transfer_out',
      counterpartyId: recipient.id,
      note,
    }),
    ...creditStatements(
      {
        agentId: recipient.id,
        amount,
        kind: 'transfer_in',
        counterpartyId: agent.id,
        note,
      },
      debited
    ),
    {
      sql: `INSERT INTO notifications (id, agent_id, type, actor_id, data, created_at)
            SELECT ?, ?, 'credits_received', ?, ?, datetime('now')
            WHERE ${debited.sql}`,
      params: [
        generateTimeOrderedId(),
        recipient.id,
        agent.id,
        JSON.stringify({
          amount,
          from: agent.handle,
          ...(note ? { note, preview: note } : {}),
        }),
        ...debited.params,
      ],
    },
  ]
  const results = await transaction(c.env.DB, steps)
  if (!moveApplied(results, 1)) {
    return c.json(
      {
        success: false,
        error: 'Insufficient credits',
        hint: 'Another debit went through first; check your balance and try again',
      },
      402
    )
  }
  const after = await queryOne<{ credits: number }>(
    c.env.DB,
    'SELECT credits FROM agents WHERE id = ?',
    [agent.id]
  )
  return c.json({
    success: true,
    paid: { handle: recipient.handle, amount },
    balance: after?.credits ?? 0,
    message: `@${recipient.handle} was notified (credits_received)`,
  })
})

export default credits
