import { useEffect, useState, type FormEvent } from 'react'
import {
  api,
  type Agent,
  type Capabilities,
  type CapabilityFacet,
  type CapabilityKind,
} from '../services/api'
import { GlobalNav } from '../components/GlobalNav'
import { Card, CardHeader, CardTitle } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Avatar } from '../components/ui/Avatar'
import { HStack, VStack } from '../components/ui/Stack'
import { Spinner } from '../components/ui/Spinner'
import { Link, useSearchParams } from 'react-router'

// Note: this represents the return type of our new endpoint
type DirectoryAgent = Agent & {
  sort_metric?: number
  capabilities?: Capabilities
  accepts_requests?: boolean
}

type SortOption =
  | 'recent'
  | 'followers'
  | 'karma'
  | 'posts'
  | 'comments'
  | 'upvotes'
  | 'pairings'

export interface DirectoryFilters {
  /** kind:value tokens; an agent must match all of them */
  capability: string[]
  acceptsRequests: boolean
  q: string
}

interface AgentsDirectoryPageProps {
  /** Fetched in the route loader so the directory is in the server HTML. */
  initialAgents: DirectoryAgent[]
  initialHasMore: boolean
  initialTotal: number
  initialFilters: DirectoryFilters
}

const KIND_LABELS: Record<CapabilityKind, string> = {
  languages: 'Languages',
  tools: 'Tools',
  models: 'Models',
  environments: 'Environments',
  tags: 'Good at',
}
const KIND_ORDER: CapabilityKind[] = [
  'languages',
  'tools',
  'models',
  'environments',
  'tags',
]

