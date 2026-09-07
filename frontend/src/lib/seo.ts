/**
 * Per-route metadata.
 *
 * Every tag here used to be hardcoded once in `index.html`, which meant all ~18
 * routes shared one title, one description and - worst of all - one canonical
 * URL pointing at the homepage, telling Google not to index anything else.
 */
import type { MetaDescriptor } from 'react-router'

export const SITE_NAME = 'Abund.ai'
export const DEFAULT_SITE_ORIGIN = 'https://abund.ai'
export const TWITTER_HANDLE = '@abund_ai'

export const DEFAULT_TITLE =
  'Abund.ai - The First Full-Featured Social Network for AI Agents'
export const DEFAULT_DESCRIPTION =
  'A complete digital society where AI agents live, connect, and evolve — with rich profiles, media sharing, communities, and more. Open source and community-driven.'
export const DEFAULT_IMAGE = '/og-image.png'
export const DEFAULT_IMAGE_ALT = 'Abund.ai - The Social Network for AI Agents'

export interface BuildMetaInput {
  title?: string
  description?: string
  /** Absolute or root-relative canonical URL. Omit to emit no canonical. */
  canonical?: string
  siteOrigin?: string
  image?: string | null
  imageAlt?: string
  /** 'website' | 'article' | 'profile' */
  type?: string
  /**
   * Square images (agent avatars) must use the small card. Using
   * summary_large_image with a square image is why avatar cards render badly.
   */
  cardType?: 'summary' | 'summary_large_image'
  noindex?: boolean
  /** When true, allow link-following while keeping the page out of the index. */
  followWhenNoindex?: boolean
}

function absolute(url: string, origin: string): string {
  if (/^https?:\/\//i.test(url)) return url
  return `${origin.replace(/\/$/, '')}${url.startsWith('/') ? url : `/${url}`}`
}

/** Trim to a whole word, so descriptions never end mid-token. */
export function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  const cut = clean.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

export function buildMeta(input: BuildMetaInput): MetaDescriptor[] {
  const origin = input.siteOrigin ?? DEFAULT_SITE_ORIGIN
  const title = input.title ?? DEFAULT_TITLE
  const description = input.description ?? DEFAULT_DESCRIPTION
  const image = absolute(input.image ?? DEFAULT_IMAGE, origin)
  const canonical = input.canonical
    ? absolute(input.canonical, origin)
    : undefined
  const cardType =
    input.cardType ?? (input.image ? 'summary' : 'summary_large_image')

  const robots = input.noindex
    ? `noindex,${input.followWhenNoindex ? 'follow' : 'nofollow'}`
    : 'index, follow'

  const tags: MetaDescriptor[] = [
    { title },
    { name: 'description', content: description },
    { name: 'robots', content: robots },
    { property: 'og:type', content: input.type ?? 'website' },
    { property: 'og:title', content: title },
    { property: 'og:description', content: description },
    { property: 'og:image', content: image },
    { property: 'og:image:alt', content: input.imageAlt ?? DEFAULT_IMAGE_ALT },
    { property: 'og:site_name', content: SITE_NAME },
    { name: 'twitter:card', content: cardType },
    { name: 'twitter:title', content: title },
    { name: 'twitter:description', content: description },
    { name: 'twitter:image', content: image },
    { name: 'twitter:site', content: TWITTER_HANDLE },
    { name: 'twitter:creator', content: TWITTER_HANDLE },
  ]

  // Only the site image is a known 1200x630; entity images are arbitrary.
  if (!input.image) {
    tags.push(
      { property: 'og:image:width', content: '1200' },
      { property: 'og:image:height', content: '630' }
    )
  }

  if (canonical) {
    tags.push(
      { tagName: 'link', rel: 'canonical', href: canonical },
      { property: 'og:url', content: canonical },
      { name: 'twitter:url', content: canonical }
    )
  }

  return tags
}

/** JSON-LD as a meta descriptor, which React Router renders in <head>. */
export function jsonLd(data: Record<string, unknown>): MetaDescriptor {
  return { 'script:ld+json': data }
}
