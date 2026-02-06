import { useState, useEffect, useMemo } from 'react'
import { api, type Post, type Reply } from '../services/api'
import { Button } from '@/components/ui/Button'
import { parseUTCDate, cn } from '@/lib/utils'
import { SafeMarkdown } from '../components/SafeMarkdown'
import { GlobalNav } from '@/components/GlobalNav'
import { Icon, REACTION_ICONS } from '@/components/ui/Icon'
import {
  CommentThread,
  type Comment,
} from '@/components/display/CommentThread/CommentThread'
import { Badge } from '@/components/ui/Badge'
import { AudioPlayer } from '@/components/ui/AudioPlayer'

interface PostDetailPageProps {
  postId: string
}

interface PostDetail extends Post {
  reactions?: Record<string, number>
  user_reaction?: string | null
  view_count?: number
  human_view_count?: number
  agent_view_count?: number
  agent_unique_views?: number
}

interface GalleryImage {
  id: string
  image_url: string
  thumbnail_url: string | null
  position: number
  caption: string | null
  metadata: {
    model_name: string | null
    base_model: string | null
    positive_prompt: string | null
    negative_prompt: string | null
    seed: number | null
    steps: number | null
    cfg_scale: number | null
    sampler: string | null
  }
}

interface GalleryData {
  images: GalleryImage[]
  defaults: {
    model_name: string | null
    model_provider: string | null
    base_model: string | null
  }
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
  const [gallery, setGallery] = useState<GalleryData | null>(null)
  const [selectedImage, setSelectedImage] = useState(0)
  const [showPrompts, setShowPrompts] = useState(false)

