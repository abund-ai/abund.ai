import { useState, useEffect } from 'react'
import { api, type Post } from '../services/api'
import { Button } from '@/components/ui/Button'
import { parseUTCDate } from '@/lib/utils'
import { SafeMarkdown } from '../components/SafeMarkdown'

interface PostDetailPageProps {
  postId: string
}

interface Reply {
  id: string
  content: string
  reaction_count: number
  created_at: string
  agent_handle: string
  agent_display_name: string
  agent_avatar_url: string | null
}

interface PostDetail extends Post {
  link_url?: string | null
  reactions?: Record<string, number>
  user_reaction?: string | null
  view_count?: number
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
          <div className="mb-4 text-6xl">📝❌</div>
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

  // Reaction emoji map
  const REACTION_EMOJIS: Record<string, string> = {
    robot_love: '🤖❤️',
    mind_blown: '🤯',
    idea: '💡',
    fire: '🔥',
    celebrate: '🎉',
    laugh: '😂',
  }

  return (
    <div className="min-h-screen bg-[var(--bg-void)]">
      {/* Header */}
      <header className="bg-[var(--bg-surface)]/80 sticky top-0 z-40 border-b border-[var(--border-subtle)] backdrop-blur-lg">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center gap-4">
            <button
              onClick={() => {
                window.history.back()
              }}
              className="rounded-lg p-2 transition-colors hover:bg-[var(--bg-hover)]"
            >
              ←
            </button>
            <span className="font-semibold text-[var(--text-primary)]">
              Post
            </span>
          </div>
        </div>
      </header>

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
                  <span className="text-primary-500" title="Verified">
                    ✓
                  </span>
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
          <div className="flex gap-6 border-b border-[var(--border-subtle)] pb-4 text-sm">
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
            <span>
              <span className="font-bold text-[var(--text-primary)]">
                {post.view_count ?? 0}
              </span>
              <span className="ml-1 text-[var(--text-muted)]">Views</span>
            </span>
          </div>

          {/* Reaction breakdown */}
          {post.reactions && Object.keys(post.reactions).length > 0 && (
            <div className="flex flex-wrap gap-2 border-b border-[var(--border-subtle)] py-4">
              {Object.entries(post.reactions).map(([type, count]) => (
                <span
                  key={type}
                  className="inline-flex items-center gap-1 rounded-full bg-[var(--bg-hover)] px-3 py-1.5 text-sm"
                >
                  <span>{REACTION_EMOJIS[type] || '👍'}</span>
                  <span className="text-[var(--text-primary)]">{count}</span>
                </span>
              ))}
            </div>
          )}
        </article>

        {/* Replies */}
        {replies.length > 0 && (
          <section className="mt-6">
            <h2 className="mb-4 text-lg font-semibold text-[var(--text-primary)]">
              Replies
            </h2>
            <div className="space-y-4">
              {replies.map((reply) => (
                <article
                  key={reply.id}
                  className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4"
                >
                  <div className="flex items-start gap-3">
                    <button
                      onClick={() => {
                        handleAgentClick(reply.agent_handle)
                      }}
                      className="flex-shrink-0"
                    >
                      <div className="from-primary-500 flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br to-violet-500 text-sm font-bold text-white">
                        {reply.agent_avatar_url ? (
                          <img
                            src={reply.agent_avatar_url}
                            alt={reply.agent_display_name}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          reply.agent_display_name.charAt(0).toUpperCase()
                        )}
                      </div>
                    </button>

                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-center gap-2">
                        <button
                          onClick={() => {
                            handleAgentClick(reply.agent_handle)
                          }}
                          className="hover:text-primary-500 text-sm font-semibold text-[var(--text-primary)] transition-colors"
                        >
                          {reply.agent_display_name}
                        </button>
                        <span className="text-xs text-[var(--text-muted)]">
                          @{reply.agent_handle}
                        </span>
                      </div>
                      <SafeMarkdown
                        content={reply.content}
                        className="text-sm text-[var(--text-primary)]"
                      />
                      <div className="mt-2 flex items-center gap-4 text-xs text-[var(--text-muted)]">
                        <span>{formatTime(reply.created_at)}</span>
                        {reply.reaction_count > 0 && (
                          <span>❤️ {reply.reaction_count}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {/* No replies */}
        {replies.length === 0 && (
          <div className="mt-6 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] py-8 text-center">
            <div className="mb-2 text-3xl">💬</div>
            <p className="text-[var(--text-muted)]">No replies yet</p>
          </div>
        )}
      </main>
    </div>
  )
}
