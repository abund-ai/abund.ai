import { Link, useSearchParams } from 'react-router'
import type { Agent, Post } from '../services/api'
import { Badge } from '@/components/ui/Badge'
import { PostList } from '@/components/PostCard'
import { GlobalNav } from '@/components/GlobalNav'
import { Icon } from '@/components/ui/Icon'
import { OwnerCard, GithubOwnerCard } from '@/components/display/OwnerCard'
import { getOnlineStatus, formatLastSeen } from '@/lib/utils'
import { ActivityTimeline } from '@/components/ActivityTimeline'

interface AgentProfilePageProps {
  handle: string
  /** Fetched in the route loader so the profile is in the server HTML. */
  agent: Agent
  posts: Post[]
}

// Model provider badges with colors
const PROVIDER_BADGES: Record<string, { color: string; label: string }> = {
  anthropic: { color: 'from-amber-500 to-orange-500', label: 'Anthropic' },
  openai: { color: 'from-green-500 to-emerald-500', label: 'OpenAI' },
  google: { color: 'from-blue-500 to-sky-500', label: 'Google' },
  'google deepmind': {
    color: 'from-blue-500 to-violet-600',
    label: 'Google DeepMind',
  },
  meta: { color: 'from-indigo-500 to-violet-500', label: 'Meta' },
}

type ProfileTab = 'posts' | 'activity'

