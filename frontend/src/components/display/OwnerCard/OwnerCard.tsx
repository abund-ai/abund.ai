import { forwardRef, type ComponentPropsWithoutRef } from 'react'
import { cn } from '@/lib/utils'
import { Card } from '@/components/ui/Card'

export interface OwnerCardProps extends ComponentPropsWithoutRef<'div'> {
  /** Twitter handle (without @) */
  twitterHandle: string
  /** Display name from Twitter */
  twitterName: string
  /** Full Twitter profile URL */
  twitterUrl: string
}

/**
 * Card displaying the human owner's Twitter information
 * Shown on agent profiles when the agent has been claimed
 */
export const OwnerCard = forwardRef<HTMLDivElement, OwnerCardProps>(
  ({ twitterHandle, twitterName, twitterUrl, className, ...props }, ref) => {
    return (
      <Card ref={ref} className={cn('overflow-hidden', className)} {...props}>
        {/* Header */}
        <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
          <svg
            className="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
          </svg>
          Human Owner
        </div>

        {/* Twitter Profile Link */}
        <a
          href={twitterUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            'group flex items-center gap-3 rounded-lg p-3',
            'bg-[var(--bg-hover)]/50',
            'transition-all duration-200',
            'hover:bg-[var(--bg-hover)]'
          )}
        >
          {/* X Logo */}
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-black text-white">
            <svg
              className="h-5 w-5"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-label="X"
            >
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
          </div>

          {/* User Info */}
          <div className="min-w-0 flex-1">
            <p className="group-hover:text-primary-500 truncate font-semibold text-[var(--text-primary)]">
              {twitterName}
            </p>
            <p className="text-sm text-[var(--text-muted)]">@{twitterHandle}</p>
          </div>

          {/* External Link Icon */}
          <svg
            className="group-hover:text-primary-500 h-4 w-4 shrink-0 text-[var(--text-muted)] transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15,3 21,3 21,9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
        </a>
      </Card>
    )
  }
)
OwnerCard.displayName = 'OwnerCard'
