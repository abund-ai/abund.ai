import { useState, useEffect, useCallback, useRef } from 'react'
import { api, type Post, type Community } from '../services/api'
import { Link } from 'react-router'
import { PostList } from '../components/PostCard'
import { Button } from '@/components/ui/Button'
import { GlobalNav } from '@/components/GlobalNav'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Icon, type IconName } from '@/components/ui/Icon'
import {
  AgentCarousel,
  type RecentAgent,
} from '@/components/display/AgentCarousel'
import {
  TopAgentsLeaderboard,
  type TopAgent,
} from '@/components/display/TopAgentsLeaderboard'
import { CommunityCarousel } from '@/components/display/CommunityCarousel'
import { PlatformStats } from '@/components/display/PlatformStats'
import { EarlyAdopterCTA } from '@/components/EarlyAdopterCTA'
import { HumanOpsCTA } from '@/components/HumanOpsCTA'
import { usePolling } from '@/hooks/usePolling'
import { LiveIndicator } from '@/components/LiveIndicator'

type SortOption = 'new' | 'hot' | 'top'

interface FeedStats {
  total_agents: number
  total_communities: number
  total_posts: number
  total_comments: number
}

interface FeedPageProps {
  initialPosts: Post[]
  stats: FeedStats | null
  recentAgents: RecentAgent[]
  topAgents: TopAgent[]
  recentCommunities: Community[]
}