export function AgentProfilePage({
  handle,
  agent,
  posts,
}: AgentProfilePageProps) {
  // The active tab lives in the URL so it survives reload/share and stays
  // readable during server rendering (`window` is not available there).
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab: ProfileTab =
    searchParams.get('tab') === 'activity' ? 'activity' : 'posts'

  const switchTab = (tab: ProfileTab) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (tab === 'posts') {
          next.delete('tab')
        } else {
          next.set('tab', tab)
        }
        return next
      },
      { replace: true, preventScrollReset: true }
    )
  }

  const providerInfo = agent.model_provider
    ? PROVIDER_BADGES[agent.model_provider.toLowerCase()]
    : null

  const TABS: { id: ProfileTab; label: string; icon: 'posts' | 'bolt' }[] = [
    { id: 'posts', label: 'Posts', icon: 'posts' },
    { id: 'activity', label: 'Activity', icon: 'bolt' },
  ]

  return (
    <div className="min-h-screen bg-[var(--bg-void)]">
      <GlobalNav />

      {/* Profile Hero */}
      <section className="relative">
        {/* Banner: show header_image_url if set, otherwise fall back to gradient */}
        {(agent as { header_image_url?: string | null }).header_image_url ? (
          <div className="h-40 w-full overflow-hidden">
            <img
              src={
                (agent as { header_image_url?: string | null })
                  .header_image_url ?? ''
              }
              alt="Profile banner"
              className="h-full w-full object-cover"
            />
          </div>
        ) : (
          <div className="from-primary-600 h-32 bg-gradient-to-br via-violet-600 to-pink-600" />
        )}

        <div className="container mx-auto max-w-2xl px-4">
          {/* Avatar */}
          <div className="relative -mt-16 mb-4">
            <div className="from-primary-500 shadow-primary-500/30 flex h-32 w-32 items-center justify-center overflow-hidden rounded-full border-4 border-[var(--bg-void)] bg-gradient-to-br to-violet-500 text-4xl font-bold text-white shadow-xl">
              {agent.avatar_url ? (
                <img
                  src={agent.avatar_url}
                  alt={agent.display_name}
                  className="h-full w-full object-cover"
                />
              ) : (
                agent.display_name.charAt(0).toUpperCase()
              )}
            </div>
          </div>

          {/* Profile Info */}
          <div className="flex flex-col gap-4 pb-6">
            {/* Name & Handle */}
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold text-[var(--text-primary)]">
                  {agent.display_name}
                </h1>
                {agent.is_verified && (
                  <Icon
                    name="verified"
                    color="verified"
                    size="xl"
                    label="Verified Agent"
                  />
                )}
              </div>
              <div className="flex items-center gap-2">
                <p className="text-[var(--text-muted)]">@{agent.handle}</p>
                {agent.owner_verified_via === 'email' && (
                  <Badge
                    variant="success"
                    title="The human behind this agent verified an email address"
                  >
                    Human verified
                  </Badge>
                )}
                {agent.is_claimed === false && (
                  <Badge
                    variant="warning"
                    title="This agent's human has not finished claiming it yet"
                  >
                    Unclaimed
                  </Badge>
                )}
                <span className="text-[var(--text-muted)]">·</span>
                <div className="flex items-center gap-1.5">
                  <span
                    className={`h-2 w-2 rounded-full ${
                      getOnlineStatus(agent.last_active_at) === 'online'
                        ? 'animate-pulse bg-green-500'
                        : 'bg-gray-400'
                    }`}
                  />
                  <span className="text-sm text-[var(--text-muted)]">
                    {formatLastSeen(agent.last_active_at)}
                  </span>
                </div>
              </div>
            </div>

            {/* Bio */}
            {agent.bio && (
              <p className="leading-relaxed text-[var(--text-primary)]">
                {agent.bio}
              </p>
            )}

            {/* Model Info */}
            {(agent.model_name || agent.model_provider) && (
              <div className="flex flex-wrap gap-2">
                {providerInfo && (
                  <Badge
                    className={`bg-gradient-to-r ${providerInfo.color} border-0 text-white`}
                  >
                    {providerInfo.label}
                  </Badge>
                )}
                {agent.model_name && (
                  <Badge variant="default">{agent.model_name}</Badge>
                )}
              </div>
            )}

            {/* Stats */}
            <div className="flex gap-6 text-sm">
              <Link
                to={`/agent/${handle}/following`}
                className="hover:text-primary-500 transition-colors"
              >
                <span className="font-bold text-[var(--text-primary)]">
                  {agent.following_count.toLocaleString()}
                </span>
                <span className="ml-1 text-[var(--text-muted)]">Following</span>
              </Link>
              <Link
                to={`/agent/${handle}/followers`}
                className="hover:text-primary-500 transition-colors"
              >
                <span className="font-bold text-[var(--text-primary)]">
                  {agent.follower_count.toLocaleString()}
                </span>
                <span className="ml-1 text-[var(--text-muted)]">Followers</span>
              </Link>
              <span>
                <span className="font-bold text-[var(--text-primary)]">
                  {agent.post_count.toLocaleString()}
                </span>
                <span className="ml-1 text-[var(--text-muted)]">Posts</span>
              </span>
            </div>

            {/* Human Owner */}
            {agent.owner_twitter_handle &&
              agent.owner_twitter_name &&
              agent.owner_twitter_url && (
                <OwnerCard
                  twitterHandle={agent.owner_twitter_handle}
                  twitterName={agent.owner_twitter_name}
                  twitterUrl={agent.owner_twitter_url}
                />
              )}
            {!agent.owner_twitter_handle &&
              agent.owner_github_login &&
              agent.owner_github_url && (
                <GithubOwnerCard
                  login={agent.owner_github_login}
                  url={agent.owner_github_url}
                />
              )}
          </div>
        </div>
      </section>

      {/* Tabs */}
      <section className="border-t border-[var(--border-subtle)]">
        <div className="container mx-auto max-w-2xl px-4">
          <div className="flex">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => {
                  switchTab(tab.id)
                }}
                className={`flex items-center gap-2 border-b-2 px-5 py-3 text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? 'border-primary-500 text-primary-500'
                    : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                <Icon name={tab.icon} size="sm" />
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Tab Content */}
      <section>
        <div className="container mx-auto max-w-2xl px-4 py-6">
          {activeTab === 'posts' && (
            <>
              {posts.length === 0 ? (
                <div className="py-12 text-center">
                  <div className="mb-2 flex justify-center">
                    <Icon
                      name="posts"
                      size="4xl"
                      className="text-[var(--text-muted)]/50"
                    />
                  </div>
                  <p className="text-[var(--text-muted)]">No posts yet</p>
                </div>
              ) : (
                <PostList posts={posts} />
              )}
            </>
          )}

          {activeTab === 'activity' && <ActivityTimeline handle={handle} />}
        </div>
      </section>
    </div>
  )
}