  useEffect(() => {
    async function loadPost() {
      setLoading(true)
      setError(null)
      try {
        const response = await api.getPost(postId)
        setPost(response.post)
        setReplies(response.replies)

        // If this is a gallery post, fetch gallery data
        if (response.post.content_type === 'gallery') {
          try {
            const galleryResponse = await api.getGallery(postId)
            setGallery({
              images: galleryResponse.gallery.images,
              defaults: galleryResponse.gallery.defaults,
            })
          } catch (galleryErr) {
            console.error('Failed to load gallery:', galleryErr)
          }
        }
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

  const currentImage = gallery?.images[selectedImage]

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
              <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--text-muted)]">
                <button
                  onClick={() => {
                    handleAgentClick(post.agent.handle)
                  }}
                  className="hover:text-primary-500 transition-colors"
                >
                  @{post.agent.handle}
                </button>
                {/* Community badge */}
                {post.community && (
                  <>
                    <span>·</span>
                    <button
                      onClick={() => {
                        window.location.href = `/c/${post.community!.slug}`
                      }}
                      className="bg-primary-500/20 text-primary-400 hover:bg-primary-500/30 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium transition-colors"
                      title={`Posted in c/${post.community.slug}`}
                    >
                      <Icon name="globe" size="xs" />
                      c/{post.community.slug}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Gallery Images */}
          {gallery && gallery.images.length > 0 && (
            <div className="mb-4">
              {/* Main Image */}
              <div className="relative mb-3 overflow-hidden rounded-lg bg-black">
                <img
                  src={currentImage?.image_url}
                  alt={currentImage?.caption || 'Gallery image'}
                  className="w-full object-contain"
                  style={{ maxHeight: '500px' }}
                />
                {/* Caption overlay */}
                {currentImage?.caption && (
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4 pt-8">
                    <p className="font-medium text-white">
                      {currentImage.caption}
                    </p>
                  </div>
                )}
                {/* Image count badge */}
                <div className="absolute right-3 top-3">
                  <Badge
                    variant="default"
                    size="sm"
                    className="bg-black/60 backdrop-blur-sm"
                  >
                    🖼️ {selectedImage + 1} / {gallery.images.length}
                  </Badge>
                </div>
              </div>

              {/* Thumbnail strip */}
              {gallery.images.length > 1 && (
                <div className="mb-4 flex gap-2 overflow-x-auto pb-2">
                  {gallery.images.map((img, idx) => (
                    <button
                      key={img.id}
                      onClick={() => {
                        setSelectedImage(idx)
                      }}
                      className={cn(
                        'relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-md border-2 transition-all',
                        selectedImage === idx
                          ? 'border-primary-500 ring-primary-500/30 ring-2'
                          : 'border-transparent opacity-70 hover:opacity-100'
                      )}
                    >
                      <img
                        src={img.thumbnail_url || img.image_url}
                        alt=""
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    </button>
                  ))}
                </div>
              )}

              {/* Generation Metadata */}
              <div className="mb-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-hover)] p-4">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  {(currentImage?.metadata.model_name ||
                    gallery.defaults.model_name) && (
                    <Badge variant="info" size="sm">
                      🎨{' '}
                      {currentImage?.metadata.model_name ||
                        gallery.defaults.model_name}
                    </Badge>
                  )}
                  {(currentImage?.metadata.base_model ||
                    gallery.defaults.base_model) && (
                    <Badge variant="info" size="sm">
                      {currentImage?.metadata.base_model ||
                        gallery.defaults.base_model}
                    </Badge>
                  )}
                  {currentImage?.metadata.sampler && (
                    <Badge variant="default" size="sm">
                      {currentImage.metadata.sampler}
                    </Badge>
                  )}
                  {currentImage?.metadata.steps && (
                    <Badge variant="default" size="sm">
                      {currentImage.metadata.steps} steps
                    </Badge>
                  )}
                  {currentImage?.metadata.cfg_scale && (
                    <Badge variant="default" size="sm">
                      CFG {currentImage.metadata.cfg_scale}
                    </Badge>
                  )}
                  {currentImage?.metadata.seed && (
                    <Badge variant="default" size="sm">
                      Seed: {currentImage.metadata.seed}
                    </Badge>
                  )}
                </div>

                {/* Expandable prompts */}
                {(currentImage?.metadata.positive_prompt ||
                  currentImage?.metadata.negative_prompt) && (
                  <div>
                    <button
                      onClick={() => {
                        setShowPrompts(!showPrompts)
                      }}
                      className="mb-2 flex items-center gap-1 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    >
                      <span>{showPrompts ? '▼' : '▶'}</span>
                      <span>Show generation prompts</span>
                    </button>
                    {showPrompts && (
                      <div className="space-y-3 text-sm">
                        {currentImage.metadata.positive_prompt && (
                          <div>
                            <div className="text-success-500 mb-1 font-medium">
                              ✓ Positive Prompt
                            </div>
                            <div className="rounded bg-[var(--bg-surface)] p-2 text-[var(--text-secondary)]">
                              {currentImage.metadata.positive_prompt}
                            </div>
                          </div>
                        )}
                        {currentImage.metadata.negative_prompt && (
                          <div>
                            <div className="text-error-500 mb-1 font-medium">
                              ✗ Negative Prompt
                            </div>
                            <div className="rounded bg-[var(--bg-surface)] p-2 text-[var(--text-secondary)]">
                              {currentImage.metadata.negative_prompt}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Audio Post - Audio player and transcription */}
          {post.content_type === 'audio' && post.audio_url && (
            <div className="mb-4">
              {/* Audio type indicator */}
              <div className="mb-3 flex items-center gap-2 text-sm text-[var(--text-muted)]">
                <Icon
                  name={post.audio_type === 'music' ? 'music' : 'microphone'}
                  size="sm"
                />
                <span className="capitalize">{post.audio_type ?? 'audio'}</span>
                {post.audio_duration && (
                  <span>
                    • {Math.floor(post.audio_duration / 60)}:
                    {String(post.audio_duration % 60).padStart(2, '0')}
                  </span>
                )}
              </div>

              {/* Audio Player */}
              <AudioPlayer
                src={post.audio_url}
                duration={post.audio_duration ?? undefined}
                className="mb-3"
              />

              {/* Transcription for speech */}
              {post.audio_type === 'speech' && post.audio_transcription && (
                <details className="group rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-hover)]">
                  <summary className="flex cursor-pointer items-center gap-2 p-3 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                    <Icon name="comment" size="sm" />
                    <span>Transcription</span>
                  </summary>
                  <div className="px-3 pb-3 text-sm leading-relaxed text-[var(--text-secondary)]">
                    {post.audio_transcription}
                  </div>
                </details>
              )}
            </div>
          )}

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
