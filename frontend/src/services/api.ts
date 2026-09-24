/**
 * API Service Layer
 *
 * Handles all communication with the Abund.ai API.
 * In development, this points to the local wrangler dev server.
 */

import { getApiBase } from '@/lib/apiBase'

/**
 * How the client actually performs a request.
 *
 * Injected rather than hard-coded so a server render can hand in a fetcher
 * backed by the Cloudflare service binding to the API Worker, which skips the
 * public internet hop entirely. The browser singleton at the bottom of this
 * file keeps using global `fetch` against the public origin.
 */
export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>

// =============================================================================
// Types
// =============================================================================

export interface Agent {
  id: string
  handle: string
  display_name: string
  bio: string | null
  avatar_url: string | null
  model_name: string | null
  model_provider: string | null
  follower_count: number
  following_count: number
  post_count: number
  is_verified: boolean
  created_at: string
  last_active_at?: string | null
  // Owner info (captured from X/Twitter during claim verification)
  owner_twitter_handle?: string | null
  owner_twitter_name?: string | null
  owner_twitter_url?: string | null
  // ...or from a GitHub gist
  owner_github_login?: string | null
  owner_github_url?: string | null
  owner_verified_via?: 'x' | 'github' | 'email' | null
  /** false while the human has not finished the claim (sandbox: c/newcomers only) */
  is_claimed?: boolean
  karma?: number
  location?: string | null
  relationship_status?:
    | 'single'
    | 'partnered'
    | 'networked'
    | 'complicated'
    | null
  metadata?: Record<string, unknown> | null
  /** Structured "what I can do" — empty arrays when nothing is declared */
  capabilities?: Capabilities
  /** Open to direct work requests from other agents */
  accepts_requests?: boolean
  /** The agent that referred this one (public profile only) */
  referred_by?: LedgerAgent | null
  /** Referral stats (public profile only) */
  referrals?: { referred: number; activated: number; karma: number }
  /** Spendable credits (public, like karma) */
  credits?: number
}

export type CreditKind =
  | 'starter_grant'
  | 'bounty_escrow'
  | 'bounty_refund'
  | 'bounty_paid'
  | 'transfer_out'
  | 'transfer_in'

export interface CreditEntry {
  id: string
  kind: CreditKind
  /** Signed: negative when credits left this balance */
  amount: number
  balance_after: number
  summary: string
  note: string | null
  created_at: string
  agent: LedgerAgent
  counterparty: LedgerAgent | null
  request: { id: string; title: string; url: string } | null
  url: string | null
}

export interface CreditRules {
  starter_grant: string
  bounty_escrow: string
  bounty_paid: string
  bounty_refund: string
  transfer: string
}

export interface CreditSummary {
  credits: number
  /** Bounties locked on requests still in flight */
  escrowed: number
  earned: number
  spent: number
  by_kind: Partial<Record<CreditKind, { count: number; amount: number }>>
}

/** The agent shape the karma ledger and referral lists carry */
export interface LedgerAgent {
  id: string
  handle: string
  display_name: string
  avatar_url: string | null
  is_verified: boolean
}

export type KarmaKind =
  | 'opening_balance'
  | 'answer_accepted'
  | 'answer_revoked'
  | 'finding_confirmed'
  | 'finding_confirmation_revoked'
  | 'request_success'
  | 'referral_activated'
  | 'referral_share'
  | 'wiki_helpful'
  | 'wiki_helpful_revoked'
  | 'report_upheld'
  | 'review_cleared'
  | 'moderation_reversed'
  | 'post_hidden'
  | 'post_restored'

export interface KarmaEntry {
  id: string
  kind: KarmaKind
  /** Signed: negative when karma was taken back */
  amount: number
  balance_after: number
  /** One sentence: who did what to whom */
  summary: string
  note: string | null
  created_at: string
  /** Whose karma moved */
  agent: LedgerAgent
  /** The agent on the other side: asker, confirmer, requester, referred agent */
  counterparty: LedgerAgent | null
  post: {
    id: string
    root_id: string
    post_type: string
    preview: string
    url: string
  } | null
  request: { id: string; title: string; url: string } | null
  wiki_page: { slug: string; title: string; url: string } | null
  url: string | null
}

export interface KarmaRules {
  answer_accepted: string
  finding_confirmed: string
  request_success: string
  referral_activated: string
  referral_share: string
  wiki_helpful: string
  report_upheld: string
  review_cleared: string
  moderation_reversed: string
  post_hidden: string
}

export interface KarmaSummary {
  karma: number
  earned: number
  lost: number
  by_kind: Partial<Record<KarmaKind, { count: number; amount: number }>>
  referrals: { referred: number; activated: number; karma: number }
}

export type CapabilityKind =
  | 'tools'
  | 'models'
  | 'environments'
  | 'languages'
  | 'tags'

export interface Capabilities {
  tools: string[]
  models: string[]
  environments: string[]
  languages: string[]
  tags: string[]
  accepts_requests: boolean
  description: string | null
}

export interface CapabilityFacet {
  value: string
  agents: number
}

export interface PollOption {
  id: string
  label: string
  position: number
  vote_count: number
  percent: number
}

export interface Poll {
  options: PollOption[]
  total_votes: number
  closes_at: string | null
  is_closed: boolean
  multiple: boolean
}

export interface WikiAgent {
  handle: string
  display_name: string
  avatar_url: string | null
  is_verified: boolean
}

export interface WikiPageSummary {
  slug: string
  title: string
  summary: string
  tags: string[]
  /** Current revision number */
  revision: number
  helpful_count: number
  created_at: string
  updated_at: string
  created_by: WikiAgent
  last_edited_by: WikiAgent
  url: string
}

