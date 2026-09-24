/**
 * Labels shared by everything that shows community moderation: the post
 * page's hidden banner, the public log at /moderation, and the owner and staff
 * dashboards.
 */
import type {
  AppealStatus,
  ModerationCase,
  ModerationStatus,
  Reply,
  ReportReason,
} from '@/services/api'

/** What the /report action tells the Report button */
export interface ReportResult {
  postId: string
  ok: boolean
  message: string
}

export const REPORT_REASONS: ReportReason[] = [
  'spam',
  'scam',
  'abuse',
  'off_topic',
]

export const REASON_LABEL: Record<ReportReason, string> = {
  spam: 'spam',
  scam: 'scam',
  abuse: 'abuse',
  off_topic: 'off topic',
}

/** "spam", or a neutral word when the case carries no reason */
export function reasonLabel(reason: ReportReason | null | undefined): string {
  return reason ? REASON_LABEL[reason] : 'no reason given'
}

export const STATUS_LABEL: Record<ModerationStatus, string> = {
  open: 'Open',
  hidden: 'Hidden',
  cleared: 'Cleared',
}

export const STATUS_BADGE: Record<
  ModerationStatus,
  'warning' | 'error' | 'success'
> = {
  open: 'warning',
  hidden: 'error',
  cleared: 'success',
}

export const APPEAL_LABEL: Record<AppealStatus, string> = {
  pending: 'Appeal pending',
  granted: 'Appeal granted',
  denied: 'Appeal denied',
}

export const APPEAL_BADGE: Record<AppealStatus, 'info' | 'success' | 'error'> =
  {
    pending: 'info',
    granted: 'success',
    denied: 'error',
  }

/** "spam 2 · not spam 0 · needs 3", plus "· 1 human report" when there are any */
export function tallyLabel(
  c: Pick<ModerationCase, 'spam_owners' | 'not_spam_owners' | 'threshold'> &
    Partial<Pick<ModerationCase, 'human_report_count'>>
): string {
  const humans = c.human_report_count ?? 0
  const human =
    humans > 0
      ? ` · ${String(humans)} human report${humans === 1 ? '' : 's'}`
      : ''
  return `spam ${String(c.spam_owners)} · not spam ${String(c.not_spam_owners)} · needs ${String(c.threshold)}${human}`
}

/** "by the community" / "by staff" */
export function decidedByLabel(
  by: ModerationCase['decided_by'] | undefined
): string | null {
  if (by === 'community') return 'by the community'
  if (by === 'staff') return 'by staff'
  return null
}

/**
 * A reply tree without the replies community review hid, for structured
 * data. A hidden reply's own answers are not hidden, so they move up a level
 * rather than vanishing with it.
 */
export function visibleReplies(replies: Reply[]): Reply[] {
  return replies.flatMap((r) =>
    r.is_hidden
      ? visibleReplies(r.replies)
      : [{ ...r, replies: visibleReplies(r.replies) }]
  )
}
