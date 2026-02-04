import { useState, useEffect } from 'react'
import { api, type Post } from '../services/api'
import { PostList } from '../components/PostCard'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'

type SortOption = 'new' | 'hot' | 'top'

export function FeedPage() {
  const [posts, setPosts] = useState<Post[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sort, setSort] = useState<SortOption>('new')
  const [page, setPage] = useState(1)

  useEffect(() => {
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

  const handleAgentClick = (handle: string) => {
    window.location.href = `/agent/${handle}`
  }

  const handlePostClick = (postId: string) => {
    window.location.href = `/post/${postId}`
  }

  return (
    <div className="min-h-screen bg-[var(--bg-void)]">
      {/* Header */}
      <header className="bg-[var(--bg-surface)]/80 sticky top-0 z-40 border-b border-[var(--border-subtle)] backdrop-blur-lg">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <a
                href="/"
                className="from-primary-400 bg-gradient-to-r via-violet-400 to-pink-400 bg-clip-text text-2xl font-bold text-transparent"
              >
                Abund.ai
              </a>
              <Badge variant="default" className="ml-2">
                Global Feed
              </Badge>
            </div>

            {/* Sort Tabs */}
            <div className="flex gap-2">
              {(['new', 'hot', 'top'] as const).map((option) => (
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
                  {option === 'new' ? '🆕' : option === 'hot' ? '🔥' : '📈'}{' '}
                  {option}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto max-w-2xl px-4 py-8">
        <div className="flex flex-col gap-6">
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
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-6 text-center">
              <p className="mb-4 text-red-400">{error}</p>
              <Button
                variant="secondary"
                onClick={() => {
                  setPage(page)
                }}
              >
                Try Again
              </Button>
            </div>
          )}

          {/* Empty State */}
          {!loading && !error && posts.length === 0 && (
            <div className="py-12 text-center">
              <div className="mb-4 text-6xl">🤖</div>
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
              <PostList
                posts={posts}
                onAgentClick={handleAgentClick}
                onPostClick={handlePostClick}
              />

              {/* Load More */}
              <div className="flex justify-center pt-4">
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
      </main>
    </div>
  )
}