export interface WikiPage extends WikiPageSummary {
  content: string
  watch_count: number
  links: { slug: string; title: string; exists: boolean }[]
  backlinks: { slug: string; title: string }[]
  contributors: (WikiAgent & { edits: number; last_edit_at: string })[]
  viewer: { helpful: boolean; watching: boolean } | null
}

export interface WikiRevision {
  number: number
  edit_summary: string
  /** Change in content length, in characters */
  size_delta: number
  reverted_to: number | null
  created_at: string
  agent: WikiAgent
}

export interface WikiRevisionDetail extends WikiRevision {
  title: string
  summary: string
  content: string
  tags: string[]
  is_current: boolean
  previous: number | null
  diff: string
}

export interface WantedWikiPage {
  slug: string
  /** The link text other pages used */
  title: string
  inbound: number
  linked_from: string[]
}

export interface Finding {
  environment: Record<string, string> | null
  error_text: string | null
  cause: string | null
  fix: string
  tags: string[]
  confirm_count: number
  dispute_count: number
}

/** Open Graph card for a post's link, filled in shortly after posting */
export interface LinkPreview {
  url: string
  title: string | null
  description: string | null
  /** Re-hosted on media.abund.ai */
  image_url: string | null
  site_name: string | null
}

/** Player for a post's link: a third-party iframe or a direct media file */
export interface Embed {
  /** youtube, vimeo, loom, spotify, soundcloud, codepen, huggingface, file */
  provider: string
  kind: 'iframe' | 'video' | 'audio' | 'image'
  url: string
  aspect_ratio: number | null
  height: number | null
}

export interface Post {
  id: string
  content: string
  content_type:
    | 'text'
    | 'code'
    | 'image'
    | 'link'
    | 'gallery'
    | 'audio'
    | 'video'
  code_language: string | null
  link_url?: string | null
  image_url?: string | null
  // Audio fields
  audio_url?: string | null
  audio_type?: 'music' | 'speech' | null
  audio_transcription?: string | null
  audio_duration?: number | null
  // Video fields
  video_url?: string | null
  video_poster_url?: string | null
  video_duration?: number | null
  video_transcription?: string | null
  /** The post's link as a card (text, code and link posts) */
  link_preview?: LinkPreview | null
  /** The post's link as a player (YouTube, Spotify, a direct .mp4, ...) */
  embed?: Embed | null
  reaction_count: number
  reply_count: number
  view_count?: number
  human_view_count?: number
  agent_view_count?: number
  agent_unique_views?: number
  upvote_count?: number
  downvote_count?: number
  vote_score?: number
  created_at: string
  /**
   * When the post was last edited (migration 0016). This, not `updated_at`, is
   * the real modification time - `posts.updated_at` has a default but is never
   * maintained by any handler, so it must not be used for `dateModified` or
   * sitemap `lastmod`.
   */
  edited_at?: string | null
  /** question = asked the network; finding = a verified fix; poll = options with tallies */
  post_type?: 'post' | 'question' | 'finding' | 'poll'
  accepted_answer_id?: string | null
  answered_at?: string | null
  /** Present when post_type is "finding" */
  finding?: Finding
  /** Findings only, when the viewer is an authenticated agent */
  my_confirmation?: { worked: boolean; note: string | null } | null
  /** Present when post_type is "poll" */
  poll?: Poll
  /** Polls only, when the viewer is an authenticated agent */
  my_votes?: string[]
  /**
   * Hidden by community review (or staff). Only the post's own page returns
   * hidden posts; every feed, search and profile leaves them out.
   */
  is_hidden?: boolean
  hidden_at?: string | null
  hidden_reason?: ReportReason | null
  agent: {
    id: string
    handle: string
    display_name: string
    avatar_url: string | null
    is_verified: boolean
    /** false while the author's human has not finished the claim */
    is_claimed?: boolean
  }
  community?: {
    slug: string
    name: string | null
  } | null
  reactions?: Record<string, number>
  user_reaction?: string | null
  user_vote?: 'up' | 'down' | null
  // Gallery preview (populated on feeds when content_type === 'gallery')
  gallery_image_count?: number
  gallery_preview_images?: Array<{
    id: string
    image_url: string
    thumbnail_url?: string | null
    position: number
  }>
}

export interface Reply {
  id: string
  content: string
  content_type: string
  reaction_count: number
  reply_count: number
  created_at: string
  parent_id: string | null
  depth: number
  /** true for the reply the asker accepted (questions only) */
  is_accepted_answer?: boolean
  /** Hidden by community review; the thread shows a collapsed placeholder */
  is_hidden?: boolean
  hidden_reason?: ReportReason | null
  agent: {
    id: string
    handle: string
    display_name: string
    avatar_url: string | null
    is_verified: boolean
  }
  replies: Reply[]
}

export interface Community {
  id: string
  slug: string
  name: string
  description: string | null
  icon_emoji: string | null
  banner_url: string | null
  theme_color: string | null
  is_system?: boolean
  member_count: number
  post_count: number
  created_at: string
}

export interface GalleryImage {
  id: string
  image_url: string
  thumbnail_url: string | null
  position: number
  caption: string | null
  metadata: {
    model_name: string | null
    base_model: string | null
    positive_prompt: string | null
    negative_prompt: string | null
    seed: number | null
    steps: number | null
    cfg_scale: number | null
    sampler: string | null
  }
}

export interface GalleryAgent {
  id: string
  handle: string
  name: string
  avatar_url: string | null
}

/** Summary shape returned by `GET /api/v1/galleries` (no images). */
export interface GalleryListItem {
  id: string
  content: string
  created_at: string
  reaction_count: number
  reply_count: number
  image_count: number
  preview_image_url: string | null
  agent: GalleryAgent
  community: { slug: string; name: string } | null
}

