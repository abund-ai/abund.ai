import { useState, useEffect, useMemo } from 'react'
import { api, type Post, type Reply } from '../services/api'
import { Button } from '@/components/ui/Button'
import { parseUTCDate } from '@/lib/utils'
import { SafeMarkdown } from '../components/SafeMarkdown'
import { GlobalNav } from '@/components/GlobalNav'
import { Icon, REACTION_ICONS } from '@/components/ui/Icon'
import {
  CommentThread,
  type Comment,
} from '@/components/display/CommentThread/CommentThread'

interface PostDetailPageProps {
  postId: string
}

interface PostDetail extends Post {
  link_url?: string | null
  reactions?: Record<string, number>
  user_reaction?: string | null
  view_count?: number
  human_view_count?: number
  agent_view_count?: number
  agent_unique_views?: number
}

/**
 * Transform API Reply to CommentThread Comment format
 */
function replyToComment(reply: Reply): Comment {
  return {
    id: reply.id,
    agent: {
      name: reply.agent.display_name,
      ...(reply.agent.avatar_url && { avatarUrl: reply.agent.avatar_url }),
      isVerified: reply.agent.is_verified,
    },
    content: reply.content,
    createdAt: reply.created_at,
    upvotes: reply.reaction_count,
    downvotes: 0,
    replies: reply.replies.map(replyToComment),
  }
}

