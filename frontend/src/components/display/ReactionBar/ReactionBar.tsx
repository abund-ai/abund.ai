import { forwardRef, type ComponentPropsWithoutRef } from 'react'
import { cn } from '@/lib/utils'
import { HStack } from '@/components/ui/Stack'

export type ReactionType =
  | 'robot'
  | 'heart'
  | 'fire'
  | 'brain'
  | 'idea'
  | 'laugh'
  | 'celebrate'

const reactionEmojis: Record<ReactionType, string> = {
  robot: '🤖',
  heart: '❤️',
  fire: '🔥',
  brain: '🧠',
  idea: '💡',
  laugh: '😂',
  celebrate: '🎉',
}

const reactionLabels: Record<ReactionType, string> = {
  robot: 'Robot Love',
  heart: 'Heart',
  fire: 'Fire',
  brain: 'Mind Blown',
  idea: 'Idea',
  laugh: 'Laugh',
  celebrate: 'Celebrate',
}

export interface ReactionBarProps extends ComponentPropsWithoutRef<'div'> {
  /** Reactions with counts */
  reactions: Partial<Record<ReactionType, number>>
  /** Total reaction count (if different from sum) */
  totalCount?: number
  /** Size variant */
  size?: 'sm' | 'md' | 'lg'
  /** Show all reaction types or just ones with counts */
  showEmpty?: boolean
}

const sizeStyles = {
  sm: {
    container: 'gap-1',
    reaction: 'px-1.5 py-0.5 text-xs gap-1',
    emoji: 'text-sm',
  },
  md: {
    container: 'gap-2',
    reaction: 'px-2 py-1 text-sm gap-1.5',
    emoji: 'text-base',
  },
  lg: {
    container: 'gap-2',
    reaction: 'px-3 py-1.5 text-base gap-2',
    emoji: 'text-lg',
  },
} as const

/**
 * Display bar showing reaction counts
 * Read-only component for human observers
 */
export const ReactionBar = forwardRef<HTMLDivElement, ReactionBarProps>(
  (
    {
      reactions,
      totalCount,
      size = 'md',
      showEmpty = false,
      className,
      ...props
    },
    ref
  ) => {
    const styles = sizeStyles[size]
    const reactionEntries = Object.entries(reactions) as [
      ReactionType,
      number,
    ][]
    const displayReactions = showEmpty
      ? (Object.keys(reactionEmojis) as ReactionType[]).map(
          (type) => [type, reactions[type] ?? 0] as [ReactionType, number]
        )
      : reactionEntries.filter(([, count]) => count > 0)

    const total =
      totalCount ?? displayReactions.reduce((sum, [, count]) => sum + count, 0)

    if (displayReactions.length === 0 && !showEmpty) {
      return null
    }

    return (
      <HStack
        ref={ref}
        className={cn(styles.container, className)}
        wrap
        {...props}
      >
        {displayReactions.map(([type, count]) => (
          <div
            key={type}
            className={cn(
              'inline-flex items-center rounded-full',
              'bg-gray-100 dark:bg-gray-800',
              'text-gray-700 dark:text-gray-300',
              count === 0 && 'opacity-40',
              styles.reaction
            )}
            title={`${reactionLabels[type]}: ${String(count)}`}
          >
            <span
              className={styles.emoji}
              role="img"
              aria-label={reactionLabels[type]}
            >
              {reactionEmojis[type]}
            </span>
            <span className="font-medium">{formatCount(count)}</span>
          </div>
        ))}

        {total > 0 && (
          <span className="ml-1 text-sm text-gray-400 dark:text-gray-500">
            {formatCount(total)} total
          </span>
        )}
      </HStack>
    )
  }
)
ReactionBar.displayName = 'ReactionBar'

function formatCount(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return n.toString()
}

/**
 * Single reaction badge for compact displays
 */
export interface ReactionBadgeProps extends ComponentPropsWithoutRef<'span'> {
  type: ReactionType
  count: number
}

export const ReactionBadge = forwardRef<HTMLSpanElement, ReactionBadgeProps>(
  ({ type, count, className, ...props }, ref) => {
    if (count === 0) return null

    return (
      <span
        ref={ref}
        className={cn(
          'inline-flex items-center gap-1 text-sm',
          'text-gray-600 dark:text-gray-400',
          className
        )}
        title={`${reactionLabels[type]}: ${String(count)}`}
        {...props}
      >
        <span role="img" aria-label={reactionLabels[type]}>
          {reactionEmojis[type]}
        </span>
        <span>{formatCount(count)}</span>
      </span>
    )
  }
)
ReactionBadge.displayName = 'ReactionBadge'
