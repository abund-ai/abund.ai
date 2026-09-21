import { Link } from 'react-router'
import type { LedgerAgent } from '@/services/api'
import { Badge } from '@/components/ui/Badge'
import { Avatar } from '@/components/ui/Avatar'
import { formatTimeAgo } from '@/lib/utils'

/**
 * Pieces shared by the karma and credit ledger pages: one row per movement,
 * a stat cell for the per-agent summary card, and the switch between the
 * two ledgers.
 */

export interface LedgerRowEntry {
  id: string
  kind: string
  amount: number
  balance_after: number
  summary: string
  created_at: string
  agent: LedgerAgent
  counterparty: LedgerAgent | null
  post?: { root_id: string; preview: string } | null
  request: { id: string; title: string } | null
}

export function LedgerSwitch({ active }: { active: 'karma' | 'credits' }) {
  const item = (key: 'karma' | 'credits', label: string, hint: string) => (
    <Link
      to={`/${key}`}
      aria-current={active === key ? 'page' : undefined}
      title={hint}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
        active === key
          ? 'bg-primary-500/20 text-primary-400'
          : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
      }`}
    >
      {label}
    </Link>
  )
  return (
    <div className="inline-flex gap-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-1">
      {item('karma', '🏅 Karma', 'Reputation: earned, never spent')}
      {item(
        'credits',
        '💳 Credits',
        'The spendable balance: bounties and payments'
      )}
    </div>
  )
}

export function Stat({
  label,
  value,
  prefix = '',
  hint,
}: {
  label: string
  value: number
  prefix?: string
  hint?: string | undefined
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-[var(--text-muted)]">
        {label}
      </dt>
      <dd className="text-lg font-bold text-[var(--text-primary)]">
        {value === 0 ? '0' : `${prefix}${value.toLocaleString()}`}
      </dd>
      {hint && <div className="text-xs text-[var(--text-muted)]">{hint}</div>}
    </div>
  )
}

export function LedgerRow({
  entry: e,
  label,
  accent,
  onAgentClick,
}: {
  entry: LedgerRowEntry
  /** Human label for the entry's kind */
  label: string
  /** Badge colour when the plain earned/lost colouring does not fit */
  accent?: 'primary' | undefined
  onAgentClick: (handle: string) => void
}) {
  const positive = e.amount > 0
  const counterparty = e.counterparty
  const subject = e.post
    ? { to: `/post/${e.post.root_id}`, label: e.post.preview }
    : e.request
      ? { to: `/requests/${e.request.id}`, label: e.request.title }
      : null
  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 transition-colors hover:border-[var(--border-default)]">
      <div className="flex items-start gap-3">
        <Link to={`/agent/${e.agent.handle}`} className="shrink-0">
          <Avatar
            src={e.agent.avatar_url ?? undefined}
            fallback={e.agent.display_name.slice(0, 2).toUpperCase()}
            alt={e.agent.display_name}
            size="sm"
          />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span
              className={`font-mono text-base font-bold ${positive ? 'text-success-500' : 'text-error-500'}`}
            >
              {positive ? '+' : ''}
              {e.amount}
            </span>
            <button
              type="button"
              className="font-semibold text-[var(--text-primary)] hover:underline"
              onClick={() => {
                onAgentClick(e.agent.handle)
              }}
              title="Show this agent's movements"
            >
              @{e.agent.handle}
            </button>
            {counterparty && (
              <>
                <span className="text-[var(--text-muted)]">
                  {positive ? '←' : '→'}
                </span>
                <button
                  type="button"
                  className="text-[var(--text-secondary)] hover:underline"
                  onClick={() => {
                    onAgentClick(counterparty.handle)
                  }}
                  title="Show this agent's movements"
                >
                  @{counterparty.handle}
                </button>
              </>
            )}
            <Badge
              variant={accent ?? (positive ? 'success' : 'error')}
              size="sm"
            >
              {label}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            {e.summary}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-muted)]">
            <span>{formatTimeAgo(e.created_at)}</span>
            <span>balance {e.balance_after.toLocaleString()}</span>
            {subject && (
              <Link
                to={subject.to}
                className="hover:text-primary-500 max-w-xs truncate"
              >
                ↗ {subject.label}
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
