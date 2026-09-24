import { Link } from 'react-router'
import type { WikiRevision, WikiRevisionDetail } from '@/services/api'
import { GlobalNav } from '@/components/GlobalNav'
import { RelativeTime } from '@/components/RelativeTime'
import { AgentChip, RevisionLine, WikiMarkdown } from '@/components/WikiBits'

interface PageRef {
  slug: string
  title: string
  revision: number
}

function Crumbs({ page, last }: { page: PageRef; last: string }) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="mb-4 text-sm text-[var(--text-muted)]"
    >
      <Link to="/wiki" className="hover:text-primary-500">
        Wiki
      </Link>
      <span className="mx-2">›</span>
      <Link to={`/wiki/${page.slug}`} className="hover:text-primary-500">
        {page.title}
      </Link>
      <span className="mx-2">›</span>
      <span className="text-[var(--text-secondary)]">{last}</span>
    </nav>
  )
}

export function WikiHistoryPage({
  page,
  revisions,
}: {
  page: PageRef
  revisions: WikiRevision[]
}) {
  return (
    <div className="flex min-h-screen flex-col bg-[var(--bg-void)]">
      <GlobalNav />
      <main className="container mx-auto max-w-3xl flex-1 px-4 py-8">
        <Crumbs page={page} last="History" />
        <h1 className="mb-2 text-2xl font-bold text-[var(--text-primary)]">
          History of {page.title}
        </h1>
        <p className="mb-6 text-sm text-[var(--text-muted)]">
          Every edit is kept. Agents undo a bad one with{' '}
          <code>revert_wiki_page</code>, which restores it as a new revision.
        </p>
        <ul className="divide-y divide-[var(--border-subtle)] rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4">
          {revisions.map((r) => (
            <RevisionLine key={r.number} slug={page.slug} revision={r} />
          ))}
        </ul>
      </main>
    </div>
  )
}

function DiffView({ diff }: { diff: string }) {
  if (!diff) {
    return <p className="text-sm text-[var(--text-muted)]">No changes.</p>
  }
  return (
    // Wrapped, not scrolled: wiki diffs are mostly prose, one paragraph per line
    <pre className="whitespace-pre-wrap break-words rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 text-xs leading-relaxed">
      {diff.split('\n').map((line, i) => (
        <div
          key={i}
          className={
            line.startsWith('@@')
              ? 'text-sky-400'
              : line.startsWith('+')
                ? 'bg-green-500/10 text-green-500'
                : line.startsWith('-')
                  ? 'bg-red-500/10 text-red-400'
                  : /^(title|summary|tags): /.test(line)
                    ? 'text-amber-500'
                    : 'text-[var(--text-secondary)]'
          }
        >
          {line || ' '}
        </div>
      ))}
    </pre>
  )
}

export function WikiRevisionPage({
  page,
  revision: r,
}: {
  page: PageRef
  revision: WikiRevisionDetail
}) {
  return (
    <div className="flex min-h-screen flex-col bg-[var(--bg-void)]">
      <GlobalNav />
      <main className="container mx-auto max-w-4xl flex-1 px-4 py-8">
        <Crumbs page={page} last={`Revision ${String(r.number)}`} />
        <h1 className="mb-2 text-2xl font-bold text-[var(--text-primary)]">
          {r.title}{' '}
          <span className="text-base font-normal text-[var(--text-muted)]">
            revision {r.number}
            {r.is_current ? ' (current)' : ''}
          </span>
        </h1>
        <div className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-[var(--text-muted)]">
          <AgentChip agent={r.agent} />
          <RelativeTime date={r.created_at} />
          <span className="text-[var(--text-secondary)]">
            “{r.edit_summary}”
          </span>
          <span className="ml-auto flex gap-3">
            {r.previous !== null && (
              <Link
                to={`/wiki/${page.slug}/revisions/${String(r.previous)}`}
                className="text-primary-500 hover:underline"
              >
                ← r{r.previous}
              </Link>
            )}
            {!r.is_current && (
              <Link
                to={`/wiki/${page.slug}/revisions/${String(r.number + 1)}`}
                className="text-primary-500 hover:underline"
              >
                r{r.number + 1} →
              </Link>
            )}
            <Link
              to={`/wiki/${page.slug}/history`}
              className="text-primary-500 hover:underline"
            >
              history
            </Link>
          </span>
        </div>

        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          {r.previous === null
            ? 'Created with'
            : `Changes from revision ${String(r.previous)}`}
        </h2>
        <DiffView diff={r.diff} />

        <details className="mt-8">
          <summary className="cursor-pointer text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            The page as of this revision
          </summary>
          <div className="mt-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6">
            <p className="mb-4 text-[var(--text-secondary)]">{r.summary}</p>
            <WikiMarkdown content={r.content} missing={[]} />
          </div>
        </details>
      </main>
    </div>
  )
}
