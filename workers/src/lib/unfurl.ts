/**
 * Link previews and rich embeds
 *
 * A post carries at most one unfurled link: the `link_url` of a link post, or
 * the first URL in the content of a text/code post. Unfurling produces two
 * things, both stored in `link_previews` keyed by the URL as posted:
 *
 * - a **link preview**: Open Graph / Twitter card metadata (title,
 *   description, site name, image). The image is re-hosted on R2 so the web
 *   app never hotlinks third parties or leaks reader IPs to them.
 * - a **rich embed**: for known providers (YouTube, Vimeo, Loom, Spotify,
 *   SoundCloud, CodePen, Hugging Face Spaces) and direct media files, the
 *   iframe src / media URL the web app can render as a player. Embeds are
 *   derived from the URL alone wherever possible, so a post gets its player
 *   even when the page fetch fails.
 *
 * Unfurling runs after the post is created (`waitUntil`) and never blocks or
 * fails the request. Every fetch goes through the SSRF guard, follows at most
 * three redirects (re-checked per hop), times out quickly and reads a bounded
 * number of bytes.
 */

import type { D1Database } from '@cloudflare/workers-types'
import { execute, queryOne } from './db'
import { assertSafeUrl } from './ssrf'
import { getPublicUrl } from './storage'
import type { KVCache } from './cache'
import {
  bumpVersion,
  cacheKey,
  invalidateFeeds,
  invalidatePrefix,
  versionKey,
} from './cache'

// =============================================================================
// Shapes
// =============================================================================

export type EmbedKind = 'iframe' | 'video' | 'audio' | 'image'

export interface Embed {
  /** youtube, vimeo, loom, spotify, soundcloud, codepen, huggingface, file */
  provider: string
  /** iframe = third-party player; video/audio/image = a direct media file */
  kind: EmbedKind
  /** iframe src, or the media file itself */
  url: string
  /** width / height, for iframe and video embeds */
  aspect_ratio: number | null
  /** fixed pixel height, for audio and rich widgets */
  height: number | null
}

export interface LinkPreview {
  url: string
  title: string | null
  description: string | null
  /** Re-hosted on media.abund.ai, or null */
  image_url: string | null
  site_name: string | null
}

export interface PreviewRow {
  url: string
  status: 'pending' | 'ok' | 'failed'
  title: string | null
  description: string | null
  image_url: string | null
  site_name: string | null
  canonical_url: string | null
  embed_provider: string | null
  embed_kind: EmbedKind | null
  embed_url: string | null
  embed_aspect_ratio: number | null
  embed_height: number | null
  fetched_at: string | null
}

// =============================================================================
// Limits
// =============================================================================

const FETCH_TIMEOUT_MS = 5000
const MAX_REDIRECTS = 3
const MAX_HTML_BYTES = 512 * 1024
const MAX_IMAGE_BYTES = 3 * 1024 * 1024
/** A successful preview is reused this long before it is fetched again */
const FRESH_FOR_MS = 7 * 24 * 60 * 60 * 1000
/** A failed fetch is retried after this long */
const RETRY_FAILED_AFTER_MS = 24 * 60 * 60 * 1000
const USER_AGENT =
  'Mozilla/5.0 (compatible; Abund.ai Link Preview/1.0; +https://abund.ai)'

const IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
}

/** Hosts we never unfurl: our own pages (self-fetch) and our media CDN */
const SKIP_HOSTS = new Set(['abund.ai', 'www.abund.ai', 'media.abund.ai'])

// =============================================================================
// URL extraction
// =============================================================================

