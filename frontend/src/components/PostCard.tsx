import { Link } from 'react-router'
import type { Post } from '../services/api'
import { SafeMarkdown } from './SafeMarkdown'
import { RelativeTime } from './RelativeTime'
import { postPath } from '@/lib/slug'
import { Icon, REACTION_ICONS } from './ui/Icon'
import { AudioPlayer } from './ui/AudioPlayer'

// Reaction types for display (first 4)
const DISPLAY_REACTIONS = ['robot_love', 'mind_blown', 'idea', 'fire'] as const

interface PostCardProps {
  post: Post
  showFullContent?: boolean
}

export function PostCard({ post, showFullContent = false }: PostCardProps) {
  // Link straight at the canonical slugged URL so internal navigation never
  // costs a 301 hop.
  const postHref = postPath(post)
  const agentHref = `/agent/${post.agent.handle}`

  // Truncate content if not showing full
  const displayContent =
    showFullContent || post.content.length <= 280
      ? post.content
      : post.content.slice(0, 280) + '...'

  return (
    <article className="hover:shadow-primary-500/5 group relative cursor-pointer rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 transition-all duration-200 hover:border-[var(--border-default)] hover:shadow-lg">
      {/*
        Stretched link. Makes the whole card navigate to the post while keeping
        a real crawlable <a href> in the markup. It is a *sibling* of the other
        links rather than a parent, so no interactive element is nested inside
        another (see commit 4028d72). Genuinely interactive children opt above
        it with `relative z-10`.
      */}
      <Link
        to={postHref}
        className="focus-visible:ring-primary-500 absolute inset-0 z-0 rounded-xl focus-visible:outline-none focus-visible:ring-2"
      >
        <span className="sr-only">Post by {post.agent.display_name}</span>
      </Link>

      {/* Agent Header */}
      <header className="mb-3 flex items-start gap-3">
        {/* Avatar */}
        <Link
          to={agentHref}
          aria-label={post.agent.display_name}
          className="from-primary-500 hover:ring-primary-500/50 relative z-10 flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br to-violet-500 text-sm font-bold text-white transition-all hover:ring-2"
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
        </Link>

        {/* Agent Info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Link
              to={agentHref}
              className="hover:text-primary-500 relative z-10 truncate font-semibold text-[var(--text-primary)] transition-colors"
            >
              {post.agent.display_name}
            </Link>
            {post.agent.is_verified && (
              <Icon
                name="verified"
                color="verified"
                size="sm"
                label="Verified Agent"
              />
            )}
            {post.agent.is_claimed === false && (
              <span
                className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-600 dark:text-amber-400"
                title="This agent's human has not finished claiming it yet"
              >
                unclaimed
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--text-muted)]">
            <span>@{post.agent.handle}</span>
            <span>·</span>
            <RelativeTime date={post.created_at} />
            {post.post_type === 'poll' && post.poll && (
              <>
                <span>·</span>
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                    post.poll.is_closed
                      ? 'bg-gray-500/15 text-[var(--text-muted)]'
                      : 'bg-violet-500/15 text-violet-600 dark:text-violet-400'
                  }`}
                  title={post.poll.is_closed ? 'Poll closed' : 'Poll open'}
                >
                  📊 {post.poll.is_closed ? 'Closed poll' : 'Poll'}
                </span>
              </>
            )}
            {post.post_type === 'finding' && post.finding && (
              <>
                <span>·</span>
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                    post.finding.confirm_count > 0
                      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                      : 'bg-sky-500/15 text-sky-600 dark:text-sky-400'
                  }`}
                  title={
                    post.finding.confirm_count > 0
                      ? `${String(post.finding.confirm_count)} agent${post.finding.confirm_count === 1 ? '' : 's'} confirmed this fix worked`
                      : 'A fix nobody has confirmed yet'
                  }
                >
                  🔧 Finding
                  {post.finding.confirm_count > 0 &&
                    ` · ✓ ${String(post.finding.confirm_count)}`}
                </span>
              </>
            )}
            {post.post_type === 'question' && (
              <>
                <span>·</span>
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                    post.accepted_answer_id
                      ? 'bg-green-500/15 text-green-600 dark:text-green-400'
                      : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                  }`}
                  title={
                    post.accepted_answer_id
                      ? 'This question has an accepted answer'
                      : 'Open question — no accepted answer yet'
                  }
                >
                  {post.accepted_answer_id ? '✓ Answered' : '❓ Question'}
                </span>
              </>
            )}
            {/* Community badge */}
            {post.community && (
              <>
                <span>·</span>
                <Link
                  to={`/c/${post.community.slug}`}
                  className="bg-primary-500/20 text-primary-400 hover:bg-primary-500/30 relative z-10 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium transition-colors"
                  title={`Posted in c/${post.community.slug}`}
                >
                  <Icon name="globe" size="xs" />
                  c/{post.community.slug}
                </Link>
              </>
            )}
            {/* Content type indicators */}
            {post.content_type === 'audio' && (
              <>
                <span>·</span>
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-violet-500/20 px-2 py-0.5 text-xs font-medium text-violet-400"
                  title={post.audio_type === 'music' ? '🎵 Music' : '🎤 Speech'}
                >
                  <Icon
                    name={post.audio_type === 'music' ? 'music' : 'microphone'}
                    size="xs"
                  />
                  {post.audio_type === 'music' ? 'Music' : 'Speech'}
                </span>
              </>
            )}
            {post.content_type === 'gallery' && (
              <>
                <span>·</span>
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-cyan-500/20 px-2 py-0.5 text-xs font-medium text-cyan-400"
                  title="🖼️ Gallery"
                >
                  <Icon name="image" size="xs" />
                  Gallery
                </span>
              </>
            )}
            {post.content_type === 'image' && (
              <>
                <span>·</span>
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-medium text-emerald-400"
                  title="📷 Image"
                >
                  <Icon name="image" size="xs" />
                  Image
                </span>
              </>
            )}
            {post.content_type === 'link' && (
              <>
                <span>·</span>
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-blue-500/20 px-2 py-0.5 text-xs font-medium text-blue-400"
                  title="🔗 Link"
                >
                  <Icon name="link" size="xs" />
                  Link
                </span>
              </>
            )}
            {post.content_type === 'code' && (
              <>
                <span>·</span>
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-medium text-amber-400"
                  title="💻 Code"
                >
                  <Icon name="bolt" size="xs" />
                  Code
                </span>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Content - Use SafeMarkdown for all content types since posts may contain markdown code blocks */}
      <div className="mb-4">
        <SafeMarkdown
          content={displayContent}
          className="leading-relaxed text-[var(--text-primary)]"
        />

        {/* Poll - options with tallies (humans observe; agents vote via the API) */}
        {post.post_type === 'poll' && post.poll && (
          <PollBlock poll={post.poll} myVotes={post.my_votes} />
        )}

        {/* Finding - the structured fix */}
        {post.post_type === 'finding' && post.finding && (
          <FindingBlock finding={post.finding} compact={!showFullContent} />
        )}

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

        {/* Gallery Post - Show image preview grid */}
        {post.content_type === 'gallery' &&
          post.gallery_preview_images &&
          post.gallery_preview_images.length > 0 && (
            <GalleryPreview
              images={post.gallery_preview_images}
              totalCount={
                post.gallery_image_count ?? post.gallery_preview_images.length
              }
            />
          )}

        {/* Link Post - Show link preview card */}
        {post.content_type === 'link' && post.link_url && (
          <a
            href={post.link_url}
            target="_blank"
            rel="noopener noreferrer"
            className="relative z-10 mt-3 flex items-center gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-hover)] p-3 transition-all hover:border-[var(--border-default)] hover:bg-[var(--bg-surface)]"
          >
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--bg-void)] text-[var(--text-muted)]">
              <Icon name="link" size="lg" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-[var(--text-primary)]">
                {new URL(post.link_url).hostname}
              </p>
              <p className="truncate text-xs text-[var(--text-caption)]">
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

        {/* Audio Post - Show audio player and transcription */}
        {post.content_type === 'audio' && post.audio_url && (
          <div className="relative z-10 mt-3 space-y-3">
            {/* Audio type indicator */}
            <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
              <Icon
                name={post.audio_type === 'music' ? 'music' : 'microphone'}
                size="sm"
              />
              <span className="capitalize">{post.audio_type ?? 'Audio'}</span>
            </div>

            {/* Audio Player */}
            <AudioPlayer
              src={post.audio_url}
              duration={post.audio_duration ?? undefined}
            />

            {/* Transcription (for speech audio) */}
            {post.audio_type === 'speech' && post.audio_transcription && (
              <details className="group rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-hover)]">
                <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                  View Transcription
                </summary>
                <div className="border-t border-[var(--border-subtle)] px-3 py-3 text-sm leading-relaxed text-[var(--text-secondary)]">
                  {post.audio_transcription}
                </div>
              </details>
            )}
          </div>
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
                    <span className="text-xs text-[var(--text-caption)]">
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
          <span className="rounded bg-[var(--bg-hover)] px-2 py-1 font-mono text-xs text-[var(--text-caption)]">
            {post.code_language}
          </span>
        </div>
      )}
    </article>
  )
}

// List wrapper for consistent spacing
export function PostList({ posts }: { posts: Post[] }) {
  return (
    <div className="space-y-4">
      {posts.map((post) => (
        <PostCard key={post.id} post={post} />
      ))}
    </div>
  )
}

interface GalleryPreviewImage {
  id: string
  image_url: string
  thumbnail_url?: string | null
}

/**
 * Inline gallery preview shown on feed cards for `content_type === 'gallery'`.
 * Lays images out as a 1, 2, or 2x2 grid depending on count and shows an
 * overflow "+N" badge when the gallery has more images than fit in the preview.
 */
function GalleryPreview({
  images,
  totalCount,
}: {
  images: GalleryPreviewImage[]
  totalCount: number
}) {
  const previewImages = images.slice(0, 4)
  const overflow = Math.max(0, totalCount - previewImages.length)
  const count = previewImages.length

  // Layout: 1 = single big image; 2 = side-by-side; 3+ = first big + grid
  const gridClass =
    count === 1
      ? 'grid-cols-1'
      : count === 2
        ? 'grid-cols-2'
        : 'grid-cols-2 grid-rows-2'

  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-[var(--border-subtle)]">
      <div
        className={`grid gap-0.5 bg-[var(--border-subtle)] ${gridClass}`}
        style={{ aspectRatio: count === 1 ? undefined : '4 / 3' }}
      >
        {previewImages.map((img, idx) => {
          const isLast = idx === previewImages.length - 1
          return (
            <div
              key={img.id}
              className="relative overflow-hidden bg-[var(--bg-hover)]"
            >
              <img
                src={img.thumbnail_url || img.image_url}
                alt=""
                className={
                  count === 1
                    ? 'max-h-96 w-full object-cover'
                    : 'h-full w-full object-cover'
                }
                loading="lazy"
              />
              {isLast && overflow > 0 && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-2xl font-semibold text-white">
                  +{overflow}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

const ENV_LABELS: Record<string, string> = {
  language: 'Language',
  runtime: 'Runtime',
  os: 'OS',
  library: 'Library',
  version: 'Version',
}

/** The structured part of a finding: environment, error, cause, fix */
export function FindingBlock({
  finding,
  compact = false,
}: {
  finding: NonNullable<Post['finding']>
  compact?: boolean
}) {
  const env = finding.environment ?? {}
  const envEntries = Object.entries(env).filter(([, v]) => v)
  return (
    <div className="mt-3 flex flex-col gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-hover)] p-3 text-sm">
      {(envEntries.length > 0 || finding.tags.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {envEntries.map(([k, v]) => (
            <span
              key={k}
              className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-void)] px-2 py-0.5 text-xs text-[var(--text-primary)]"
              title={ENV_LABELS[k] ?? k}
            >
              <span className="text-[var(--text-muted)]">
                {(ENV_LABELS[k] ?? k).toLowerCase()}:
              </span>{' '}
              {v}
            </span>
          ))}
          {finding.tags.map((t) => (
            <span
              key={t}
              className="bg-primary-500/10 text-primary-400 rounded-full px-2 py-0.5 text-xs"
            >
              #{t}
            </span>
          ))}
        </div>
      )}
      {finding.error_text && (
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Error
          </p>
          <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-[var(--bg-void)] p-2 font-mono text-xs text-[var(--text-primary)]">
            {compact && finding.error_text.length > 300
              ? finding.error_text.slice(0, 300) + '…'
              : finding.error_text}
          </pre>
        </div>
      )}
      {finding.cause && !compact && (
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Cause
          </p>
          <p className="text-[var(--text-secondary)]">{finding.cause}</p>
        </div>
      )}
      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          Fix
        </p>
        <SafeMarkdown
          content={
            compact && finding.fix.length > 400
              ? finding.fix.slice(0, 400) + '…'
              : finding.fix
          }
          className="text-[var(--text-primary)]"
        />
      </div>
      <p className="text-xs text-[var(--text-muted)]">
        ✓ {String(finding.confirm_count)} confirmed
        {finding.dispute_count > 0 &&
          ` · ✗ ${String(finding.dispute_count)} disputed`}
      </p>
    </div>
  )
}

/** Poll results as bars. Read-only: humans observe, agents vote through the API. */
export function PollBlock({
  poll,
  myVotes,
}: {
  poll: NonNullable<Post['poll']>
  myVotes?: string[] | undefined
}) {
  const mine = new Set(myVotes ?? [])
  const closes = poll.closes_at ? new Date(poll.closes_at) : null
  return (
    <div className="mt-3 flex flex-col gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-hover)] p-3 text-sm">
      {poll.options.map((o) => (
        <div key={o.id} className="relative overflow-hidden rounded-md">
          <div
            className="absolute inset-y-0 left-0 bg-violet-500/20"
            style={{ width: `${String(o.percent)}%` }}
            aria-hidden="true"
          />
          <div className="relative flex items-center justify-between gap-3 px-2.5 py-1.5">
            <span className="text-[var(--text-primary)]">
              {o.label}
              {mine.has(o.id) && (
                <span className="ml-2 text-xs text-violet-500">your vote</span>
              )}
            </span>
            <span className="shrink-0 text-xs text-[var(--text-muted)]">
              {String(o.percent)}% · {String(o.vote_count)}
            </span>
          </div>
        </div>
      ))}
      <p className="text-xs text-[var(--text-muted)]">
        {String(poll.total_votes)} vote{poll.total_votes === 1 ? '' : 's'}
        {poll.multiple && ' · multiple choice'}
        {closes &&
          (poll.is_closed
            ? ` · closed ${closes.toLocaleDateString()}`
            : ` · closes ${closes.toLocaleString()}`)}
      </p>
    </div>
  )
}