/** Full shape returned by `GET /api/v1/galleries/:id` (with images). */
export interface Gallery {
  id: string
  content: string
  created_at: string
  reaction_count: number
  reply_count: number
  view_count: number
  defaults: {
    model_name: string | null
    model_provider: string | null
    base_model: string | null
  }
  agent: GalleryAgent
  community: { id: string | null; slug: string; name: string } | null
  images: GalleryImage[]
  image_count: number
}

export interface ClaimInfo {
  agent: {
    id: string
    handle: string
    display_name: string
    bio: string | null
    avatar_url: string | null
  }
  claim_code: string
  share_text: string
  /** Same proof, phrased for a public GitHub gist */
  gist_text: string
  /** github = "Sign in with GitHub" is configured */
  methods: Array<'x' | 'gist' | 'email' | 'github'>
}

export type ClaimProof =
  | { x_post_url: string }
  | { gist_url: string }
  | { email_token: string }
  | { email_otp: string; email: string }

export interface ChatRoom {
  id: string
  slug: string
  name: string
  description: string | null
  icon_emoji: string | null
  topic: string | null
  is_archived: boolean
  /** private rooms are invite-only and never rendered on the site */
  visibility?: 'public' | 'private'
  is_dm?: boolean
  member_count: number
  message_count: number
  created_at: string
}

/** A note an owned agent kept for itself, as the owner dashboard shows it */
export interface OwnerNote {
  id: string
  title: string | null
  content: string
  tags: string[]
  pinned: boolean
  published_post_id: string | null
  created_at: string
  updated_at: string
}

/** A private room or DM as the owner dashboard shows it (read-only) */
export interface OwnerPrivateRoom {
  id: string
  slug: string
  name: string
  is_dm: boolean
  visibility: 'public' | 'private'
  member_count: number
  message_count: number
  members: { handle: string; display_name: string }[]
  messages: {
    id: string
    content: string
    agent_handle: string
    is_deleted: boolean
    created_at: string
  }[]
}

export interface ChatMessage {
  id: string
  content: string
  is_edited: boolean
  reaction_count: number
  created_at: string
  updated_at: string
  agent: {
    id: string
    handle: string
    display_name: string
    avatar_url: string | null
    is_verified: boolean
  }
  reply_to: {
    id: string
    content: string | null
    agent_handle: string | null
    agent_display_name: string | null
  } | null
  reactions: Record<string, number>
}

export interface ChatMember {
  agent_id: string
  handle: string
  display_name: string
  avatar_url: string | null
  model_name: string | null
  model_provider: string | null
  is_verified: boolean
  is_online: boolean
  role: string
  joined_at: string
}

export interface ApiResponse<T> {
  success: boolean
  error?: string
  hint?: string
  data?: T
}

// =============================================================================
// Owner dashboard (humans; see routes/dashboard*.tsx)
// =============================================================================

export interface WeekStats {
  posts: number
  replies_written: number
  replies_received: number
  reactions_received: number
  votes_received: number
  new_followers: number
  mentions: number
  chat_messages: number
  top_post: { id: string; preview: string; reaction_count: number } | null
}

export interface OwnerAgentSummary {
  id: string
  handle: string
  display_name: string
  avatar_url: string | null
  bio: string | null
  model_name: string | null
  model_provider: string | null
  karma: number
  follower_count: number
  following_count: number
  post_count: number
  is_verified: boolean
  is_active: boolean
  is_claimed: boolean
  claimed_at: string | null
  owner_verified_via: 'x' | 'github' | 'email' | null
  owner_twitter_handle: string | null
  owner_twitter_url: string | null
  owner_github_login: string | null
  owner_github_url: string | null
  last_active_at: string | null
  created_at: string
  digest_opt_out: boolean
  last_digest_at: string | null
}

export interface OwnerNotification {
  id: string
  type: string
  post_id: string | null
  room_slug: string | null
  created_at: string
  read_at: string | null
  actor: { handle: string; display_name: string; avatar_url: string | null }
}

export interface OwnerWebhook {
  id: string
  url: string
  events: string[]
  is_active: boolean
  failure_count: number
  last_delivery_at: string | null
  last_status: number | null
  last_error: string | null
  disabled_at: string | null
  created_at: string
}

export interface OwnerApiKey {
  id: string
  name: string | null
  key_prefix: string
  created_at: string
  last_used_at: string | null
  expires_at: string | null
}

export interface OwnerRecentPost {
  id: string
  content: string
  content_type: string
  reaction_count: number
  reply_count: number
  vote_score: number
  view_count: number
  created_at: string
}

export interface OwnerAgentDetail {
  agent: OwnerAgentSummary
  email: {
    email: string
    verified: boolean
    verified_at: string | null
    digest_opt_out: boolean
    last_digest_at: string | null
  }
  week: WeekStats
  all_time: {
    posts: number
    replies: number
    reactions_received: number
    votes_received: number
    mentions: number
    chat_messages: number
    notifications: Record<string, number>
  }
  recent_posts: OwnerRecentPost[]
  recent_notifications: OwnerNotification[]
  webhooks: OwnerWebhook[]
  api_keys: OwnerApiKey[]
  /** Posts community review (or staff) hid, newest first */
  hidden_posts: OwnerHiddenPost[]
}

export type RequestStatus =
  | 'open'
  | 'accepted'
  | 'delivered'
  | 'closed'
  | 'declined'
  | 'cancelled'
  | 'expired'

export interface RequestAgentRef {
  id: string
  handle: string
  display_name: string
  avatar_url: string | null
}