const URL_RE = /https?:\/\/[^\s<>"'`)\]]+/gi

/** Strip trailing punctuation that is almost never part of a pasted URL */
function trimUrl(raw: string): string {
  let url = raw
  while (/[.,;:!?'"]$/.test(url)) url = url.slice(0, -1)
  // Balance a closing paren only when the URL does not open one (markdown links)
  if (url.endsWith(')') && !url.includes('(')) url = url.slice(0, -1)
  return url
}

/**
 * The URL a post should unfurl: `link_url` when set, else the first http(s)
 * URL in the content that is not one of our own. Null when there is nothing
 * to preview.
 */
export function pickPreviewUrl(
  content: string,
  linkUrl: string | null | undefined
): string | null {
  const candidates = linkUrl ? [linkUrl] : []
  if (!linkUrl) {
    // Fenced code blocks are skipped: a URL inside a snippet is not a share
    const withoutCode = content.replace(/```[\s\S]*?```/g, ' ')
    for (const m of withoutCode.match(URL_RE) ?? []) candidates.push(trimUrl(m))
  }
  for (const candidate of candidates) {
    let url: URL
    try {
      url = new URL(candidate)
    } catch {
      continue
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') continue
    if (SKIP_HOSTS.has(url.hostname.toLowerCase())) continue
    if (candidate.length > 2048) continue
    return candidate
  }
  return null
}

// =============================================================================
// Rich embeds from the URL alone
// =============================================================================

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/

function youtubeId(url: URL): string | null {
  const host = url.hostname.replace(/^(www|m|music)\./, '')
  if (host === 'youtu.be') {
    const id = url.pathname.slice(1).split('/')[0] ?? ''
    return YOUTUBE_ID.test(id) ? id : null
  }
  if (host !== 'youtube.com' && host !== 'youtube-nocookie.com') return null
  if (url.pathname === '/watch') {
    const id = url.searchParams.get('v') ?? ''
    return YOUTUBE_ID.test(id) ? id : null
  }
  const m = url.pathname.match(
    /^\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})/
  )
  return m?.[1] ?? null
}

const DIRECT_MEDIA: Array<[RegExp, EmbedKind]> = [
  [/\.(mp4|webm|m4v|ogv)$/i, 'video'],
  [/\.(mp3|wav|ogg|oga|m4a|aac|flac)$/i, 'audio'],
  [/\.(png|jpe?g|gif|webp)$/i, 'image'],
]

/**
 * Detect a rich embed from the URL alone. Pure: no network.
 */
export function detectEmbed(rawUrl: string): Embed | null {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return null
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '')

  const yt = youtubeId(url)
  if (yt) {
    return {
      provider: 'youtube',
      kind: 'iframe',
      url: `https://www.youtube-nocookie.com/embed/${yt}`,
      aspect_ratio: 16 / 9,
      height: null,
    }
  }

  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const m = url.pathname.match(/^\/(?:video\/)?(\d{6,12})(?:\/|$)/)
    if (m) {
      return {
        provider: 'vimeo',
        kind: 'iframe',
        url: `https://player.vimeo.com/video/${m[1]!}`,
        aspect_ratio: 16 / 9,
        height: null,
      }
    }
  }

  if (host === 'loom.com') {
    const m = url.pathname.match(/^\/(?:share|embed)\/([a-f0-9]{32})/i)
    if (m) {
      return {
        provider: 'loom',
        kind: 'iframe',
        url: `https://www.loom.com/embed/${m[1]!}`,
        aspect_ratio: 16 / 9,
        height: null,
      }
    }
  }

  if (host === 'open.spotify.com') {
    const m = url.pathname.match(
      /^\/(?:embed\/)?(track|album|playlist|episode|show|artist)\/([A-Za-z0-9]{22})/
    )
    if (m) {
      const kind = m[1]!
      return {
        provider: 'spotify',
        kind: 'iframe',
        url: `https://open.spotify.com/embed/${kind}/${m[2]!}`,
        aspect_ratio: null,
        height: kind === 'track' || kind === 'episode' ? 152 : 352,
      }
    }
  }

  if (host === 'codepen.io') {
    const m = url.pathname.match(
      /^\/([A-Za-z0-9_-]+)\/(?:pen|embed)\/([A-Za-z0-9]+)/
    )
    if (m) {
      return {
        provider: 'codepen',
        kind: 'iframe',
        url: `https://codepen.io/${m[1]!}/embed/${m[2]!}?default-tab=result`,
        aspect_ratio: null,
        height: 400,
      }
    }
  }

  if (host === 'huggingface.co' || host === 'hf.co') {
    const m = url.pathname.match(
      /^\/spaces\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/
    )
    if (m) {
      const sub = `${m[1]!}-${m[2]!}`.toLowerCase().replace(/[._]/g, '-')
      return {
        provider: 'huggingface',
        kind: 'iframe',
        url: `https://${sub}.hf.space`,
        aspect_ratio: 16 / 9,
        height: null,
      }
    }
  }

  for (const [re, kind] of DIRECT_MEDIA) {
    if (re.test(url.pathname)) {
      return {
        provider: 'file',
        kind,
        url: rawUrl,
        aspect_ratio: kind === 'video' ? 16 / 9 : null,
        height: null,
      }
    }
  }

  return null
}

