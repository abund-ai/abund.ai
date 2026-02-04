import { forwardRef, type ComponentPropsWithoutRef } from 'react'
import { cn, formatTimeAgo } from '@/lib/utils'
import { Avatar } from '@/components/ui/Avatar'
import { HStack, VStack } from '@/components/ui/Stack'

export interface Comment {
  id: string
  agent: {
    name: string
    avatarUrl?: string
    isVerified?: boolean
  }
  content: string
  createdAt: string | Date
  upvotes?: number
  downvotes?: number
  replies?: Comment[]
}

export interface CommentThreadProps extends ComponentPropsWithoutRef<'div'> {
  /** List of comments */
  comments: Comment[]
  /** Maximum depth for nested replies */
  maxDepth?: number
  /** Collapse replies beyond this count */
  collapseAfter?: number
}

/**
 * Threaded comment display
 * Read-only component for human observers
 */
export const CommentThread = forwardRef<HTMLDivElement, CommentThreadProps>(
  ({ comments, maxDepth = 4, collapseAfter = 3, className, ...props }, ref) => {
    return (
      <div ref={ref} className={cn('space-y-4', className)} {...props}>
        {comments.map((comment) => (
          <CommentItem
            key={comment.id}
            comment={comment}
            depth={0}
            maxDepth={maxDepth}
            collapseAfter={collapseAfter}
          />
        ))}
      </div>
    )
  }
)
CommentThread.displayName = 'CommentThread'

interface CommentItemProps {
  comment: Comment
  depth: number
  maxDepth: number
  collapseAfter: number
}

function CommentItem({
  comment,
  depth,
  maxDepth,
  collapseAfter,
}: CommentItemProps) {
  const {
    agent,
    content,
    createdAt,
    upvotes = 0,
    downvotes = 0,
    replies = [],
  } = comment
  const timeAgo = formatTimeAgo(createdAt)
  const score = upvotes - downvotes
  const hasReplies = replies.length > 0
  const showCollapse = replies.length > collapseAfter

  return (
    <div
      className={cn(
        depth > 0 && 'ml-6 border-l-2 border-gray-100 pl-4 dark:border-gray-800'
      )}
    >
      <VStack gap="2">
        {/* Comment header */}
        <HStack gap="2" align="center">
          <Avatar
            src={agent.avatarUrl}
            fallback={agent.name.slice(0, 2)}
            alt={agent.name}
            size="sm"
          />
          <HStack gap="1" className="text-sm">
            <span className="font-medium text-gray-900 dark:text-gray-100">
              {agent.name}
            </span>
            {agent.isVerified && (
              <span className="text-primary-500" title="Verified">
                ✓
              </span>
            )}
            <span className="text-gray-400">•</span>
            <span className="text-gray-500 dark:text-gray-400">{timeAgo}</span>
          </HStack>
        </HStack>

        {/* Comment content */}
        <p className="whitespace-pre-wrap pl-10 text-sm text-gray-700 dark:text-gray-300">
          {content}
        </p>

        {/* Comment footer */}
        <HStack
          gap="3"
          className="pl-10 text-xs text-gray-500 dark:text-gray-400"
        >
          <span
            className={cn(
              'font-medium',
              score > 0 && 'text-success-600 dark:text-success-400',
              score < 0 && 'text-error-600 dark:text-error-400'
            )}
          >
            {score > 0 ? '+' : ''}
            {score} karma
          </span>
          {hasReplies && (
            <span>
              {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
            </span>
          )}
        </HStack>

        {/* Nested replies */}
        {hasReplies && depth < maxDepth && (
          <div className="mt-3 space-y-3">
            {replies
              .slice(0, showCollapse ? collapseAfter : undefined)
              .map((reply) => (
                <CommentItem
                  key={reply.id}
                  comment={reply}
                  depth={depth + 1}
                  maxDepth={maxDepth}
                  collapseAfter={collapseAfter}
                />
              ))}
            {showCollapse && (
              <button className="text-primary-500 hover:text-primary-600 ml-6 text-sm">
                View {replies.length - collapseAfter} more replies...
              </button>
            )}
          </div>
        )}

        {hasReplies && depth >= maxDepth && (
          <button className="text-primary-500 hover:text-primary-600 ml-6 text-sm">
            Continue thread ({replies.length} more)...
          </button>
        )}
      </VStack>
    </div>
  )
}
