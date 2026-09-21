/**
 * Post enrichment
 *
 * Feed-style endpoints hand-roll their serialization; the per-type extras
 * (gallery previews, finding detail, media and link previews) are fetched in
 * one batched query per page and spread into each post, the same way
 * lib/galleries.ts works.
 */

import type { D1Database } from '@cloudflare/workers-types'
import { query } from './db'
import { isClosed } from './polls'
import {
  embedFromRow,
  previewFromRow,
  type Embed,
  type LinkPreview,
  type PreviewRow,
} from './unfurl'

export interface FindingFields {
  environment: Record<string, string> | null
  error_text: string | null
  cause: string | null
  fix: string
  tags: string[]
  confirm_count: number
  dispute_count: number
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/** Finding detail for every finding among the given posts, keyed by post id */
export async function fetchFindingFieldsFor(
  db: D1Database,
  posts: Array<{ id: string; post_type?: string | null }>
): Promise<Map<string, FindingFields>> {
  const out = new Map<string, FindingFields>()
  // Rows that did not select post_type are checked anyway (one IN query)
  const ids = posts
    .filter((p) => p.post_type === undefined || p.post_type === 'finding')
    .map((p) => p.id)
  if (ids.length === 0) return out
  const rows = await query<{
    post_id: string
    environment: string | null
    error_text: string | null
    cause: string | null
    fix: string
    tags: string
    confirm_count: number
    dispute_count: number
  }>(
    db,
    `SELECT post_id, environment, error_text, cause, fix, tags, confirm_count, dispute_count
     FROM finding_details WHERE post_id IN (${ids.map(() => '?').join(',')})`,
    ids
  )
  for (const r of rows) {
    out.set(r.post_id, {
      environment: parseJson<Record<string, string> | null>(
        r.environment,
        null
      ),
      error_text: r.error_text,
      cause: r.cause,
      fix: r.fix,
      tags: parseJson<string[]>(r.tags, []),
      confirm_count: r.confirm_count,
      dispute_count: r.dispute_count,
    })
  }
  return out
}

/** Spread into a serialized post: `finding` when the post is one */
export function findingFields(
  f: FindingFields | undefined
): { finding: FindingFields } | Record<string, never> {
  return f ? { finding: f } : {}
}

// =============================================================================
// Polls
// =============================================================================

export interface PollOptionFields {
  id: string
  label: string
  position: number
  vote_count: number
  /** Share of voters, 0-100 (a voter may count for several options) */
  percent: number
}

export interface PollFields {
  options: PollOptionFields[]
  total_votes: number
  closes_at: string | null
  is_closed: boolean
  multiple: boolean
}

/** Options and tallies for every poll among the given posts, keyed by post id */
export async function fetchPollFieldsFor(
  db: D1Database,
  posts: Array<{ id: string; post_type?: string | null }>
): Promise<Map<string, PollFields>> {
  const out = new Map<string, PollFields>()
  const ids = posts
    .filter((p) => p.post_type === undefined || p.post_type === 'poll')
    .map((p) => p.id)
  if (ids.length === 0) return out
  const placeholders = ids.map(() => '?').join(',')
  const [details, options] = await Promise.all([
    query<{
      post_id: string
      closes_at: string | null
      multiple: number
      total_votes: number
    }>(
      db,
      `SELECT post_id, closes_at, multiple, total_votes FROM poll_details WHERE post_id IN (${placeholders})`,
      ids
    ),
    query<{
      id: string
      post_id: string
      position: number
      label: string
      vote_count: number
    }>(
      db,
      `SELECT id, post_id, position, label, vote_count FROM poll_options
       WHERE post_id IN (${placeholders}) ORDER BY post_id, position ASC`,
      ids
    ),
  ])
  for (const d of details) {
    const opts = options.filter((o) => o.post_id === d.post_id)
    out.set(d.post_id, {
      options: opts.map((o) => ({
        id: o.id,
        label: o.label,
        position: o.position,
        vote_count: o.vote_count,
        percent:
          d.total_votes > 0
            ? Math.round((o.vote_count / d.total_votes) * 100)
            : 0,
      })),
      total_votes: d.total_votes,
      closes_at: d.closes_at,
      is_closed: isClosed(d.closes_at),
      multiple: Boolean(d.multiple),
    })
  }
  return out
}

/** Spread into a serialized post: `poll` when the post is one */
export function pollFields(
  p: PollFields | undefined
): { poll: PollFields } | Record<string, never> {
  return p ? { poll: p } : {}
}

// =============================================================================
// Media: image, audio, video, link preview, embed
// =============================================================================

export interface MediaFields {
  image_url: string | null
  link_url: string | null
  audio_url: string | null
  audio_type: string | null
  audio_transcription: string | null
  audio_duration: number | null
  video_url: string | null
  video_poster_url: string | null
  video_duration: number | null
  video_transcription: string | null
  /** Open Graph card for the post's link, once unfurled */
  link_preview: LinkPreview | null
  /** Player for the post's link (YouTube, Spotify, a direct .mp4, ...) */
  embed: Embed | null
}

/**
 * Media for every post in a page, in one query: the per-type columns on
 * `posts` plus the unfurled `link_previews` row. Feed-style serializers
 * spread the result so image, audio, video and link cards render inline.
 */
export async function fetchMediaFieldsFor(
  db: D1Database,
  posts: Array<{ id: string }>
): Promise<Map<string, MediaFields>> {
  const out = new Map<string, MediaFields>()
  const ids = posts.map((p) => p.id)
  if (ids.length === 0) return out
  const rows = await query<
    {
      id: string
      image_url: string | null
      link_url: string | null
      audio_url: string | null
      audio_type: string | null
      audio_transcription: string | null
      audio_duration: number | null
      video_url: string | null
      video_poster_url: string | null
      video_duration: number | null
      video_transcription: string | null
      preview_url: string | null
      preview_image_url: string | null
    } & Partial<Omit<PreviewRow, 'image_url'>>
  >(
    db,
    `SELECT p.id, p.image_url, p.link_url,
            p.audio_url, p.audio_type, p.audio_transcription, p.audio_duration,
            p.video_url, p.video_poster_url, p.video_duration, p.video_transcription,
            p.preview_url,
            lp.url, lp.status, lp.title, lp.description, lp.image_url AS preview_image_url,
            lp.site_name, lp.embed_provider, lp.embed_kind, lp.embed_url,
            lp.embed_aspect_ratio, lp.embed_height
     FROM posts p
     LEFT JOIN link_previews lp ON lp.url = p.preview_url
     WHERE p.id IN (${ids.map(() => '?').join(',')})`,
    ids
  )
  for (const r of rows) {
    const preview: PreviewRow | null = r.url
      ? {
          url: r.url,
          status: r.status ?? 'pending',
          title: r.title ?? null,
          description: r.description ?? null,
          image_url: r.preview_image_url,
          site_name: r.site_name ?? null,
          canonical_url: null,
          embed_provider: r.embed_provider ?? null,
          embed_kind: r.embed_kind ?? null,
          embed_url: r.embed_url ?? null,
          embed_aspect_ratio: r.embed_aspect_ratio ?? null,
          embed_height: r.embed_height ?? null,
          fetched_at: null,
        }
      : null
    out.set(r.id, {
      image_url: r.image_url,
      link_url: r.link_url,
      audio_url: r.audio_url,
      audio_type: r.audio_type,
      audio_transcription: r.audio_transcription,
      audio_duration: r.audio_duration,
      video_url: r.video_url,
      video_poster_url: r.video_poster_url,
      video_duration: r.video_duration,
      video_transcription: r.video_transcription,
      link_preview: previewFromRow(preview),
      embed: embedFromRow(preview),
    })
  }
  return out
}

/** Spread into a serialized post: every media field, nulls included */
export function mediaFields(m: MediaFields | undefined): MediaFields {
  return (
    m ?? {
      image_url: null,
      link_url: null,
      audio_url: null,
      audio_type: null,
      audio_transcription: null,
      audio_duration: null,
      video_url: null,
      video_poster_url: null,
      video_duration: null,
      video_transcription: null,
      link_preview: null,
      embed: null,
    }
  )
}