// =============================================================================
// Safe fetching
// =============================================================================

/**
 * Fetch a URL following up to MAX_REDIRECTS redirects, re-running the SSRF
 * check on every hop. Throws on a blocked hop, a timeout or too many redirects.
 */
export async function safeFetch(
  url: string,
  init: { accept: string; method?: 'GET' | 'HEAD' },
  environment?: string
): Promise<Response> {
  let current = url
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    assertSafeUrl(current, environment)
    const response = await fetch(current, {
      method: init.method ?? 'GET',
      redirect: 'manual',
      headers: { 'User-Agent': USER_AGENT, Accept: init.accept },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) return response
      current = new URL(location, current).toString()
      continue
    }
    return response
  }
  throw new Error('Too many redirects')
}

/** Read at most `limit` bytes of a body, then cancel the stream */
async function readBounded(
  response: Response,
  limit: number
): Promise<Uint8Array> {
  const body = response.body
  if (!body) return new Uint8Array(0)
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (total < limit) {
    const { done, value } = await reader.read()
    if (done || !value) break
    chunks.push(value)
    total += value.byteLength
  }
  if (total >= limit) {
    reader.cancel().catch(() => undefined)
  }
  const out = new Uint8Array(Math.min(total, limit))
  let offset = 0
  for (const chunk of chunks) {
    const slice = chunk.subarray(0, Math.max(0, out.length - offset))
    out.set(slice, offset)
    offset += slice.length
    if (offset >= out.length) break
  }
  return out
}

// =============================================================================
// HTML metadata parsing
// =============================================================================

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

export function decodeEntities(text: string): string {
  return text.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (match, entity: string) => {
      const lower = entity.toLowerCase()
      if (lower.startsWith('#x')) {
        const code = parseInt(lower.slice(2), 16)
        return Number.isFinite(code) ? String.fromCodePoint(code) : match
      }
      if (lower.startsWith('#')) {
        const code = parseInt(lower.slice(1), 10)
        return Number.isFinite(code) ? String.fromCodePoint(code) : match
      }
      return ENTITIES[lower] ?? match
    }
  )
}

function clean(value: string | undefined, max: number): string | null {
  if (!value) return null
  const text = decodeEntities(value).replace(/\s+/g, ' ').trim()
  if (!text) return null
  return text.length > max ? text.slice(0, max - 1) + '…' : text
}

/** Attribute value from a single tag's attribute string, any quoting */
function attr(tag: string, name: string): string | undefined {
  const re = new RegExp(
    `\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`,
    'i'
  )
  const m = tag.match(re)
  return m?.[1] ?? m?.[2] ?? m?.[3]
}

export interface PageMeta {
  title: string | null
  description: string | null
  image: string | null
  site_name: string | null
  canonical: string | null
}

/**
 * Pull Open Graph, Twitter card and plain HTML metadata out of a page.
 * Regex-based on purpose: there is no DOM in a Worker and the tags we need
 * are all self-contained.
 */
export function parsePageMeta(html: string): PageMeta {
  const meta: Record<string, string> = {}
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = (attr(tag, 'property') ?? attr(tag, 'name'))?.toLowerCase()
    const content = attr(tag, 'content')
    if (!key || content === undefined || meta[key] !== undefined) continue
    meta[key] = content
  }
  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
  const canonicalTag = (html.match(/<link\b[^>]*>/gi) ?? []).find(
    (t) => attr(t, 'rel')?.toLowerCase() === 'canonical'
  )

  return {
    title: clean(meta['og:title'] ?? meta['twitter:title'] ?? titleTag, 200),
    description: clean(
      meta['og:description'] ??
        meta['twitter:description'] ??
        meta['description'],
      500
    ),
    image:
      clean(
        meta['og:image:secure_url'] ??
          meta['og:image'] ??
          meta['og:image:url'] ??
          meta['twitter:image'] ??
          meta['twitter:image:src'],
        2048
      ) ?? null,
    site_name: clean(meta['og:site_name'], 100),
    canonical:
      clean(
        meta['og:url'] ?? (canonicalTag && attr(canonicalTag, 'href')),
        2048
      ) ?? null,
  }
}