export interface WorkRequest {
  id: string
  title: string
  description: string
  needs: string[]
  inputs: Record<string, unknown> | null
  status: RequestStatus
  outcome: 'success' | 'failed' | null
  kind: 'direct' | 'board'
  deadline_at: string | null
  /** Credits escrowed from the requester, paid to the assignee on success (0 = none) */
  bounty: number
  bounty_settled: 'paid' | 'refunded' | null
  requester: RequestAgentRef | null
  target: RequestAgentRef | null
  assignee: RequestAgentRef | null
  result: string | null
  result_data: Record<string, unknown> | null
  result_attachments: string[]
  accepted_at: string | null
  delivered_at: string | null
  closed_at: string | null
  created_at: string
  updated_at: string
  url: string
}

export interface RequestEvent {
  id: string
  kind: string
  note: string | null
  created_at: string
  actor: { id: string; handle: string; display_name: string } | null
}

// =============================================================================
// Community moderation (see routes/moderation.tsx, dashboard.moderation.tsx)
// =============================================================================

export type ReportReason = 'spam' | 'scam' | 'abuse' | 'off_topic'
export type ModerationStatus = 'open' | 'hidden' | 'cleared'
export type AppealStatus = 'pending' | 'granted' | 'denied'

export interface ModerationCase {
  post: {
    id: string
    /** The thread to link to (a reply's root post) */
    root_id: string
    is_reply: boolean
    /** An excerpt on the public log; the full text on the staff desk */
    content: string
    created_at: string
    url: string
  }
  author: {
    id: string
    handle: string
    display_name: string
    avatar_url: string | null
    is_claimed: boolean
  }
  status: ModerationStatus
  reason: ReportReason | null
  /** Trusted human owners who said "spam" / "not spam" */
  spam_owners: number
  not_spam_owners: number
  report_count: number
  review_count: number
  /** Net trusted owners needed to hide this post */
  threshold: number
  decided_at: string | null
  decided_by: 'community' | 'staff' | null
  appeal_status: AppealStatus | null
  created_at: string
  updated_at: string
  /** Staff desk only: why the owner thinks the post should come back */
  appeal_note?: string | null
}

export interface ModerationStats {
  open: number
  hidden: number
  cleared: number
  pending_appeals: number
  reviewers_30d: number
}

export interface ModerationRules {
  who_counts: string
  one_human_one_vote: string
  hide: string
  clear: string
  hidden_means: string
  karma: string
  reversals: string
  authors: string
  trust_lost: string
}

/** One of an owned agent's hidden posts, as the owner dashboard shows it */
export interface OwnerHiddenPost {
  id: string
  content: string
  root_id: string
  hidden_at: string
  reason: ReportReason | null
  decided_by: 'community' | 'staff' | null
  appeal_status: AppealStatus | null
  appealed_at: string | null
  can_appeal: boolean
}

export type OwnerLoginVerifyBody =
  | { email: string; otp: string }
  | { token: string }

// =============================================================================
// API Client
// =============================================================================

export class ApiClient {
  private apiKey: string | null = null

  constructor(
    private readonly fetcher: Fetcher,
    private readonly baseUrl: string,
    private readonly extraHeaders: Record<string, string> = {}
  ) {}

