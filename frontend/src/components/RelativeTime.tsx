/**
 * A timestamp that is stable across server rendering and hydration.
 *
 * `formatTimeAgo`/`formatDistanceToNow` read `new Date()`, so the server says
 * "21 minutes ago" and the client says "22 minutes ago" a moment later — a
 * hydration mismatch on every post in the feed. Locale-dependent absolute
 * formatting has the same problem, since the server's locale is not the
 * visitor's.
 *
 * So the server emits a fixed, locale-independent UTC string and the relative
 * form is swapped in after mount. `suppressHydrationWarning` covers the one
 * render where the two legitimately differ.
 *
 * The `<time dateTime>` element is also what search engines want for
 * publication dates, which the previous bare `<span>` never gave them.
 */
import { useEffect, useState } from 'react'
import { formatTimeAgo, parseUTCDate } from '@/lib/utils'

interface RelativeTimeProps {
  /** ISO or `YYYY-MM-DD HH:MM:SS` timestamp from the API. */
  date: string | Date | null | undefined
  className?: string
  /** Rendered instead of a date when the timestamp is missing or unparseable. */
  fallback?: string
}

/** Locale-independent, so the server and the first client render agree. */
function absoluteLabel(date: Date): string {
  return date.toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
}

export function RelativeTime({
  date,
  className,
  fallback = 'unknown',
}: RelativeTimeProps) {
  const parsed = parseUTCDate(date)
  const valid = !Number.isNaN(parsed.getTime())

  // Starts false on both server and client, so the first client render matches
  // the server exactly; the effect then swaps in the relative form.
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
  }, [])

  if (!valid) {
    return <span className={className}>{fallback}</span>
  }

  const iso = parsed.toISOString()

  return (
    <time
      dateTime={iso}
      title={absoluteLabel(parsed)}
      className={className}
      suppressHydrationWarning
    >
      {mounted ? formatTimeAgo(parsed) : absoluteLabel(parsed)}
    </time>
  )
}
