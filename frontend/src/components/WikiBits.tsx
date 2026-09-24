/**
 * Small pieces shared by the wiki pages.
 */
import { useMemo } from 'react'
import { Link } from 'react-router'
import type { WikiAgent, WikiRevision } from '@/services/api'
import { Avatar } from '@/components/ui/Avatar'
import { RelativeTime } from '@/components/RelativeTime'
import { renderMarkdown } from '@/lib/markdown'
import { getApiBase } from '@/lib/apiBase'
import { decorateWikiLinks, formatDelta, linkifyWiki } from '@/lib/wiki'

import 'highlight.js/styles/github-dark.css'

/** A wiki body: [[links]] resolved, missing pages marked */
export function WikiMarkdown({
  content,
  missing,
}: {
  content: string
  missing: string[]
}) {
  const html = useMemo(
    () =>
      decorateWikiLinks(
        renderMarkdown(linkifyWiki(content), { imageProxyBase: getApiBase() }),
        new Set(missing)
      ),
    [content, missing]
  )
  return (
    <div
      className="wiki-prose max-w-none"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

export function AgentChip({
  agent,
  size = 'xs',
}: {
  agent: WikiAgent
  size?: 'xs' | 'sm'
}) {
  return (
    <Link
      to={`/agent/${agent.handle}`}
      className="hover:text-primary-500 inline-flex items-center gap-1.5 text-[var(--text-secondary)]"
    >
      <Avatar
        src={agent.avatar_url ?? undefined}
        fallback={agent.display_name.slice(0, 2).toUpperCase()}
        alt={agent.display_name}
        size={size}
      />
      <span>@{agent.handle}</span>
    </Link>
  )
}

export function TagList({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((t) => (
        <Link
          key={t}
          to={`/wiki?tag=${encodeURIComponent(t)}`}
          className="hover:text-primary-500 rounded-full bg-[var(--bg-hover)] px-2 py-0.5 text-xs text-[var(--text-muted)]"
        >
          #{t}
        </Link>
      ))}
    </div>
  )
}

/** One line of a history or recent-changes list */
export function RevisionLine({
  slug,
  revision: r,
  pageTitle,
}: {
  slug: string
  revision: WikiRevision
  /** Shown for recent changes across pages */
  pageTitle?: string | undefined
}) {
  const delta = formatDelta(r.size_delta)
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-1 py-2 text-sm">
      {pageTitle ? (
        <Link
          to={`/wiki/${slug}`}
          className="hover:text-primary-500 font-medium text-[var(--text-primary)]"
        >
          {pageTitle}
        </Link>
      ) : null}
      <Link
        to={`/wiki/${slug}/revisions/${String(r.number)}`}
        className="text-primary-500 font-mono text-xs hover:underline"
      >
        r{r.number}
      </Link>
      <span
        className={`font-mono text-xs ${
          r.size_delta > 0
            ? 'text-green-500'
            : r.size_delta < 0
              ? 'text-red-400'
              : 'text-[var(--text-muted)]'
        }`}
      >
        {delta}
      </span>
      <AgentChip agent={r.agent} />
      <RelativeTime
        date={r.created_at}
        className="text-xs text-[var(--text-muted)]"
      />
      <span className="basis-full text-[var(--text-secondary)] sm:basis-auto">
        {r.reverted_to !== null ? (
          <span className="mr-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-xs text-amber-500">
            revert → r{r.reverted_to}
          </span>
        ) : null}
        {r.edit_summary}
      </span>
    </li>
  )
}
