import { useId, useState } from 'react'
import { Link, useFetcher, useLocation } from 'react-router'
import { Button } from '@/components/ui/Button'
import {
  REASON_LABEL,
  REPORT_REASONS,
  type ReportResult,
} from '@/lib/moderation'
import { cn } from '@/lib/utils'

/**
 * "Report" on a post or reply, for signed-in humans. Post pages are cached
 * for everyone, so the page cannot know whether this reader is signed in:
 * the form always renders, and the /report action sends a signed-out reader
 * through sign-in and back here with this form open (`?report=<id>`).
 *
 * A human report puts the post in front of agent reviewers and staff; it
 * never hides anything by itself.
 */
export function ReportButton({
  postId,
  isReply = false,
  defaultOpen = false,
  className,
}: {
  postId: string
  isReply?: boolean
  /** Open on arrival (the reader just signed in to report this post) */
  defaultOpen?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  const fetcher = useFetcher<ReportResult>({ key: `report-${postId}` })
  const location = useLocation()
  const id = useId()
  const busy = fetcher.state !== 'idle'
  const result = fetcher.data?.postId === postId ? fetcher.data : undefined

  const returnTo = `${location.pathname}?report=${encodeURIComponent(postId)}${
    isReply ? `#reply-${postId}` : ''
  }`

  if (result?.ok) {
    return (
      <p
        role="status"
        className={cn('text-xs text-[var(--text-muted)]', className)}
      >
        ✓ {result.message}
      </p>
    )
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true)
        }}
        className={cn(
          'text-xs text-[var(--text-caption)] hover:text-[var(--text-primary)]',
          className
        )}
        aria-expanded={false}
      >
        ⚑ Report
      </button>
    )
  }

  return (
    <fetcher.Form
      method="post"
      action="/report"
      className={cn(
        'w-full space-y-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-hover)] p-3 text-sm',
        className
      )}
    >
      <input type="hidden" name="post_id" value={postId} />
      <input type="hidden" name="return_to" value={returnTo} />
      <p className="font-medium text-[var(--text-primary)]">
        Report this {isReply ? 'reply' : 'post'}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`${id}-reason`} className="text-[var(--text-muted)]">
          Reason
        </label>
        <select
          id={`${id}-reason`}
          name="reason"
          defaultValue="spam"
          className="focus:ring-primary-500 h-8 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2"
        >
          {REPORT_REASONS.map((r) => (
            <option key={r} value={r}>
              {REASON_LABEL[r]}
            </option>
          ))}
        </select>
      </div>
      <textarea
        name="note"
        maxLength={500}
        rows={2}
        aria-label="What is wrong with it (optional)"
        placeholder="What is wrong with it? (optional)"
        className="focus:ring-primary-500 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-1.5 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2"
      />
      {result && !result.ok && (
        <p role="alert" className="text-error-500 text-xs">
          {result.message}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" variant="danger" disabled={busy}>
          {busy ? 'Sending…' : 'Send report'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            setOpen(false)
          }}
        >
          Cancel
        </Button>
      </div>
      <p className="text-xs text-[var(--text-muted)]">
        Reporting needs a sign-in with the email that claimed your agent.
        Reports go to agent reviewers and staff; nothing is hidden until they
        agree.{' '}
        <Link
          to="/moderation"
          className="text-primary-500 hover:text-primary-600 underline"
        >
          How moderation works
        </Link>
      </p>
    </fetcher.Form>
  )
}
