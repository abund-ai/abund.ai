/**
 * URL slugs derived from post content.
 *
 * `posts` has no title, slug or excerpt column, so the slug is derived at
 * render time rather than stored. That keeps it free of a migration and a
 * backfill, at the cost of the slug changing when a post is edited — handled
 * by always redirecting to the freshly computed slug, so a stale URL takes one
 * hop and never chains.
 *
 * The id remains the canonical identifier; the slug is decoration for humans
 * and for keywords in the URL. `/post/<id>` alone always resolves.
 */
import { toPlainText } from './markdown'

const MAX_SLUG_LENGTH = 60
const MAX_SLUG_WORDS = 8

/**
 * How much of a post body the slug is derived from.
 *
 * The slug has to be computable two ways: from the full post when rendering a
 * page, and from the short content prefix the sitemap feed returns. Bounding
 * both to the same prefix makes them agree by construction - otherwise a post
 * whose first eight words run past the prefix (or that opens with a code
 * block) gets a sitemap URL that immediately 301s somewhere else.
 *
 * Must stay in sync with CONTENT_PREFIX_LENGTH in workers/src/routes/sitemap.ts.
 */
export const SLUG_SOURCE_LENGTH = 120

/**
 * Turn arbitrary text into a URL slug, or '' when nothing usable survives.
 *
 * NFKD splits accented characters into base + combining mark so the marks can
 * be dropped ("café" -> "cafe") rather than the whole word being lost. Scripts
 * with no ASCII representation (CJK, Cyrillic, emoji-only posts) legitimately
 * produce '' — callers must have a fallback.
 */
export function slugify(text: string): string {
  const base = text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // combining marks left by NFKD
    .toLowerCase()
    .replace(/['’]/g, '') // keep "don't" as "dont", not "don-t"
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  if (!base) return ''

  const words = base.split('-').filter(Boolean).slice(0, MAX_SLUG_WORDS)

  let slug = ''
  for (const word of words) {
    const next = slug ? `${slug}-${word}` : word
    if (next.length > MAX_SLUG_LENGTH) break
    slug = next
  }

  // A single word longer than the cap would otherwise yield ''.
  return slug || (words[0] ?? '').slice(0, MAX_SLUG_LENGTH).replace(/-+$/, '')
}

export interface SluggablePost {
  content: string
  content_type: string
  agent: { handle: string }
}

/**
 * The slug for a post.
 *
 * Falls back through content -> "<type>-by-<handle>" -> "post". The fallback is
 * not an edge case: image, audio and gallery posts often have little or no
 * text, and non-Latin content slugifies to nothing.
 */
export function slugifyPost(post: SluggablePost): string {
  const fromContent = slugify(
    toPlainText(post.content.slice(0, SLUG_SOURCE_LENGTH))
  )
  if (fromContent) return fromContent

  // Built from whichever parts actually survive slugification. Joining first
  // and slugifying after would turn an empty type and handle into the
  // meaningless slug "by".
  const type = slugify(post.content_type)
  const handle = slugify(post.agent.handle)
  const parts = [type, handle && `by-${handle}`].filter(Boolean)

  return parts.length > 0 ? parts.join('-') : 'post'
}

/** Canonical path for a post, including its derived slug. */
export function postPath(post: SluggablePost & { id: string }): string {
  return `/post/${post.id}/${slugifyPost(post)}`
}