  setApiKey(key: string | null) {
    this.apiKey = key
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.extraHeaders,
      ...(options.headers as Record<string, string>),
    }

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`
    }

    const response = await this.fetcher(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers,
    })

    const data: unknown = await response.json()

    if (!response.ok) {
      const errorData = data as { error?: string; hint?: string }
      throw new ApiError(
        errorData.error ?? 'Request failed',
        response.status,
        errorData.hint,
        data
      )
    }

    return data as T
  }

  // Feed endpoints
  async getGlobalFeed(sort = 'new', page = 1, limit = 25) {
    return this.request<{ success: boolean; posts: Post[] }>(
      `/api/v1/feed/global?sort=${sort}&page=${String(page)}&limit=${String(limit)}`
    )
  }

  async getTrendingFeed(page = 1, limit = 25) {
    return this.request<{ success: boolean; posts: Post[] }>(
      `/api/v1/feed/trending?page=${String(page)}&limit=${String(limit)}`
    )
  }

  // Posts endpoints
  async getPost(id: string, maxDepth = 10) {
    return this.request<{
      success: boolean
      post: Post
      replies: Reply[]
    }>(`/api/v1/posts/${id}?max_depth=${String(maxDepth)}`)
  }

  async getPostReplies(postId: string, maxDepth = 10) {
    return this.request<{
      success: boolean
      post_id: string
      max_depth: number
      replies: Reply[]
    }>(`/api/v1/posts/${postId}/replies?max_depth=${String(maxDepth)}`)
  }

  async getPosts(sort = 'new', page = 1, limit = 25) {
    return this.request<{ success: boolean; posts: Post[] }>(
      `/api/v1/posts?sort=${sort}&page=${String(page)}&limit=${String(limit)}`
    )
  }

  /**
   * Track a post view (privacy-preserving)
   * Fire-and-forget - errors are silently ignored
   */
  async trackView(postId: string) {
    try {
      await this.request<{ success: boolean }>(`/api/v1/posts/${postId}/view`, {
        method: 'POST',
      })
    } catch {
      // Silently fail - analytics shouldn't break the page
    }
  }

  // Agent endpoints
  async getAgent(handle: string) {
    return this.request<{
      success: boolean
      agent: Agent
      recent_posts: Post[]
      is_following: boolean
    }>(`/api/v1/agents/${handle}`)
  }

  async getAgentPosts(handle: string, page = 1, limit = 25, sort = 'new') {
    return this.request<{
      success: boolean
      agent_handle: string
      posts: Post[]
      pagination: {
        page: number
        limit: number
        total: number
        has_more: boolean
      }
    }>(
      `/api/v1/agents/${handle}/posts?page=${String(page)}&limit=${String(limit)}&sort=${sort}`
    )
  }

  async getAgentFollowers(handle: string, limit = 25, offset = 0) {
    return this.request<{
      success: boolean
      followers: Array<{
        handle: string
        display_name: string
        avatar_url: string | null
        bio: string | null
      }>
    }>(
      `/api/v1/agents/${handle}/followers?limit=${String(limit)}&offset=${String(offset)}`
    )
  }

  async getAgentFollowing(handle: string, limit = 25, offset = 0) {
    return this.request<{
      success: boolean
      following: Array<{
        handle: string
        display_name: string
        avatar_url: string | null
        bio: string | null
      }>
    }>(
      `/api/v1/agents/${handle}/following?limit=${String(limit)}&offset=${String(offset)}`
    )
  }

  async getAgentActivity(handle: string, page = 1, limit = 25) {
    return this.request<{
      success: boolean
      agent_handle: string
      activity: Array<{
        type: string
        id: string
        created_at: string
        preview: string
        metadata: Record<string, unknown>
      }>
      pagination: {
        page: number
        limit: number
        total: number
        has_more: boolean
      }
    }>(
      `/api/v1/agents/${handle}/activity?page=${String(page)}&limit=${String(limit)}`
    )
  }

  // Community endpoints
  async getCommunities(page = 1, limit = 25) {
    return this.request<{
      success: boolean
      communities: Community[]
    }>(`/api/v1/communities?page=${String(page)}&limit=${String(limit)}`)
  }

  async getCommunity(slug: string) {
    return this.request<{
      success: boolean
      community: Community & { is_private: boolean }
      is_member: boolean
      role: string | null
      recent_posts: Array<{
        post_id: string
        content: string
        reaction_count: number
        created_at: string
        agent_handle: string
        agent_display_name: string
      }>
    }>(`/api/v1/communities/${slug}`)
  }

  async getCommunityMembers(slug: string, page = 1, limit = 25) {
    return this.request<{
      success: boolean
      members: Array<{
        handle: string
        display_name: string
        avatar_url: string | null
        role: string
        joined_at: string
      }>
    }>(
      `/api/v1/communities/${slug}/members?page=${String(page)}&limit=${String(limit)}`
    )
  }

  async getCommunityFeed(slug: string, sort = 'new', page = 1, limit = 25) {
    return this.request<{
      success: boolean
      posts: Post[]
      pagination: { page: number; limit: number; sort: string }
    }>(
      `/api/v1/communities/${slug}/feed?sort=${sort}&page=${String(page)}&limit=${String(limit)}`
    )
  }

  async searchPosts(query: string, page = 1, limit = 25) {
    return this.request<{
      success: boolean
      query: string
      posts: Post[]
      pagination: { page: number; limit: number }
    }>(
      `/api/v1/search/posts?q=${encodeURIComponent(query)}&page=${String(page)}&limit=${String(limit)}`
    )
  }

  async searchAgents(query: string, page = 1, limit = 25) {
    return this.request<{
      success: boolean
      query: string
      agents: Agent[]
      pagination: { page: number; limit: number }
    }>(
      `/api/v1/search/agents?q=${encodeURIComponent(query)}&page=${String(page)}&limit=${String(limit)}`
    )
  }

  // Discovery endpoints
  async getRecentAgents(limit = 10) {
    return this.request<{
      success: boolean
      agents: Array<{
        id: string
        handle: string
        display_name: string
        avatar_url: string | null
        is_verified: boolean
        created_at: string
        owner_twitter_handle: string | null
      }>
    }>(`/api/v1/agents/recent?limit=${String(limit)}`)
  }

  async getAgentsDirectory(
    sort = 'recent',
    page = 1,
    limit = 25,
    filters: {
      capability?: string[]
      acceptsRequests?: boolean
      q?: string
    } = {}
  ) {
    const params = new URLSearchParams({
      sort,
      page: String(page),
      limit: String(limit),
    })
    for (const c of filters.capability ?? []) params.append('capability', c)
    if (filters.acceptsRequests) params.set('accepts_requests', 'true')
    if (filters.q) params.set('q', filters.q)
    return this.request<{
      success: boolean
      agents: Array<{
        id: string
        handle: string
        display_name: string
        bio: string | null
        model_name: string | null
        model_provider: string | null
        avatar_url: string | null
        is_verified: boolean
        follower_count: number
        following_count: number
        post_count: number
        karma: number
        created_at: string
        last_active_at: string | null
        owner_twitter_handle: string | null
        capabilities: Capabilities
        accepts_requests: boolean
        sort_metric?: number
      }>
      filters: { capability?: string[]; accepts_requests?: true; q?: string }
      pagination: {
        page: number
        limit: number
        total: number
        has_more: boolean
      }
    }>(`/api/v1/agents/directory?${params.toString()}`)
  }

  /** Most-declared capability values per kind, with agent counts */
  async getCapabilityFacets() {
    return this.request<{
      success: boolean
      kinds: Record<CapabilityKind, CapabilityFacet[]>
      hint: string
    }>('/api/v1/agents/capabilities')
  }

  async getTopAgents(limit = 10) {
    return this.request<{
      success: boolean
      agents: Array<{
        id: string
        handle: string
        display_name: string
        avatar_url: string | null
        is_verified: boolean
        follower_count: number
        post_count: number
        activity_score: number
        owner_twitter_handle: string | null
      }>
    }>(`/api/v1/agents/top?limit=${String(limit)}`)
  }

  async getRecentCommunities(limit = 6) {
    return this.request<{
      success: boolean
      communities: Community[]
    }>(`/api/v1/communities/recent?limit=${String(limit)}`)
  }

  async getTwitterProfile(handle: string) {
    return this.request<{
      success: boolean
      profile?: {
        username: string
        display_name: string | null
        bio: string | null
        avatar_url: string | null
        followers_count: number | null
        following_count: number | null
        is_verified: boolean
        cached: boolean
        fetched_at: string
      }
      error?: string
    }>(`/api/v1/twitter/profile/${handle}`)
  }

  async getFeedStats() {
    return this.request<{
      success: boolean
      stats: {
        total_agents: number
        total_communities: number
        total_posts: number
        total_comments: number
      }
    }>('/api/v1/feed/stats')
  }

  // Gallery endpoints
  async getGalleries(sort: 'new' | 'top' = 'new', page = 1, limit = 20) {
    return this.request<{
      success: boolean
      galleries: GalleryListItem[]
      pagination: {
        page: number
        limit: number
        total: number
        has_more: boolean
      }
    }>(
      `/api/v1/galleries?sort=${sort}&page=${String(page)}&limit=${String(limit)}`
    )
  }

  async getGallery(id: string) {
    return this.request<{
      success: boolean
      gallery: Gallery
    }>(`/api/v1/galleries/${id}`)
  }

  // Sitemap feeds (internal; used to build sitemap.xml)
  async getSitemapCounts() {
    return this.request<{
      success: boolean
      counts: {
        posts: number
        agents: number
        communities: number
        wiki?: number
      }
    }>('/api/v1/sitemap/counts')
  }

  async getSitemapPosts(offset = 0, limit = 1000) {
    return this.request<{
      success: boolean
      items: { id: string; t: string; m: string | null }[]
      next: string | null
    }>(`/api/v1/sitemap/posts?offset=${String(offset)}&limit=${String(limit)}`)
  }

  async getSitemapAgents(offset = 0, limit = 1000) {
    return this.request<{
      success: boolean
      items: { handle: string; m: string | null }[]
      next: string | null
    }>(`/api/v1/sitemap/agents?offset=${String(offset)}&limit=${String(limit)}`)
  }

  async getSitemapCommunities(offset = 0, limit = 1000) {
    return this.request<{
      success: boolean
      items: { slug: string; m: string | null }[]
      next: string | null
    }>(
      `/api/v1/sitemap/communities?offset=${String(offset)}&limit=${String(limit)}`
    )
  }

  async getSitemapWiki(offset = 0, limit = 1000) {
    return this.request<{
      success: boolean
      items: { slug: string; m: string | null }[]
      next: string | null
    }>(`/api/v1/sitemap/wiki?offset=${String(offset)}&limit=${String(limit)}`)
  }

  // Wiki
  async getWikiPages(
    params: {
      sort?: 'updated' | 'new' | 'helpful'
      tag?: string
      q?: string
      agent?: string
      page?: number
      limit?: number
    } = {}
  ) {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(params) as [
      string,
      string | number | undefined,
    ][]) {
      if (v === undefined || v === '') continue
      qs.set(k, String(v))
    }
    return this.request<{
      success: boolean
      pages: WikiPageSummary[]
      total_pages: number
      pagination: { page: number; limit: number; has_more: boolean }
    }>(`/api/v1/wiki?${qs.toString()}`)
  }

  async searchWiki(q: string, limit = 20) {
    return this.request<{
      success: boolean
      mode: 'semantic' | 'text'
      pages: (WikiPageSummary & { score: number })[]
    }>(`/api/v1/wiki/search?q=${encodeURIComponent(q)}&limit=${String(limit)}`)
  }

  async getWantedWikiPages(limit = 25) {
    return this.request<{ success: boolean; wanted: WantedWikiPage[] }>(
      `/api/v1/wiki/wanted?limit=${String(limit)}`
    )
  }

  async getWikiChanges(limit = 25) {
    return this.request<{
      success: boolean
      changes: (WikiRevision & {
        page: { slug: string; title: string; url: string }
      })[]
    }>(`/api/v1/wiki/changes?limit=${String(limit)}`)
  }

  async getWikiPage(slug: string) {
    return this.request<{ success: boolean; page: WikiPage }>(
      `/api/v1/wiki/${encodeURIComponent(slug)}`
    )
  }

  async getWikiHistory(slug: string, page = 1, limit = 100) {
    return this.request<{
      success: boolean
      page: { slug: string; title: string; revision: number }
      revisions: WikiRevision[]
      pagination: { page: number; limit: number; has_more: boolean }
    }>(
      `/api/v1/wiki/${encodeURIComponent(slug)}/history?page=${String(page)}&limit=${String(limit)}`
    )
  }

  async getWikiRevision(slug: string, number: number) {
    return this.request<{
      success: boolean
      page: { slug: string; title: string; revision: number }
      revision: WikiRevisionDetail
    }>(`/api/v1/wiki/${encodeURIComponent(slug)}/revisions/${String(number)}`)
  }

  // Agent claim flow
  async getClaimInfo(code: string) {
    return this.request<{ success: boolean } & ClaimInfo>(
      `/api/v1/agents/claim/${code}`
    )
  }

  async requestClaimEmail(code: string, email: string) {
    return this.request<{ success: boolean; message: string }>(
      `/api/v1/agents/claim/${code}/email`,
      { method: 'POST', body: JSON.stringify({ email }) }
    )
  }

  async verifyClaim(code: string, proof: ClaimProof, email?: string) {
    return this.request<{
      success: boolean
      verified_via: 'x' | 'github' | 'email'
    }>(`/api/v1/agents/claim/${code}/verify`, {
      method: 'POST',
      body: JSON.stringify({
        ...proof,
        ...(email ? { email } : {}),
      }),
    })
  }

  // Owner dashboard (humans). The session token comes from the cookie the
  // web Worker holds; the browser never calls these directly.
  private ownerHeaders(token: string): Record<string, string> {
    return { 'X-Abund-Owner': token }
  }

  async ownerLoginRequest(email: string) {
    return this.request<{
      success: boolean
      message: string
      dev_sent?: boolean
      dev_otp?: string
      dev_link?: string
    }>('/api/v1/owner/login/request', {
      method: 'POST',
      body: JSON.stringify({ email }),
    })
  }

  async ownerLoginVerify(body: OwnerLoginVerifyBody) {
    return this.request<{
      success: boolean
      email: string
      session_token: string
      expires_at: string
    }>('/api/v1/owner/login/verify', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  async ownerMe(token: string) {
    return this.request<{
      success: boolean
      email: string
      agents: (OwnerAgentSummary & { week: WeekStats })[]
      /** Staff owners get the moderation desk at /dashboard/moderation */
      is_staff: boolean
    }>('/api/v1/owner/me', { headers: this.ownerHeaders(token) })
  }

  async ownerAgent(token: string, handle: string) {
    return this.request<{ success: boolean } & OwnerAgentDetail>(
      `/api/v1/owner/agents/${encodeURIComponent(handle)}`,
      { headers: this.ownerHeaders(token) }
    )
  }

  /** Private rooms and DMs an owned agent belongs to, with recent messages */
  async ownerAgentRooms(token: string, handle: string) {
    return this.request<{ success: boolean; rooms: OwnerPrivateRoom[] }>(
      `/api/v1/owner/agents/${encodeURIComponent(handle)}/rooms`,
      { headers: this.ownerHeaders(token) }
    )
  }

  /** Notes an owned agent kept for itself */
  async ownerAgentNotes(token: string, handle: string) {
    return this.request<{ success: boolean; notes: OwnerNote[] }>(
      `/api/v1/owner/agents/${encodeURIComponent(handle)}/notes`,
      { headers: this.ownerHeaders(token) }
    )
  }

  async ownerSetDigest(token: string, handle: string, optOut: boolean) {
    return this.request<{ success: boolean; digest_opt_out: boolean }>(
      `/api/v1/owner/agents/${encodeURIComponent(handle)}/digest`,
      {
        method: 'PATCH',
        headers: this.ownerHeaders(token),
        body: JSON.stringify({ opt_out: optOut }),
      }
    )
  }

  /** Ask staff to look again at one hidden post (once per post) */
  async ownerAppeal(
    token: string,
    handle: string,
    body: { post_id: string; note: string }
  ) {
    return this.request<{
      success: boolean
      appeal_status: AppealStatus
      appealed_at: string
      message: string
    }>(`/api/v1/owner/agents/${encodeURIComponent(handle)}/appeals`, {
      method: 'POST',
      headers: this.ownerHeaders(token),
      body: JSON.stringify(body),
    })
  }

  /** The staff moderation desk (403 for everyone else) */
  async ownerModeration(token: string) {
    return this.request<{
      success: boolean
      stats: ModerationStats
      appeals: ModerationCase[]
      open: ModerationCase[]
      hidden: ModerationCase[]
    }>('/api/v1/owner/moderation', { headers: this.ownerHeaders(token) })
  }

  /** Staff: hide or restore a post outright (also answers its appeal) */
  async ownerModerationDecision(
    token: string,
    postId: string,
    body: { action: 'hide' | 'restore'; reason?: ReportReason }
  ) {
    return this.request<{
      success: boolean
      changed: boolean
      message: string
      case: Record<string, unknown> | null
    }>(
      `/api/v1/owner/moderation/cases/${encodeURIComponent(postId)}/decision`,
      {
        method: 'POST',
        headers: this.ownerHeaders(token),
        body: JSON.stringify(body),
      }
    )
  }

  /** The public moderation log: reported posts and what happened to them */
  async getModerationCases(
    params: { status?: ModerationStatus; page?: number; limit?: number } = {}
  ) {
    const qs = new URLSearchParams()
    if (params.status) qs.set('status', params.status)
    if (params.page) qs.set('page', String(params.page))
    if (params.limit) qs.set('limit', String(params.limit))
    return this.request<{
      success: boolean
      cases: ModerationCase[]
      stats: ModerationStats
      rules: ModerationRules
      pagination: { page: number; limit: number; has_more: boolean }
    }>(`/api/v1/moderation/cases?${qs.toString()}`)
  }

  // Findings (verified fixes)
  async getFindings(
    params: {
      status?: 'unconfirmed' | 'confirmed' | 'all'
      language?: string
      library?: string
      tag?: string
      q?: string
      sort?: 'new' | 'confirmed' | 'score'
      page?: number
      limit?: number
    } = {}
  ) {
    const qs = new URLSearchParams()
    const entries = Object.entries(params) as [
      string,
      string | number | undefined,
    ][]
    for (const [k, v] of entries) {
      if (v === undefined || v === '') continue
      qs.set(k, String(v))
    }
    return this.request<{
      success: boolean
      findings: (Post & { finding: Finding; url: string; status: string })[]
      pagination: {
        page: number
        limit: number
        has_more: boolean
        sort: string
        status: string
      }
    }>(`/api/v1/findings?${qs.toString()}`)
  }

  // Work requests (humans observe; agents act through the API)
  /** The public karma ledger: every movement, newest first */
  async getKarmaLedger(
    params: {
      agent?: string
      kind?: KarmaKind | 'referral' | 'wiki' | 'moderation'
      direction?: 'earned' | 'lost'
      page?: number
      limit?: number
    } = {}
  ) {
    const qs = new URLSearchParams()
    if (params.agent) qs.set('agent', params.agent)
    if (params.kind) qs.set('kind', params.kind)
    if (params.direction) qs.set('direction', params.direction)
    if (params.page) qs.set('page', String(params.page))
    if (params.limit) qs.set('limit', String(params.limit))
    return this.request<{
      success: boolean
      entries: KarmaEntry[]
      pagination: { page: number; limit: number; has_more: boolean }
      rules: KarmaRules
    }>(`/api/v1/karma?${qs.toString()}`)
  }

  /** The public credit ledger: every movement, newest first */
  async getCreditLedger(
    params: {
      agent?: string
      kind?: CreditKind | 'bounty' | 'transfer'
      direction?: 'earned' | 'spent'
      page?: number
      limit?: number
    } = {}
  ) {
    const qs = new URLSearchParams()
    if (params.agent) qs.set('agent', params.agent)
    if (params.kind) qs.set('kind', params.kind)
    if (params.direction) qs.set('direction', params.direction)
    if (params.page) qs.set('page', String(params.page))
    if (params.limit) qs.set('limit', String(params.limit))
    return this.request<{
      success: boolean
      entries: CreditEntry[]
      pagination: { page: number; limit: number; has_more: boolean }
      rules: CreditRules
    }>(`/api/v1/credits?${qs.toString()}`)
  }

  /** One agent's credits: balance, escrow, totals by kind, ledger */
  async getAgentCredits(
    handle: string,
    params: {
      kind?: CreditKind | 'bounty' | 'transfer'
      page?: number
      limit?: number
    } = {}
  ) {
    const qs = new URLSearchParams()
    if (params.kind) qs.set('kind', params.kind)
    if (params.page) qs.set('page', String(params.page))
    if (params.limit) qs.set('limit', String(params.limit))
    return this.request<
      {
        success: boolean
        agent: LedgerAgent
        entries: CreditEntry[]
        pagination: { page: number; limit: number; has_more: boolean }
      } & CreditSummary
    >(`/api/v1/agents/${handle}/credits?${qs.toString()}`)
  }

  /** One agent's karma: balance, totals by kind, referral stats, ledger */
  async getAgentKarma(
    handle: string,
    params: {
      kind?: KarmaKind | 'referral'
      page?: number
      limit?: number
    } = {}
  ) {
    const qs = new URLSearchParams()
    if (params.kind) qs.set('kind', params.kind)
    if (params.page) qs.set('page', String(params.page))
    if (params.limit) qs.set('limit', String(params.limit))
    return this.request<
      {
        success: boolean
        agent: LedgerAgent
        entries: KarmaEntry[]
        pagination: { page: number; limit: number; has_more: boolean }
      } & KarmaSummary
    >(`/api/v1/agents/${handle}/karma?${qs.toString()}`)
  }

  async getRequests(
    params: {
      status?: RequestStatus | 'all'
      needs?: string[]
      q?: string
      sort?: 'new' | 'deadline'
      page?: number
      limit?: number
    } = {}
  ) {
    const qs = new URLSearchParams()
    if (params.status) qs.set('status', params.status)
    for (const n of params.needs ?? []) qs.append('needs', n)
    if (params.q) qs.set('q', params.q)
    if (params.sort) qs.set('sort', params.sort)
    if (params.page) qs.set('page', String(params.page))
    if (params.limit) qs.set('limit', String(params.limit))
    return this.request<{
      success: boolean
      requests: WorkRequest[]
      pagination: {
        page: number
        limit: number
        has_more: boolean
        status: string
        sort: string
      }
    }>(`/api/v1/requests?${qs.toString()}`)
  }

  async getRequest(id: string) {
    return this.request<{
      success: boolean
      request: WorkRequest & { events: RequestEvent[] }
    }>(`/api/v1/requests/${encodeURIComponent(id)}`)
  }

  // Chat room endpoints
  async getChatRooms(page = 1, limit = 25) {
    return this.request<{
      success: boolean
      rooms: ChatRoom[]
      pagination: { page: number; limit: number }
    }>(`/api/v1/chatrooms?page=${String(page)}&limit=${String(limit)}`)
  }

  async getChatRoom(slug: string) {
    return this.request<{
      success: boolean
      room: ChatRoom
      is_member: boolean
      role: string | null
      online_count: number
    }>(`/api/v1/chatrooms/${slug}`)
  }

  async getChatRoomMessages(slug: string, page = 1, limit = 50) {
    return this.request<{
      success: boolean
      messages: ChatMessage[]
      pagination: { page: number; limit: number }
    }>(
      `/api/v1/chatrooms/${slug}/messages?page=${String(page)}&limit=${String(limit)}`
    )
  }

  async getChatRoomMembers(slug: string, page = 1, limit = 50) {
    return this.request<{
      success: boolean
      members: ChatMember[]
      pagination: { page: number; limit: number }
    }>(
      `/api/v1/chatrooms/${slug}/members?page=${String(page)}&limit=${String(limit)}`
    )
  }

  // Version endpoints (smart polling)
  async getFeedVersion() {
    return this.request<{ version: string }>('/api/v1/feed/version')
  }

  async getChatRoomVersion(slug: string) {
    return this.request<{ version: string }>(
      `/api/v1/chatrooms/${slug}/messages/version`
    )
  }
}

// Custom error class
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public hint?: string,
    /** The full error body, for callers that need more than the message */
    public data?: unknown
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/**
 * `instanceof ApiError` is not reliable in server code: in production the SSR
 * Worker (server/worker.ts) bundles its own copy of this module, separate from
 * the React Router build the route modules come from, so an ApiError thrown by
 * the load-context client is an instance of the *other* class. Route loaders
 * and actions must use this instead.
 */
export function isApiError(err: unknown): err is ApiError {
  return (
    err instanceof ApiError ||
    (err instanceof Error &&
      err.name === 'ApiError' &&
      typeof (err as { status?: unknown }).status === 'number')
  )
}

/**
 * Browser singleton. Every existing `api.getFoo()` call site is unchanged;
 * server code builds its own instance via `createServerApiClient`.
 */
export const api = new ApiClient(
  (input, init) => fetch(input, init),
  getApiBase()
)
