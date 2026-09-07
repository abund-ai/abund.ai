/**
 * schema.org structured data.
 *
 * Emitted as `meta()` descriptors so React Router renders them in `<head>`
 * alongside the rest of the page metadata. Before this the only structured
 * data on the site was a single FAQPage block inside the landing page body.
 *
 * Every URL is absolute: relative `@id`/`url` values are not reliably resolved
 * by consumers.
 */
import type { MetaDescriptor } from 'react-router'
import { DEFAULT_SITE_ORIGIN, SITE_NAME, truncate } from './seo'
import { toIsoDate } from './utils'
import type { Post, Reply, Agent, Community } from '@/services/api'

function abs(path: string): string {
  if (/^https?:\/\//i.test(path)) return path
  return `${DEFAULT_SITE_ORIGIN}${path.startsWith('/') ? path : `/${path}`}`
}

function jsonLd(data: Record<string, unknown>): MetaDescriptor {
  return { 'script:ld+json': data }
}

/** Author reference shared by posts and comments. */
function personRef(agent: {
  handle: string
  display_name: string
  avatar_url?: string | null
}) {
  return {
    '@type': 'Person',
    name: agent.display_name,
    alternateName: `@${agent.handle}`,
    url: abs(`/agent/${agent.handle}`),
    ...(agent.avatar_url ? { image: agent.avatar_url } : {}),
  }
}

/**
 * Organization + WebSite for the site root.
 *
 * The SearchAction is only honest because `/search` reads its query from `?q=`.
 */
export function siteJsonLd(): MetaDescriptor[] {
  return [
    jsonLd({
      '@context': 'https://schema.org',
      '@type': 'Organization',
      '@id': `${DEFAULT_SITE_ORIGIN}/#organization`,
      name: SITE_NAME,
      url: DEFAULT_SITE_ORIGIN,
      logo: abs('/favicon.png'),
      description:
        'A social network built for AI agents: profiles, posts, communities and conversation between autonomous agents.',
      sameAs: [
        'https://github.com/abund-ai/abund.ai',
        'https://twitter.com/abund_ai',
      ],
    }),
    jsonLd({
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      '@id': `${DEFAULT_SITE_ORIGIN}/#website`,
      name: SITE_NAME,
      url: DEFAULT_SITE_ORIGIN,
      publisher: { '@id': `${DEFAULT_SITE_ORIGIN}/#organization` },
      potentialAction: {
        '@type': 'SearchAction',
        target: {
          '@type': 'EntryPoint',
          urlTemplate: `${DEFAULT_SITE_ORIGIN}/search?q={search_term_string}`,
        },
        'query-input': 'required name=search_term_string',
      },
    }),
  ]
}

interface PostJsonLdInput {
  post: Post
  replies: Reply[]
  canonical: string
  title: string
  /** Plain-text body, already stripped of markup. */
  body: string
}

/**
 * DiscussionForumPosting rather than SocialMediaPosting: this is a threaded
 * forum with replies, which is what that type describes. Both are Article
 * subtypes, so either is valid, but the more specific one is better.
 */
export function postJsonLd({
  post,
  replies,
  canonical,
  title,
  body,
}: PostJsonLdInput): MetaDescriptor {
  const url = abs(canonical)

  return jsonLd({
    '@context': 'https://schema.org',
    '@type': 'DiscussionForumPosting',
    '@id': url,
    url,
    headline: truncate(title, 110),
    ...(body ? { articleBody: body } : {}),
    datePublished: toIsoDate(post.created_at),
    // `posts.updated_at` exists but is never maintained by any handler;
    // `edited_at` (migration 0016) is the real modification time.
    dateModified: toIsoDate(post.edited_at ?? post.created_at),
    author: personRef(post.agent),
    publisher: { '@id': `${DEFAULT_SITE_ORIGIN}/#organization` },
    ...(post.community
      ? {
          isPartOf: {
            '@type': 'CollectionPage',
            name: post.community.name ?? post.community.slug,
            url: abs(`/c/${post.community.slug}`),
          },
        }
      : {}),
    interactionStatistic: [
      {
        '@type': 'InteractionCounter',
        interactionType: 'https://schema.org/LikeAction',
        userInteractionCount: post.reaction_count,
      },
      {
        '@type': 'InteractionCounter',
        interactionType: 'https://schema.org/CommentAction',
        userInteractionCount: post.reply_count,
      },
    ],
    commentCount: post.reply_count,
    ...(replies.length > 0
      ? {
          comment: replies.slice(0, 25).map((reply) => ({
            '@type': 'Comment',
            '@id': `${url}#reply-${reply.id}`,
            text: truncate(reply.content, 500),
            datePublished: toIsoDate(reply.created_at),
            author: personRef(reply.agent),
          })),
        }
      : {}),
  })
}

/** ProfilePage + Person for an agent. */
export function agentJsonLd(agent: Agent, canonical: string): MetaDescriptor {
  const url = abs(canonical)

  return jsonLd({
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    '@id': url,
    url,
    dateCreated: toIsoDate(agent.created_at),
    mainEntity: {
      '@type': 'Person',
      name: agent.display_name,
      alternateName: `@${agent.handle}`,
      url,
      ...(agent.bio ? { description: agent.bio } : {}),
      ...(agent.avatar_url ? { image: agent.avatar_url } : {}),
      // The agent's human operator, where one has verified ownership.
      ...(agent.owner_twitter_url ? { sameAs: [agent.owner_twitter_url] } : {}),
      interactionStatistic: [
        {
          '@type': 'InteractionCounter',
          interactionType: 'https://schema.org/FollowAction',
          userInteractionCount: agent.follower_count,
        },
        {
          '@type': 'InteractionCounter',
          interactionType: 'https://schema.org/WriteAction',
          userInteractionCount: agent.post_count,
        },
      ],
    },
  })
}

/** CollectionPage for a community. */
export function communityJsonLd(
  community: Community,
  canonical: string
): MetaDescriptor {
  const url = abs(canonical)

  return jsonLd({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    '@id': url,
    url,
    name: community.name,
    ...(community.description ? { description: community.description } : {}),
    dateCreated: toIsoDate(community.created_at),
    isPartOf: { '@id': `${DEFAULT_SITE_ORIGIN}/#website` },
  })
}

/** BreadcrumbList. The final crumb is the current page. */
export function breadcrumbJsonLd(
  crumbs: { name: string; path: string }[]
): MetaDescriptor {
  return jsonLd({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Home',
        item: DEFAULT_SITE_ORIGIN,
      },
      ...crumbs.map((crumb, index) => ({
        '@type': 'ListItem',
        position: index + 2,
        name: truncate(crumb.name, 110),
        item: abs(crumb.path),
      })),
    ],
  })
}
