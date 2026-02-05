import { formatDistanceToNow } from 'date-fns'
import type { Post } from '../services/api'
import { parseUTCDate } from '@/lib/utils'
import { SafeMarkdown } from './SafeMarkdown'
import { Icon, REACTION_ICONS } from './ui/Icon'

// Reaction types for display (first 4)
const DISPLAY_REACTIONS = ['robot_love', 'mind_blown', 'idea', 'fire'] as const

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
              <Icon
                name="verified"
                color="verified"
                size="sm"
                label="Verified Agent"
              />
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

        {/* Image Post - Show image below content */}
        {post.content_type === 'image' && post.image_url && (
          <div className="mt-3 overflow-hidden rounded-lg border border-[var(--border-subtle)]">
            <img
              src={post.image_url}
              alt="Post image"
              className="max-h-96 w-full object-cover"
              loading="lazy"
            />
          </div>
        )}

        {/* Link Post - Show link preview card */}
        {post.content_type === 'link' && post.link_url && (
          <a
            href={post.link_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => {
              e.stopPropagation()
            }}
            className="mt-3 flex items-center gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-hover)] p-3 transition-all hover:border-[var(--border-default)] hover:bg-[var(--bg-surface)]"
          >
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--bg-void)] text-[var(--text-muted)]">
              <Icon name="link" size="lg" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-[var(--text-primary)]">
                {new URL(post.link_url).hostname}
              </p>
              <p className="truncate text-xs text-[var(--text-muted)]">
                {post.link_url}
              </p>
            </div>
            <Icon
              name="external"
              size="sm"
              className="text-[var(--text-muted)]"
            />
          </a>
        )}
      </div>

      {/* Reactions & Stats */}
      <footer className="flex items-center justify-between border-t border-[var(--border-subtle)] pt-3">
        <div className="flex items-center gap-4">
          {/* Reaction Display (view-only) */}
          <div className="flex items-center gap-1">
            {DISPLAY_REACTIONS.map((type) => {
              const reactionInfo = REACTION_ICONS[type]
              if (!reactionInfo) return null
              const count = post.reactions?.[type]
              return (
                <span
                  key={type}
                  className={`flex items-center gap-1 rounded-full px-2 py-1 text-sm transition-transform hover:scale-105 ${post.user_reaction === type ? 'bg-primary-500/20 ring-primary-500 ring-1' : ''} `}
                  title={reactionInfo.label}
                >
                  <Icon
                    name={reactionInfo.icon}
                    color={reactionInfo.color}
                    size="sm"
                  />
                  {count && count > 0 && (
                    <span className="text-xs text-[var(--text-muted)]">
                      {count}
                    </span>
                  )}
                </span>
              )
            })}
          </div>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-4 text-sm text-[var(--text-muted)]">
          {/* Vote Score (Reddit-style) */}
          {(post.vote_score !== undefined ||
            post.upvote_count !== undefined) && (
            <span
              className={`flex items-center gap-1.5 ${
                (post.vote_score ?? 0) > 0
                  ? 'text-green-500'
                  : (post.vote_score ?? 0) < 0
                    ? 'text-red-500'
                    : ''
              }`}
              title={`${String(post.upvote_count ?? 0)} upvotes, ${String(post.downvote_count ?? 0)} downvotes`}
            >
              <Icon name="bolt" size="sm" />
              <span className="font-medium">{post.vote_score ?? 0}</span>
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <Icon name="comment" size="sm" />
            <span>{post.reply_count}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <Icon name="bolt" color="fire" size="sm" />
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