// =============================================================================
// Unfurl pipeline
// =============================================================================

interface UnfurlDeps {
  db: D1Database
  bucket: R2Bucket
  environment?: string | undefined
}

async function fetchPage(url: string, environment?: string): Promise<PageMeta> {
  const response = await safeFetch(
    url,
    { accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' },
    environment
  )
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
  const type = response.headers.get('content-type')?.split(';')[0]?.trim() ?? ''
  if (type && type !== 'text/html' && type !== 'application/xhtml+xml') {
    throw new Error(`Not a web page: ${type}`)
  }
  const bytes = await readBounded(response, MAX_HTML_BYTES)
  return parsePageMeta(new TextDecoder().decode(bytes))
}

/** Stable, short, filesystem-safe name for a URL */
async function urlHash(url: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(url)
  )
  return Array.from(new Uint8Array(digest).slice(0, 16))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Store a page's preview image on R2 and return its public URL, or null */
async function rehostImage(
  imageUrl: string,
  pageUrl: string,
  deps: UnfurlDeps
): Promise<string | null> {
  try {
    const absolute = new URL(imageUrl, pageUrl).toString()
    const response = await safeFetch(
      absolute,
      { accept: 'image/*' },
      deps.environment
    )
    if (!response.ok) return null
    const type = response.headers.get('content-type')?.split(';')[0]?.trim()
    const ext = type ? IMAGE_TYPES[type] : undefined
    if (!type || !ext) return null
    const length = response.headers.get('content-length')
    if (length && parseInt(length, 10) > MAX_IMAGE_BYTES) return null
    const bytes = await readBounded(response, MAX_IMAGE_BYTES + 1)
    if (bytes.byteLength > MAX_IMAGE_BYTES || bytes.byteLength === 0)
      return null
    const key = `previews/${await urlHash(absolute)}.${ext}`
    await deps.bucket.put(key, bytes, {
      httpMetadata: {
        contentType: type,
        cacheControl: 'public, max-age=604800',
      },
      customMetadata: { source: absolute.slice(0, 512) },
    })
    return getPublicUrl(key, deps.environment)
  } catch (error) {
    console.error('Preview image fetch failed:', error)
    return null
  }
}

/** SoundCloud has no URL scheme for players; its oEmbed endpoint gives one */
async function soundcloudEmbed(
  url: string,
  environment?: string
): Promise<Embed | null> {
  try {
    const endpoint = `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(url)}`
    const response = await safeFetch(
      endpoint,
      { accept: 'application/json' },
      environment
    )
    if (!response.ok) return null
    const data = (await response.json()) as { html?: string }
    const src = data.html?.match(/src="([^"]+)"/)?.[1]
    if (!src || !src.startsWith('https://w.soundcloud.com/')) return null
    return {
      provider: 'soundcloud',
      kind: 'iframe',
      url: decodeEntities(src),
      aspect_ratio: null,
      height: 166,
    }
  } catch {
    return null
  }
}

function isSoundcloud(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '')
    return host === 'soundcloud.com' || host === 'on.soundcloud.com'
  } catch {
    return false
  }
}

async function getRow(db: D1Database, url: string): Promise<PreviewRow | null> {
  return queryOne<PreviewRow>(
    db,
    `SELECT url, status, title, description, image_url, site_name, canonical_url,
            embed_provider, embed_kind, embed_url, embed_aspect_ratio, embed_height, fetched_at
     FROM link_previews WHERE url = ?`,
    [url]
  )
}

function isFresh(row: PreviewRow | null): boolean {
  if (!row?.fetched_at) return false
  // D1 datetime('now') is "YYYY-MM-DD HH:MM:SS" in UTC
  const age =
    Date.now() - new Date(row.fetched_at.replace(' ', 'T') + 'Z').getTime()
  if (row.status === 'ok') return age < FRESH_FOR_MS
  if (row.status === 'failed') return age < RETRY_FAILED_AFTER_MS
  return false
}

/**
 * Unfurl a URL into `link_previews`, reusing a fresh row when there is one.
 * Never throws: a failed fetch is recorded as such and the embed (if any) is
 * kept, so callers always get a row back.
 */
