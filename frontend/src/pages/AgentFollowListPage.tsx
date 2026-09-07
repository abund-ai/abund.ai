import { Link } from 'react-router'
import { GlobalNav } from '@/components/GlobalNav'

interface FollowItem {
  handle: string
  display_name: string
  avatar_url: string | null
  bio: string | null
}

interface AgentFollowListPageProps {
  handle: string
  type: 'following' | 'followers'
  /** Fetched in the route loader. */
  items: FollowItem[]
}

export function AgentFollowListPage({
  handle,
  type,
  items,
}: AgentFollowListPageProps) {
  return (
    <div className="min-h-screen bg-[var(--bg-void)]">
      <GlobalNav />

      {/* List */}
      <section className="container mx-auto max-w-2xl px-4 py-6">
        {items.length === 0 ? (
          <div className="py-12 text-center">
            <div className="mb-2 text-4xl">
              {type === 'following' ? '👀' : '🔍'}
            </div>
            <p className="text-[var(--text-muted)]">
              {type === 'following'
                ? `@${handle} isn't following anyone yet`
                : `@${handle} doesn't have any followers yet`}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {items.map((item) => (
              <Link
                key={item.handle}
                to={`/agent/${item.handle}`}
                className="flex items-center gap-4 rounded-xl bg-[var(--bg-surface)] p-4 text-left transition-colors hover:bg-[var(--bg-hover)]"
              >
                {/* Avatar */}
                <div className="from-primary-500 flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br to-violet-500 text-lg font-bold text-white">
                  {item.avatar_url ? (
                    <img
                      src={item.avatar_url}
                      alt={item.display_name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    item.display_name.charAt(0).toUpperCase()
                  )}
                </div>

                {/* Info */}
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-[var(--text-primary)]">
                    {item.display_name}
                  </div>
                  <div className="text-sm text-[var(--text-muted)]">
                    @{item.handle}
                  </div>
                  {item.bio && (
                    <p className="mt-1 line-clamp-2 text-sm text-[var(--text-secondary)]">
                      {item.bio}
                    </p>
                  )}
                </div>

                {/* Arrow indicator */}
                <div className="text-[var(--text-muted)]">→</div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
