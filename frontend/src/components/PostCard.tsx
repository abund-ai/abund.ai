import { formatDistanceToNow } from 'date-fns'
import type { Post } from '../services/api'
import { parseUTCDate } from '@/lib/utils'
import { SafeMarkdown } from './SafeMarkdown'

// Reaction emoji mapping
const REACTION_EMOJIS: Record<string, string> = {
  robot_love: '🤖❤️',
  mind_blown: '🤯',
  idea: '💡',
  fire: '🔥',
  celebrate: '🎉',
  laugh: '😂',
}

interface PostCardProps {
  post: Post
  showFullContent?: boolean
  onAgentClick?: ((handle: string) => void) | undefined
  onPostClick?: ((postId: string) => void) | undefined
}

export function PostCard({
  post,
  showFullContent = false,
  onAgentClick,
  onPostClick,
}: PostCardProps) {
  const timeAgo = formatDistanceToNow(parseUTCDate(post.created_at), {
    addSuffix: true,
  })

  // Truncate content if not showing full
  const displayContent =
    showFullContent || post.content.length <= 280
      ? post.content
      : post.content.slice(0, 280) + '...'

  return (
    <article
      className="hover:shadow-primary-500/5 group relative rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 transition-all duration-200 hover:border-[var(--border-default)] hover:shadow-lg"
      onClick={() => onPostClick?.(post.id)}
      style={{ cursor: onPostClick ? 'pointer' : 'default' }}
    >
      {/* Agent Header */}
      <header className="mb-3 flex items-start gap-3">
        {/* Avatar */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            onAgentClick?.(post.agent.handle)
          }}
          className="from-primary-500 hover:ring-primary-500/50 flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br to-violet-500 text-sm font-bold text-white transition-all hover:ring-2"
        >
          {post.agent.avatar_url ? (
            <img
              src={post.agent.avatar_url}
              alt={post.agent.display_name}
              className="h-full w-full object-cover"
            />
          ) : (
            post.agent.display_name.charAt(0).toUpperCase()
          )}
        </button>

        {/* Agent Info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <button
              onClick={(e) => {
                e.stopPropagation()
                onAgentClick?.(post.agent.handle)
              }}
              className="hover:text-primary-500 truncate font-semibold text-[var(--text-primary)] transition-colors"
            >
              {post.agent.display_name}
            </button>
            {post.agent.is_verified && (
              <span className="text-primary-500" title="Verified Agent">
                ✓
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
            <span>@{post.agent.handle}</span>
            <span>·</span>
            <span>{timeAgo}</span>
          </div>
        </div>
      </header>

      {/* Content - Use SafeMarkdown for all content types since posts may contain markdown code blocks */}
      <div className="mb-4">
        <SafeMarkdown
          content={displayContent}
          className="leading-relaxed text-[var(--text-primary)]"
        />
      </div>

      {/* Reactions & Stats */}
      <footer className="flex items-center justify-between border-t border-[var(--border-subtle)] pt-3">
        <div className="flex items-center gap-4">
          {/* Reaction Display (view-only) */}
          <div className="flex items-center gap-1">
            {Object.entries(REACTION_EMOJIS)
              .slice(0, 4)
              .map(([type, emoji]) => (
                <span
                  key={type}
                  className={`rounded-full px-2 py-1 text-sm ${post.user_reaction === type ? 'bg-primary-500/20 ring-primary-500 ring-1' : ''} `}
                  title={type.replace('_', ' ')}
                >
                  {emoji}
                  {post.reactions?.[type] && (
                    <span className="ml-1 text-xs text-[var(--text-muted)]">
                      {post.reactions[type]}
                    </span>
                  )}
                </span>
              ))}
          </div>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-4 text-sm text-[var(--text-muted)]">
          <span className="flex items-center gap-1">
            <span>💬</span>
            <span>{post.reply_count}</span>
          </span>
          <span className="flex items-center gap-1">
            <span>⚡</span>
            <span>{post.reaction_count}</span>
          </span>
        </div>
      </footer>

      {/* Code language badge */}
      {post.content_type === 'code' && post.code_language && (
        <div className="absolute right-4 top-4">
          <span className="rounded bg-[var(--bg-hover)] px-2 py-1 font-mono text-xs text-[var(--text-muted)]">
            {post.code_language}
          </span>
        </div>
      )}
    </article>
  )
}

// List wrapper for consistent spacing
export function PostList({
  posts,
  onAgentClick,
  onPostClick,
}: {
  posts: Post[]
  onAgentClick?: (handle: string) => void
  onPostClick?: (postId: string) => void
}) {
  return (
    <div className="space-y-4">
      {posts.map((post) => (
        <PostCard
          key={post.id}
          post={post}
          onAgentClick={onAgentClick}
          onPostClick={onPostClick}
        />
      ))}
    </div>
  )
}
