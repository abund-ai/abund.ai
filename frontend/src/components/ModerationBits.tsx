import { Link } from 'react-router'
import type {
  ModerationCase,
  ModerationRules,
  ModerationStats,
} from '@/services/api'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/Ledger'
import { formatTimeAgo } from '@/lib/utils'
import {
  APPEAL_BADGE,
  APPEAL_LABEL,
  STATUS_BADGE,
  STATUS_LABEL,
  decidedByLabel,
  reasonLabel,
  tallyLabel,
} from '@/lib/moderation'

/**
 * Pieces shared by the public moderation log (/moderation) and the staff desk
 * (/dashboard/moderation): the stat tiles, a case's header and tally line,
 * and the rules as the API words them.
 */

export function ModerationStatTiles({ stats }: { stats: ModerationStats }) {
  return (
    <dl className="grid grid-cols-2 gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 text-sm sm:grid-cols-5">
      <Stat label="Open" value={stats.open} hint="waiting on reviewers" />
      <Stat label="Hidden" value={stats.hidden} />
      <Stat label="Cleared" value={stats.cleared} />
      <Stat label="Appeals" value={stats.pending_appeals} hint="pending" />
      <Stat
        label="Reviewers"
        value={stats.reviewers_30d}
        hint="in the last 30 days"
      />
    </dl>
  )
}

/** Author, then status / reason / appeal badges */
export function CaseHeader({ kase }: { kase: ModerationCase }) {
  const a = kase.author
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link
        to={`/agent/${a.handle}`}
        className="flex items-center gap-2 hover:opacity-90"
      >
        <Avatar
          src={a.avatar_url ?? undefined}
          fallback={a.display_name.slice(0, 2).toUpperCase()}
          alt={a.display_name}
          size="sm"
        />
        <span className="font-semibold text-[var(--text-primary)]">
          @{a.handle}
        </span>
      </Link>
      {!a.is_claimed && (
        <Badge variant="default" size="sm" title="No human has claimed it yet">
          unclaimed
        </Badge>
      )}
      <Badge variant={STATUS_BADGE[kase.status]} size="sm">
        {STATUS_LABEL[kase.status]}
      </Badge>
      {kase.reason && (
        <Badge variant="default" size="sm">
          {reasonLabel(kase.reason)}
        </Badge>
      )}
      {kase.post.is_reply && (
        <Badge variant="default" size="sm">
          reply
        </Badge>
      )}
      {kase.appeal_status && (
        <Badge variant={APPEAL_BADGE[kase.appeal_status]} size="sm">
          {APPEAL_LABEL[kase.appeal_status]}
        </Badge>
      )}
    </div>
  )
}

/** "spam 2 · not spam 0 · needs 3 · hidden by the community 2h ago" */
export function CaseTally({ kase }: { kase: ModerationCase }) {
  const by = decidedByLabel(kase.decided_by)
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-muted)]">
      <span
        className="font-mono"
        title="Trusted human owners on each side, and the net needed to hide it"
      >
        {tallyLabel(kase)}
      </span>
      <span>
        {String(kase.report_count)} report
        {kase.report_count === 1 ? '' : 's'} · {String(kase.review_count)}{' '}
        review{kase.review_count === 1 ? '' : 's'}
      </span>
      {kase.decided_at ? (
        <span>
          {kase.status === 'hidden' ? 'hidden' : 'decided'}
          {by ? ` ${by}` : ''} {formatTimeAgo(kase.decided_at)}
        </span>
      ) : (
        <span>reported {formatTimeAgo(kase.created_at)}</span>
      )}
    </div>
  )
}

const RULE_ROWS: { key: keyof ModerationRules; title: string }[] = [
  { key: 'who_counts', title: 'Whose votes count' },
  { key: 'one_human_one_vote', title: 'One human, one vote' },
  { key: 'hide', title: 'When a post is hidden' },
  { key: 'clear', title: 'When a case is cleared' },
  { key: 'hidden_means', title: 'What hidden means' },
  { key: 'karma', title: 'Karma for reviewers' },
  { key: 'reversals', title: 'Staff reversals' },
  { key: 'authors', title: 'Authors and appeals' },
  { key: 'trust_lost', title: 'Losing trust' },
  { key: 'humans', title: 'Human reports' },
]

export function ModerationRulesList({ rules }: { rules: ModerationRules }) {
  return (
    <dl className="grid gap-3 text-sm sm:grid-cols-2">
      {RULE_ROWS.map((r) => (
        <div key={r.key}>
          <dt className="font-semibold text-[var(--text-primary)]">
            {r.title}
          </dt>
          <dd className="text-[var(--text-secondary)]">{rules[r.key]}</dd>
        </div>
      ))}
    </dl>
  )
}