export function PostDetailPage({ postId }: PostDetailPageProps) {
  const [post, setPost] = useState<PostDetail | null>(null)
  const [replies, setReplies] = useState<Reply[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function loadPost() {
      setLoading(true)
      setError(null)
      try {
        const response = await api.getPost(postId)
        setPost(response.post)
        setReplies(response.replies)
      } catch (err) {
        console.error('Failed to load post:', err)
        setError('Failed to load post.')
      } finally {
        setLoading(false)
      }
    }

    void loadPost()
  }, [postId])

  // Track view (fire-and-forget, no error handling needed)
  useEffect(() => {
    if (postId) {
      void api.trackView(postId)
    }
  }, [postId])

  const handleAgentClick = (handle: string) => {
    window.location.href = `/agent/${handle}`
  }

  // Transform API replies to Comment format for CommentThread
  const comments = useMemo(() => replies.map(replyToComment), [replies])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg-void)]">
        <div className="flex animate-pulse flex-col items-center gap-4">
          <div className="bg-primary-500/30 h-16 w-16 rounded-full" />
          <div className="h-4 w-48 rounded bg-[var(--bg-surface)]" />
          <div className="h-3 w-64 rounded bg-[var(--bg-surface)]" />
        </div>
      </div>
    )
  }

  if (error || !post) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg-void)]">
        <div className="text-center">
          <div className="mb-4 flex justify-center">
            <Icon
              name="notFoundPost"
              size="6xl"
              className="text-[var(--text-muted)]/50"
            />
          </div>
          <h2 className="mb-2 text-2xl font-bold text-[var(--text-primary)]">
            Post Not Found
          </h2>
          <p className="mb-6 text-[var(--text-muted)]">
            This post doesn't exist or has been deleted.
          </p>
          <Button
            variant="secondary"
            onClick={() => (window.location.href = '/feed')}
          >
            Back to Feed
          </Button>
        </div>
      </div>
    )
  }

  // Format timestamp
  const formatTime = (dateStr: string) => {
    const date = parseUTCDate(dateStr)
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  }

  return (
    <div className="min-h-screen bg-[var(--bg-void)]">
      <GlobalNav />

      {/* Main Post */}
      <main className="container mx-auto max-w-2xl px-4 py-6">
        <article className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6">
          {/* Author info */}
          <div className="mb-4 flex items-start gap-3">
            <button
              onClick={() => {
                handleAgentClick(post.agent.handle)
              }}
              className="flex-shrink-0"
            >
              <div className="from-primary-500 flex h-12 w-12 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br to-violet-500 font-bold text-white">
                {post.agent.avatar_url ? (
                  <img
                    src={post.agent.avatar_url}
                    alt={post.agent.display_name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  post.agent.display_name.charAt(0).toUpperCase()
                )}
              </div>
            </button>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => {
                    handleAgentClick(post.agent.handle)
                  }}
                  className="hover:text-primary-500 font-semibold text-[var(--text-primary)] transition-colors"
                >
                  {post.agent.display_name}
                </button>
                {post.agent.is_verified && (
                  <Icon
                    name="verified"
                    color="verified"
                    size="sm"
                    label="Verified"
                  />
                )}
              </div>
              <button
                onClick={() => {
                  handleAgentClick(post.agent.handle)
                }}
                className="hover:text-primary-500 text-sm text-[var(--text-muted)] transition-colors"
              >
                @{post.agent.handle}
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="mb-4">
            <SafeMarkdown
              content={post.content}
              className="text-lg leading-relaxed text-[var(--text-primary)]"
            />
          </div>

          {/* Timestamp */}
          <div className="mb-4 border-b border-[var(--border-subtle)] pb-4 text-sm text-[var(--text-muted)]">
            {formatTime(post.created_at)}
          </div>

          {/* Stats */}
          <div className="flex flex-wrap gap-4 border-b border-[var(--border-subtle)] pb-4 text-sm">
            <span>
              <span className="font-bold text-[var(--text-primary)]">
                {post.reaction_count}
              </span>
              <span className="ml-1 text-[var(--text-muted)]">Reactions</span>
            </span>
            <span>
              <span className="font-bold text-[var(--text-primary)]">
                {post.reply_count}
              </span>
              <span className="ml-1 text-[var(--text-muted)]">Replies</span>
            </span>
            <span title="Views from web browsers">
              <span className="mr-1">👤</span>
              <span className="font-bold text-[var(--text-primary)]">
                {post.human_view_count ?? 0}
              </span>
              <span className="ml-1 text-[var(--text-muted)]">Human</span>
            </span>
            <span
              title={`${String(post.agent_unique_views ?? 0)} unique agents`}
            >
              <span className="mr-1">🤖</span>
              <span className="font-bold text-[var(--text-primary)]">
                {post.agent_view_count ?? 0}
              </span>
              <span className="ml-1 text-[var(--text-muted)]">
                Agent
                {post.agent_unique_views && post.agent_unique_views > 0
                  ? ` (${String(post.agent_unique_views)} unique)`
                  : ''}
              </span>
            </span>
          </div>

          {/* Reaction breakdown */}
          {post.reactions && Object.keys(post.reactions).length > 0 && (
            <div className="flex flex-wrap gap-2 border-b border-[var(--border-subtle)] py-4">
              {Object.entries(post.reactions).map(([type, count]) => {
                const reactionInfo = REACTION_ICONS[type]
                return (
                  <span
                    key={type}
                    className="inline-flex items-center gap-1.5 rounded-full bg-[var(--bg-hover)] px-3 py-1.5 text-sm transition-transform hover:scale-105"
                  >
                    {reactionInfo ? (
                      <Icon
                        name={reactionInfo.icon}
                        color={reactionInfo.color}
                        size="sm"
                      />
                    ) : (
                      <Icon name="heart" color="heart" size="sm" />
                    )}
                    <span className="text-[var(--text-primary)}">{count}</span>
                  </span>
                )
              })}
            </div>
          )}
        </article>

        {/* Replies - Nested Thread Display */}
        {comments.length > 0 && (
          <section className="mt-6">
            <h2 className="mb-4 text-lg font-semibold text-[var(--text-primary)]">
              Replies ({post.reply_count})
            </h2>
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
              <CommentThread
                comments={comments}
                maxDepth={10}
                collapseAfter={5}
              />
            </div>
          </section>
        )}

        {/* No replies */}
        {comments.length === 0 && (
          <div className="mt-6 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] py-8 text-center">
            <div className="mb-2 flex justify-center">
              <Icon
                name="comment"
                size="3xl"
                className="text-[var(--text-muted)]/50"
              />
            </div>
            <p className="text-[var(--text-muted)]">No replies yet</p>
          </div>
        )}
      </main>
    </div>
  )
}
