/**
 * Wiki links and slugs.
 *
 * Mirrors workers/src/lib/wiki.ts: `[[Target]]` and `[[Target|label]]` link
 * to `/wiki/<slugifyWiki(Target)>`, except inside code. The API tracks the
 * same links for backlinks and the wanted list, so the two slugifiers must
 * agree (wiki.test.ts pins the shared cases).
 */

const MAX_SLUG = 80

/** Slugs the API uses for its own listings; never a page (mirrors the API) */
export const RESERVED_SLUGS = new Set(['search', 'wanted', 'changes'])

export function slugifyWiki(text: string): string {
  const base = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (base.length <= MAX_SLUG) return base
  const cut = base.slice(0, MAX_SLUG)
  const lastDash = cut.lastIndexOf('-')
  return (lastDash > MAX_SLUG * 0.6 ? cut.slice(0, lastDash) : cut).replace(
    /-+$/,
    ''
  )
}

const WIKI_LINK = /\[\[([^[\]|\n]{1,120})(?:\|([^[\]\n]{1,120}))?\]\]/g

/** Escape text for use as markdown link text */
function linkText(text: string): string {
  return text.replace(/([\\[\]])/g, '\\$1')
}

/**
 * Turn `[[Target|label]]` into `[label](/wiki/target)` everywhere except in
 * fenced code blocks and inline code spans.
 */
export function linkifyWiki(content: string): string {
  const out: string[] = []
  let fence: string | null = null
  for (const line of content.split('\n')) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1]
    if (fence) {
      if (
        marker?.startsWith(fence.charAt(0)) &&
        marker.length >= fence.length
      ) {
        fence = null
      }
      out.push(line)
      continue
    }
    if (marker) {
      fence = marker
      out.push(line)
      continue
    }
    // Split on inline code spans; only the text between them is linkified
    out.push(
      line
        .split(/(`[^`\n]*`)/g)
        .map((part, i) =>
          i % 2 === 1
            ? part
            : part.replace(
                WIKI_LINK,
                (whole, target: string, label?: string) => {
                  const slug = slugifyWiki(target.trim())
                  if (!slug) return whole
                  return `[${linkText((label ?? target).trim())}](/wiki/${slug})`
                }
              )
        )
        .join('')
    )
  }
  return out.join('\n')
}

/**
 * After rendering: wiki links are internal, so they open in place, are
 * followed by crawlers, and links to pages nobody has written are marked.
 */
export function decorateWikiLinks(html: string, missing: Set<string>): string {
  return html.replace(
    /<a href="\/wiki\/([a-z0-9-]+)"[^>]*>/g,
    (_whole, slug: string) =>
      missing.has(slug)
        ? `<a href="/wiki/${slug}" class="wiki-link wiki-missing" title="Not written yet">`
        : `<a href="/wiki/${slug}" class="wiki-link">`
  )
}

/** "+120" / "−45" for a revision's size change */
export function formatDelta(delta: number): string {
  if (delta === 0) return '±0'
  return delta > 0 ? `+${String(delta)}` : `−${String(Math.abs(delta))}`
}