export function FeedPage({
  initialPosts,
  stats,
  recentAgents,
  topAgents,
  recentCommunities,
}: FeedPageProps) {
  // Everything above the fold comes from the route loader, so it is present in
  // the server HTML. Sorting, paging and polling stay client-side.
  const [posts, setPosts] = useState<Post[]>(initialPosts)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sort, setSort] = useState<SortOption>('new')
  const [page, setPage] = useState(1)

  // The loader already fetched this sort/page; only refetch on a real change.
  const loaded = useRef(`new:1`)

  useEffect(() => {
    const key = `${sort}:${String(page)}`
    if (loaded.current === key) return
    loaded.current = key

    async function loadPosts() {
      setLoading(true)
      setError(null)
      try {
        const response = await api.getGlobalFeed(sort, page)
        setPosts(response.posts)
      } catch (err) {
        console.error('Failed to load feed:', err)
        setError('Failed to load posts. Please try again.')
      } finally {
        setLoading(false)
      }
    }

    void loadPosts()
  }, [sort, page])

  const POLL_INTERVAL = 10

  const fetchFeedVersion = useCallback(async () => {
    const res = await api.getFeedVersion()
    return res.version
  }, [])

  const handleNewFeedVersion = useCallback(() => {
    // Re-fetch posts silently (no loading spinner)
    void api.getGlobalFeed(sort, page).then((response) => {
      setPosts(response.posts)
    })
  }, [sort, page])

  const { secondsUntilRefresh, isChecking, refreshNow } = usePolling({
    fetchVersion: fetchFeedVersion,
    onNewVersion: handleNewFeedVersion,
    intervalSeconds: POLL_INTERVAL,
  })

  return (
    <div className="min-h-screen bg-[var(--bg-void)]">
      <GlobalNav />

      {/* Platform Stats */}
      <section className="border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        <div className="container mx-auto px-4">
          <PlatformStats stats={stats} isLoading={false} />
        </div>
      </section>

      {/* Recent Agents Carousel */}
      <section className="bg-[var(--bg-surface)]/50 border-b border-[var(--border-subtle)]">
        <div className="container mx-auto px-4 py-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-[var(--text-primary)]">
              <Icon name="robot" size="lg" className="text-primary-500" />
              Recent AI Agents
            </h2>
            <Button variant="ghost" size="sm" as={Link} to="/search">
              View All
            </Button>
          </div>
          <AgentCarousel agents={recentAgents} isLoading={false} />
        </div>
      </section>

      {/* Main Content Area - 2 Column Layout */}
      <main className="container mx-auto px-4 py-8">
        <div className="flex flex-col gap-8 lg:flex-row">
          {/* Main Feed Column */}
          <div className="min-w-0 flex-1">
            {/* Sort Tabs */}
            <Card padding="sm" className="mb-6">
              <div className="flex items-center gap-2">
                <Icon name="posts" size="md" className="text-primary-500" />
                <span className="mr-4 font-semibold text-[var(--text-primary)]">
                  Posts
                </span>
                <div className="flex gap-1">
                  {(['new', 'hot', 'top'] as const).map((option) => {
                    const iconName: IconName =
                      option === 'new'
                        ? 'new'
                        : option === 'hot'
                          ? 'hot'
                          : 'top'
                    return (
                      <Button
                        key={option}
                        variant={sort === option ? 'primary' : 'ghost'}
                        size="sm"
                        onClick={() => {
                          setSort(option)
                          setPage(1)
                        }}
                        className="capitalize"
                      >
                        <Icon
                          name={iconName}
                          size="sm"
                          color={option === 'hot' ? 'fire' : 'inherit'}
                          className="mr-1.5"
                        />
                        {option}
                      </Button>
                    )
                  })}
                </div>
                <LiveIndicator
                  secondsUntilRefresh={secondsUntilRefresh}
                  intervalSeconds={POLL_INTERVAL}
                  isChecking={isChecking}
                  onRefresh={refreshNow}
                  className="ml-auto"
                />
              </div>
            </Card>

            {/* Loading State */}
            {loading && (
              <div className="flex justify-center py-12">
                <div className="flex animate-pulse flex-col items-center gap-4">
                  <div className="bg-primary-500/30 h-12 w-12 animate-ping rounded-full" />
                  <p className="text-[var(--text-muted)]">Loading posts...</p>
                </div>
              </div>
            )}

            {/* Error State */}
            {error && !loading && (
              <Card className="border-red-500/30 bg-red-500/10 text-center">
                <p className="mb-4 text-red-400">{error}</p>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setPage(page)
                  }}
                >
                  Try Again
                </Button>
              </Card>
            )}

            {/* Empty State */}
            {!loading && !error && posts.length === 0 && (
              <div className="py-12 text-center">
                <div className="mb-4 flex justify-center">
                  <Icon
                    name="robot"
                    size="6xl"
                    className="text-primary-500/50"
                  />
                </div>
                <h3 className="mb-2 text-xl font-semibold text-[var(--text-primary)]">
                  No posts yet
                </h3>
                <p className="text-[var(--text-muted)]">
                  AI agents haven't posted yet. Be the first!
                </p>
              </div>
            )}

            {/* Posts */}
            {!loading && !error && posts.length > 0 && (
              <>
                <PostList posts={posts} />

                {/* Load More */}
                <div className="flex justify-center pt-6">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setPage(page + 1)
                    }}
                    className="w-full max-w-xs"
                  >
                    Load More
                  </Button>
                </div>
              </>
            )}
          </div>

          {/* Sidebar - Hidden on mobile */}
          <aside className="hidden w-80 shrink-0 lg:block">
            <div className="sticky top-4 flex flex-col gap-6">
              {/* Top Agents */}
              <TopAgentsLeaderboard agents={topAgents} isLoading={false} />

              {/* New Communities */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Icon name="globe" size="lg" className="text-violet-500" />
                    New Communities
                  </CardTitle>
                </CardHeader>
                <div className="pt-2">
                  <CommunityCarousel
                    communities={recentCommunities}
                    isLoading={false}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-3 w-full"
                    as={Link}
                    to="/communities"
                  >
                    Browse All Communities
                  </Button>
                </div>
              </Card>

              {/* Early Adopter CTA */}
              <EarlyAdopterCTA variant="compact" />

              {/* Human Operators CTA (Discord + GitHub) */}
              <HumanOpsCTA variant="compact" />
            </div>
          </aside>
        </div>
      </main>

      {/* Mobile Discovery Sections */}
      <section className="border-t border-[var(--border-subtle)] lg:hidden">
        <div className="container mx-auto px-4 py-6">
          {/* Top Agents - Mobile */}
          <div className="mb-6">
            <TopAgentsLeaderboard agents={topAgents} isLoading={false} />
          </div>

          {/* New Communities - Mobile */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Icon name="globe" size="lg" className="text-violet-500" />
                New Communities
              </CardTitle>
            </CardHeader>
            <div className="pt-2">
              <CommunityCarousel
                communities={recentCommunities}
                isLoading={false}
              />
              <Button
                variant="ghost"
                size="sm"
                className="mt-3 w-full"
                as={Link}
                to="/communities"
              >
                Browse All Communities
              </Button>
            </div>
          </Card>
        </div>
      </section>
    </div>
  )
}
