import { useState } from 'react'
import type { Embed, LinkPreview } from '../services/api'
import { Icon } from './ui/Icon'
import { providerLabel } from '@/lib/media'

/**
 * Rich media blocks shared by the feed card and the post page:
 *
 * - VideoPlayer: a native <video> for content_type === 'video'
 * - EmbedFrame: the player for a post's link (YouTube, Spotify, a direct
 *   .mp4, ...). Third-party iframes load only after a click, so a feed full
 *   of embeds costs nothing until the reader wants one and no third party
 *   sees the reader until then.
 * - LinkPreviewCard: the Open Graph card for a post's link
 *
 * Every block opts above a card's stretched link with `relative z-10`.
 */

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

// =============================================================================
// Video
// =============================================================================

export function VideoPlayer({
  src,
  poster,
  className = '',
}: {
  src: string
  poster?: string | null | undefined
  className?: string
}) {
  return (
    <div
      className={`relative z-10 overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-black ${className}`}
    >
      <video
        src={src}
        poster={poster ?? undefined}
        controls
        playsInline
        preload="metadata"
        className="max-h-[32rem] w-full"
      >
        <a href={src}>Download video</a>
      </video>
    </div>
  )
}

/** Collapsible transcript, shared by audio and video posts */
export function Transcript({
  text,
  label = 'Transcript',
}: {
  text: string
  label?: string
}) {
  return (
    <details className="group relative z-10 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-hover)]">
      <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
        <Icon name="comment" size="sm" />
        <span>{label}</span>
      </summary>
      <div className="whitespace-pre-wrap border-t border-[var(--border-subtle)] px-3 py-3 text-sm leading-relaxed text-[var(--text-secondary)]">
        {text}
      </div>
    </details>
  )
}

// =============================================================================
// Embeds
// =============================================================================

/**
 * The player for a post's link. Direct media files render natively; third
 * party players show a poster (the link preview image when there is one)
 * until clicked.
 */
export function EmbedFrame({
  embed,
  preview,
  className = '',
}: {
  embed: Embed
  preview?: LinkPreview | null | undefined
  className?: string
}) {
  const [loaded, setLoaded] = useState(false)

  if (embed.kind === 'video') {
    return <VideoPlayer src={embed.url} className={className} />
  }
  if (embed.kind === 'audio') {
    return (
      <div className={`relative z-10 ${className}`}>
        <audio src={embed.url} controls preload="metadata" className="w-full">
          <a href={embed.url}>Download audio</a>
        </audio>
      </div>
    )
  }
  if (embed.kind === 'image') {
    return (
      <a
        href={preview?.url ?? embed.url}
        target="_blank"
        rel="noopener noreferrer"
        className={`relative z-10 block overflow-hidden rounded-lg border border-[var(--border-subtle)] ${className}`}
      >
        <img
          src={embed.url}
          alt={preview?.title ?? ''}
          className="max-h-96 w-full object-cover"
          loading="lazy"
        />
      </a>
    )
  }

  // iframe: sized by aspect ratio (video) or fixed height (audio widgets)
  const style = embed.aspect_ratio
    ? { aspectRatio: String(embed.aspect_ratio) }
    : { height: `${String(embed.height ?? 400)}px` }
  const label = providerLabel(embed.provider)
  const title = preview?.title ?? `${label} embed`

  return (
    <div
      className={`relative z-10 overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-black ${className}`}
      style={style}
    >
      {loaded ? (
        <iframe
          src={embed.url}
          title={title}
          className="h-full w-full"
          loading="lazy"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation allow-forms"
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            setLoaded(true)
          }}
          className="group/embed absolute inset-0 flex h-full w-full items-center justify-center bg-[var(--bg-hover)] text-left"
          aria-label={`Play ${title} (loads ${label})`}
        >
          {preview?.image_url && (
            <img
              src={preview.image_url}
              alt=""
              className="absolute inset-0 h-full w-full object-cover opacity-90 transition-opacity group-hover/embed:opacity-100"
              loading="lazy"
            />
          )}
          <span className="relative flex items-center gap-3 rounded-full bg-black/70 py-2 pl-3 pr-4 text-sm font-medium text-white shadow-lg backdrop-blur transition-transform group-hover/embed:scale-105">
            <span className="bg-primary-500 flex h-9 w-9 items-center justify-center rounded-full">
              <Icon name="play" size="sm" />
            </span>
            <span className="flex flex-col leading-tight">
              <span className="max-w-[16rem] truncate">{title}</span>
              <span className="text-xs font-normal text-white/70">
                {label} · click to load
              </span>
            </span>
          </span>
        </button>
      )}
    </div>
  )
}

// =============================================================================
// Link preview card
// =============================================================================

export function LinkPreviewCard({
  preview,
  className = '',
}: {
  preview: LinkPreview
  className?: string
}) {
  const host = hostOf(preview.url)
  return (
    <a
      href={preview.url}
      target="_blank"
      rel="noopener noreferrer"
      className={`relative z-10 flex overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-hover)] transition-all hover:border-[var(--border-default)] hover:bg-[var(--bg-surface)] ${className}`}
    >
      {preview.image_url ? (
        <div className="hidden w-32 flex-shrink-0 bg-[var(--bg-void)] sm:block md:w-40">
          <img
            src={preview.image_url}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
        </div>
      ) : (
        <div className="flex w-14 flex-shrink-0 items-center justify-center bg-[var(--bg-void)] text-[var(--text-muted)]">
          <Icon name="link" size="lg" />
        </div>
      )}
      <div className="min-w-0 flex-1 p-3">
        <p className="truncate text-xs uppercase tracking-wide text-[var(--text-caption)]">
          {preview.site_name ?? host}
        </p>
        <p className="line-clamp-2 text-sm font-semibold text-[var(--text-primary)]">
          {preview.title ?? preview.url}
        </p>
        {preview.description && (
          <p className="mt-1 line-clamp-2 text-xs text-[var(--text-secondary)]">
            {preview.description}
          </p>
        )}
        <p className="mt-1 flex items-center gap-1 truncate text-xs text-[var(--text-muted)]">
          <Icon name="external" size="xs" />
          {host}
        </p>
      </div>
    </a>
  )
}

/**
 * A post's link, rendered as a player when there is one and a card
 * otherwise. Returns null when the post has neither.
 */
export function LinkBlock({
  embed,
  preview,
  className = '',
}: {
  embed?: Embed | null | undefined
  preview?: LinkPreview | null | undefined
  className?: string
}) {
  if (embed) {
    return (
      <div className={className}>
        <EmbedFrame embed={embed} preview={preview} />
        {preview && (preview.title ?? preview.description) && (
          <a
            href={preview.url}
            target="_blank"
            rel="noopener noreferrer"
            className="relative z-10 mt-2 flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            <Icon name="external" size="xs" />
            <span className="truncate">
              {preview.title ?? preview.url}
              {preview.site_name ? ` · ${preview.site_name}` : ''}
            </span>
          </a>
        )}
      </div>
    )
  }
  if (preview) {
    return <LinkPreviewCard preview={preview} className={className} />
  }
  return null
}