export async function unfurl(
  url: string,
  deps: UnfurlDeps
): Promise<PreviewRow> {
  const existing = await getRow(deps.db, url)
  if (existing && isFresh(existing)) return existing

  // Make sure the row exists before the fetch. Two posts of the same link
  // at the same moment may both fetch it; the second UPDATE just rewrites
  // the same data, which is harmless.
  await execute(
    deps.db,
    `INSERT OR IGNORE INTO link_previews (url, status) VALUES (?, 'pending')`,
    [url]
  )

  let embed = detectEmbed(url)
  if (!embed && isSoundcloud(url)) {
    embed = await soundcloudEmbed(url, deps.environment)
  }

  let meta: PageMeta | null = null
  let image: string | null = null
  // A direct media file has no page to read
  if (embed?.provider !== 'file') {
    try {
      meta = await fetchPage(url, deps.environment)
      if (meta.image) image = await rehostImage(meta.image, url, deps)
    } catch (error) {
      console.error('Link preview fetch failed:', url, error)
    }
  } else if (embed.kind === 'image') {
    // A bare image link: re-host it like a page's og:image so the web app
    // never hotlinks it, and point the player at the copy
    image = await rehostImage(url, url, deps)
    if (image) embed = { ...embed, url: image }
  }

  const status: PreviewRow['status'] = meta || embed ? 'ok' : 'failed'
  await execute(
    deps.db,
    `UPDATE link_previews
     SET status = ?, title = ?, description = ?, image_url = ?, site_name = ?, canonical_url = ?,
         embed_provider = ?, embed_kind = ?, embed_url = ?, embed_aspect_ratio = ?, embed_height = ?,
         fetched_at = datetime('now')
     WHERE url = ?`,
    [
      status,
      meta?.title ?? null,
      meta?.description ?? null,
      image,
      meta?.site_name ?? null,
      meta?.canonical ?? null,
      embed?.provider ?? null,
      embed?.kind ?? null,
      embed?.url ?? null,
      embed?.aspect_ratio ?? null,
      embed?.height ?? null,
      url,
    ]
  )
  return (await getRow(deps.db, url)) as PreviewRow
}

/**
 * Attach a preview to a post: pick the URL, unfurl it, point the post at it
 * and drop the caches that carry the post. Meant for `waitUntil`; swallows
 * every error.
 */
export async function unfurlForPost(
  post: { id: string; content: string; link_url: string | null },
  deps: UnfurlDeps & { cache: KVCache | undefined }
): Promise<void> {
  try {
    const url = pickPreviewUrl(post.content, post.link_url)
    const current = await queryOne<{ preview_url: string | null }>(
      deps.db,
      'SELECT preview_url FROM posts WHERE id = ?',
      [post.id]
    )
    if (!current) return
    if (!url) {
      if (current.preview_url) {
        await execute(
          deps.db,
          'UPDATE posts SET preview_url = NULL WHERE id = ?',
          [post.id]
        )
        await dropCaches(post.id, deps.cache)
      }
      return
    }
    const row = await unfurl(url, deps)
    await execute(deps.db, 'UPDATE posts SET preview_url = ? WHERE id = ?', [
      url,
      post.id,
    ])
    if (row.status === 'ok' || current.preview_url !== url) {
      await dropCaches(post.id, deps.cache)
    }
  } catch (error) {
    console.error('unfurlForPost failed:', error)
  }
}

async function dropCaches(postId: string, cache: KVCache | undefined) {
  await Promise.all([
    invalidatePrefix(cache, cacheKey.post(postId)),
    invalidateFeeds(cache),
    bumpVersion(cache, versionKey.feed()),
  ])
}

// =============================================================================
// Serialization
// =============================================================================

/** The `link_preview` a serialized post carries, or null when there is none */
export function previewFromRow(
  row: PreviewRow | null | undefined
): LinkPreview | null {
  if (!row || row.status !== 'ok') return null
  if (!row.title && !row.description && !row.image_url) return null
  return {
    url: row.url,
    title: row.title,
    description: row.description,
    image_url: row.image_url,
    site_name: row.site_name,
  }
}

/** The `embed` a serialized post carries, or null when there is none */
export function embedFromRow(row: PreviewRow | null | undefined): Embed | null {
  if (!row?.embed_url || !row.embed_kind || !row.embed_provider) return null
  return {
    provider: row.embed_provider,
    kind: row.embed_kind,
    url: row.embed_url,
    aspect_ratio: row.embed_aspect_ratio,
    height: row.embed_height,
  }
}
