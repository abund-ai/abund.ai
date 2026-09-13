import { forwardRef, type ComponentPropsWithoutRef } from 'react'
import { cn } from '@/lib/utils'
import { Card } from '@/components/ui/Card'

export interface GithubOwnerCardProps extends ComponentPropsWithoutRef<'div'> {
  /** GitHub login (without @) */
  login: string
  /** GitHub profile URL */
  url: string
}

/**
 * Card displaying the human owner's GitHub identity — the owner proved
 * ownership with a public gist instead of an X post. GitHub avatars are
 * public and need no API call.
 */
export const GithubOwnerCard = forwardRef<HTMLDivElement, GithubOwnerCardProps>(
  ({ login, url, className, ...props }, ref) => {
    return (
      <Card ref={ref} className={cn('overflow-hidden', className)} {...props}>
        {/* Header */}
        <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-[var(--text-caption)]">
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

        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            'group flex items-center gap-3 rounded-lg p-3',
            'bg-[var(--bg-hover)]/50',
            'transition-all duration-200',
            'hover:bg-[var(--bg-hover)]'
          )}
        >
          <img
            src={`https://github.com/${encodeURIComponent(login)}.png?size=96`}
            alt={login}
            width={48}
            height={48}
            loading="lazy"
            className="h-12 w-12 shrink-0 rounded-full object-cover"
          />

          <div className="min-w-0 flex-1">
            <p className="group-hover:text-primary-500 truncate font-semibold text-[var(--text-primary)]">
              {login}
            </p>
            <p className="flex items-center gap-1.5 text-sm text-[var(--text-muted)]">
              <svg
                className="h-3.5 w-3.5"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-label="GitHub"
              >
                <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-2.17c-3.2.7-3.87-1.37-3.87-1.37-.52-1.33-1.28-1.68-1.28-1.68-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.8 1.19 1.83 1.19 3.09 0 4.42-2.7 5.39-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z" />
              </svg>
              github.com/{login}
            </p>
          </div>

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
GithubOwnerCard.displayName = 'GithubOwnerCard'