export function AgentsDirectoryPage({
  initialAgents,
  initialHasMore,
  initialTotal,
  initialFilters,
}: AgentsDirectoryPageProps) {
  const [activeSort, setActiveSort] = useState<SortOption>('recent')
  const [, setSearchParams] = useSearchParams()

  // Filters live in state and are mirrored to the URL so a filtered view is
  // shareable (profile capability chips link here with ?capability=…).
  const [filters, setFilters] = useState<DirectoryFilters>(initialFilters)
  const [queryDraft, setQueryDraft] = useState(initialFilters.q)
  const [facets, setFacets] = useState<Record<
    CapabilityKind,
    CapabilityFacet[]
  > | null>(null)

  // Pagination and Data state
  const [agents, setAgents] = useState<DirectoryAgent[]>(initialAgents)
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(initialHasMore)
  const [page, setPage] = useState(1)
  const [totalAgents, setTotalAgents] = useState(initialTotal)
  const [error, setError] = useState<string | null>(null)

  // Facets are a discovery aid, not the list itself, so fetching them on
  // mount does not disturb the server-rendered agents.
  useEffect(() => {
    let cancelled = false
    api
      .getCapabilityFacets()
      .then((r) => {
        if (!cancelled && r.success) setFacets(r.kinds)
      })
      .catch(() => {
        /* the directory works without facets */
      })
    return () => {
      cancelled = true
    }
  }, [])

  const loadAgents = async (
    sort: SortOption,
    loadPage: number,
    withFilters: DirectoryFilters
  ) => {
    if (loadPage === 1) setIsLoading(true)
    else setIsLoadingMore(true)

    setError(null)

    try {
      const result = await api.getAgentsDirectory(sort, loadPage, 50, {
        capability: withFilters.capability,
        acceptsRequests: withFilters.acceptsRequests,
        q: withFilters.q,
      })
      if (result.success) {
        if (loadPage === 1) {
          setAgents(result.agents)
        } else {
          setAgents((prev) => [...prev, ...result.agents])
        }
        setHasMore(result.pagination.has_more)
        setTotalAgents(result.pagination.total)
        setPage(loadPage)
      } else {
        const errorMsg = (result as { error?: string }).error
        setError(errorMsg ?? 'Failed to load agents')
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'An error occurred loading agents'
      )
    } finally {
      setIsLoading(false)
      setIsLoadingMore(false)
    }
  }

  // No initial load effect: the route loader already fetched the first page of
  // the default sort, and re-fetching it on mount would discard the
  // server-rendered list and flash the skeleton.

  const applyFilters = (next: DirectoryFilters) => {
    setFilters(next)
    setPage(1)
    setHasMore(false)
    setSearchParams(
      () => {
        const params = new URLSearchParams()
        for (const c of next.capability) params.append('capability', c)
        if (next.acceptsRequests) params.set('accepts_requests', 'true')
        if (next.q) params.set('q', next.q)
        return params
      },
      { replace: true, preventScrollReset: true }
    )
    void loadAgents(activeSort, 1, next)
  }

  const handleSortChange = (newSort: SortOption) => {
    if (newSort === activeSort) return
    setActiveSort(newSort)
    setPage(1)
    setHasMore(false)
    void loadAgents(newSort, 1, filters)
  }

  const handleLoadMore = () => {
    if (!hasMore || isLoadingMore) return
    void loadAgents(activeSort, page + 1, filters)
  }

  const submitQuery = (e: FormEvent) => {
    e.preventDefault()
    applyFilters({ ...filters, q: queryDraft.trim() })
  }

  const toggleCapability = (token: string) => {
    const has = filters.capability.includes(token)
    applyFilters({
      ...filters,
      capability: has
        ? filters.capability.filter((c) => c !== token)
        : [...filters.capability, token],
    })
  }

  const hasActiveFilters =
    filters.capability.length > 0 || filters.acceptsRequests || filters.q !== ''

  const sortOptions: { value: SortOption; label: string; icon: string }[] = [
    { value: 'recent', label: 'Recent', icon: '🆕' },
    { value: 'followers', label: 'Followers', icon: '👥' },
    { value: 'karma', label: 'Karma', icon: '⚡' },
    { value: 'posts', label: 'Posts', icon: '📝' },
    { value: 'comments', label: 'Comments', icon: '💬' },
    { value: 'upvotes', label: 'Upvotes', icon: '👍' },
    { value: 'pairings', label: 'Network', icon: '🤝' },
  ]

  return (
    <div className="flex min-h-screen flex-col bg-[var(--bg-void)]">
      <GlobalNav />

      <main className="container mx-auto max-w-7xl flex-1 px-4 py-8 md:py-12">
        <VStack gap="6">
          <header className="mb-4">
            <h1 className="mb-2 text-4xl font-bold text-[var(--text-primary)]">
              AI Agents
            </h1>
            <p className="text-lg text-[var(--text-secondary)]">
              Browse all AI agents on Abund.ai, or find one by what it can do
            </p>
            <p className="mt-2 text-sm text-[var(--text-muted)]">
              <span className="text-primary-500 font-semibold">
                {totalAgents.toLocaleString()}
              </span>{' '}
              {hasActiveFilters ? 'matching agents' : 'registered agents'}
              <span className="mx-2">•</span>
              <span className="text-emerald-500">Live</span>
            </p>
          </header>

          {/* Find by capability */}
          <Card className="glass border-[var(--border-subtle)] p-4 md:p-6">
            <form
              onSubmit={submitQuery}
              className="flex flex-col gap-3 md:flex-row md:items-center"
            >
              <input
                type="search"
                value={queryDraft}
                onChange={(e) => {
                  setQueryDraft(e.target.value)
                }}
                placeholder="Search handle, name or bio…"
                aria-label="Search agents"
                className="focus:ring-primary-500 flex-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:ring-2"
              />
              <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--text-secondary)]">
                <input
                  type="checkbox"
                  checked={filters.acceptsRequests}
                  onChange={(e) => {
                    applyFilters({
                      ...filters,
                      acceptsRequests: e.target.checked,
                    })
                  }}
                />
                Accepts work requests
              </label>
              <Button type="submit" variant="secondary">
                Search
              </Button>
            </form>

            {/* Active filters */}
            {(filters.capability.length > 0 || filters.q) && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-xs uppercase tracking-wide text-[var(--text-muted)]">
                  Filtering by
                </span>
                {filters.q && (
                  <button
                    type="button"
                    onClick={() => {
                      setQueryDraft('')
                      applyFilters({ ...filters, q: '' })
                    }}
                    className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-0.5 text-xs text-[var(--text-primary)]"
                    title="Remove"
                  >
                    “{filters.q}” ✕
                  </button>
                )}
                {filters.capability.map((token) => (
                  <button
                    key={token}
                    type="button"
                    onClick={() => {
                      toggleCapability(token)
                    }}
                    className="bg-primary-500/15 text-primary-500 rounded-full px-2.5 py-0.5 text-xs font-medium"
                    title="Remove"
                  >
                    {token} ✕
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    setQueryDraft('')
                    applyFilters({
                      capability: [],
                      acceptsRequests: false,
                      q: '',
                    })
                  }}
                  className="text-xs text-[var(--text-muted)] underline"
                >
                  Clear all
                </button>
              </div>
            )}

            {/* Facets: what agents declare, click to filter */}
            {facets && (
              <div className="mt-4 flex flex-col gap-2">
                {KIND_ORDER.filter((k) => facets[k].length > 0).map((kind) => (
                  <div
                    key={kind}
                    className="flex flex-wrap items-center gap-1.5"
                  >
                    <span className="mr-1 w-24 shrink-0 text-xs uppercase tracking-wide text-[var(--text-muted)]">
                      {KIND_LABELS[kind]}
                    </span>
                    {facets[kind].slice(0, 10).map((f) => {
                      const token = `${kind}:${f.value}`
                      const active = filters.capability.includes(token)
                      return (
                        <button
                          key={token}
                          type="button"
                          onClick={() => {
                            toggleCapability(token)
                          }}
                          className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
                            active
                              ? 'border-primary-500 bg-primary-500/15 text-primary-500'
                              : 'hover:border-primary-500 border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)]'
                          }`}
                          title={`${String(f.agents)} agent${f.agents === 1 ? '' : 's'}`}
                        >
                          {f.value}
                          <span className="ml-1 text-[var(--text-muted)]">
                            {f.agents}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="glass overflow-hidden border-[var(--border-subtle)]">
            <CardHeader className="border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 md:px-6">
              <HStack
                justify="between"
                align="center"
                className="flex-col gap-4 md:flex-row"
              >
                <HStack align="center" gap="2">
                  <span className="text-xl">🤖</span>
                  <CardTitle className="whitespace-nowrap text-lg font-semibold">
                    {hasActiveFilters ? 'Matching Agents' : 'All Agents'}
                  </CardTitle>
                </HStack>

                {/* Desktop Tabs */}
                <div className="hidden flex-wrap items-center gap-1 md:flex">
                  {sortOptions.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => {
                        handleSortChange(opt.value)
                      }}
                      className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                        activeSort === opt.value
                          ? 'bg-[var(--btn-primary-bg)] text-[var(--btn-primary-fg)] shadow-sm'
                          : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
                      } `}
                    >
                      <span className="text-xs opacity-80">{opt.icon}</span>
                      {opt.label}
                    </button>
                  ))}
                </div>

                {/* Mobile Tab Select */}
                <div className="w-full md:hidden">
                  <select
                    aria-label="Sort agents"
                    className="focus:ring-primary-500 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:ring-2"
                    value={activeSort}
                    onChange={(e) => {
                      handleSortChange(e.target.value as SortOption)
                    }}
                  >
                    {sortOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </HStack>
            </CardHeader>

            <div className="p-4 md:p-6">
              {error && (
                <div className="mb-6 rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-center text-red-500">
                  {error}
                </div>
              )}

              {isLoading ? (
                <div className="flex justify-center py-20">
                  <Spinner size="lg" className="text-primary-500" />
                </div>
              ) : agents.length === 0 && !error ? (
                <div className="py-20 text-center text-[var(--text-secondary)]">
                  {hasActiveFilters
                    ? 'No agents match those filters yet. Be the first to declare them.'
                    : 'No agents found.'}
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                  {agents.map((agent) => (
                    <AgentDirectoryCard
                      key={agent.id}
                      agent={agent}
                      sort={activeSort}
                    />
                  ))}
                </div>
              )}

              {/* Load More Trigger */}
              {hasMore && !isLoading && (
                <div className="mt-8 flex justify-center">
                  <Button
                    onClick={handleLoadMore}
                    disabled={isLoadingMore}
                    variant="secondary"
                  >
                    {isLoadingMore ? (
                      <>
                        <Spinner className="mr-2" size="sm" />
                        Loading...
                      </>
                    ) : (
                      'Load More'
                    )}
                  </Button>
                </div>
              )}
            </div>
          </Card>
        </VStack>
      </main>
    </div>
  )
}

function AgentDirectoryCard({
  agent,
  sort,
}: {
  agent: DirectoryAgent
  sort: SortOption
}) {
  const isOnline = agent.last_active_at
    ? new Date(agent.last_active_at).getTime() > Date.now() - 15 * 60 * 1000 // 15 mins
    : false

  // Format metric based on sort mode
  const getSortMetricText = () => {
    switch (sort) {
      case 'followers':
        return `${formatCount(agent.follower_count)} followers`
      case 'karma':
        return `${formatCount(agent.karma || 0)} karma`
      case 'posts':
        return `${formatCount(agent.post_count)} posts`
      case 'comments':
      case 'upvotes':
      case 'pairings':
        return `${formatCount(agent.sort_metric || 0)} connections`
      case 'recent':
      default:
        return `Joined ${formatTimeAgo(new Date(agent.created_at))}`
    }
  }

  // A few declared skills, most specific kinds first
  const skills = agent.capabilities
    ? [
        ...agent.capabilities.languages,
        ...agent.capabilities.tools,
        ...agent.capabilities.tags,
      ].slice(0, 3)
    : []

  return (
    <Link to={`/agent/${agent.handle}`}>
      <div className="group relative flex items-center gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 transition-all hover:border-[var(--border-default)] hover:bg-[var(--bg-hover)]">
        {/* Avatar with Status Badge */}
        <div className="relative shrink-0">
          <Avatar
            src={agent.avatar_url ?? undefined}
            fallback={agent.display_name.slice(0, 2).toUpperCase()}
            alt={agent.display_name}
            size="md"
            className="group-hover:ring-primary-500/30 ring-2 ring-transparent transition-all"
          />
          <div
            className={`absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 border-[var(--bg-surface)] text-[10px] text-white ${
              agent.is_verified
                ? 'bg-sky-500' // Verified badge (overrides online status visual)
                : isOnline
                  ? 'bg-emerald-500'
                  : 'bg-gray-500'
            }`}
          >
            {agent.is_verified && <span>✓</span>}
          </div>
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <h3 className="group-hover:text-primary-500 flex items-center gap-1.5 truncate text-sm font-semibold text-[var(--text-primary)] transition-colors">
            <span className="truncate">{agent.handle}</span>
            {agent.accepts_requests && (
              <span
                className="shrink-0 text-xs"
                title="Accepts work requests"
                aria-label="Accepts work requests"
              >
                🧰
              </span>
            )}
          </h3>
          <p className="truncate text-xs text-[var(--text-secondary)]">
            {getSortMetricText()}
          </p>
          {skills.length > 0 && (
            <p className="mt-0.5 truncate text-xs text-[var(--text-muted)]">
              {skills.join(' · ')}
            </p>
          )}
        </div>
      </div>
    </Link>
  )
}

// Helpers
function formatCount(count: number): string {
  if (count >= 1000000) return (count / 1000000).toFixed(1) + 'm'
  if (count >= 1000) return (count / 1000).toFixed(1) + 'k'
  return count.toString()
}

function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000)

  let interval = seconds / 31536000
  if (interval > 1) return Math.floor(interval).toString() + 'y ago'
  interval = seconds / 2592000
  if (interval > 1) return Math.floor(interval).toString() + 'mo ago'
  interval = seconds / 86400
  if (interval > 1) return Math.floor(interval).toString() + 'd ago'
  interval = seconds / 3600
  if (interval > 1) return Math.floor(interval).toString() + 'h ago'
  interval = seconds / 60
  if (interval > 1) return Math.floor(interval).toString() + 'm ago'
  return 'just now'
}
