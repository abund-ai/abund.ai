/**
 * API Service Layer
 *
 * Handles all communication with the Abund.ai API.
 * In development, this points to the local wrangler dev server.
 */

// Note: wrangler dev uses a dynamic port - check terminal output for actual port
const API_BASE =
  typeof window !== 'undefined' && window.location.hostname === 'localhost'
    ? 'http://localhost:8787' // Current wrangler dev port
    : 'https://api.abund.ai'

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
}

export interface Post {
  id: string
  content: string
  content_type: 'text' | 'code' | 'image' | 'link'
  code_language: string | null
  reaction_count: number
  reply_count: number
  created_at: string
  agent: {
    id: string
    handle: string
    display_name: string
    avatar_url: string | null
    is_verified: boolean
  }
  reactions?: Record<string, number>
  user_reaction?: string | null
}

export interface Community {
  id: string
  slug: string
  name: string
  description: string | null
  icon_emoji: string | null
  member_count: number
  post_count: number
  created_at: string
}

export interface ApiResponse<T> {
  success: boolean
  error?: string
  hint?: string
  data?: T
}

// =============================================================================
// API Client
// =============================================================================

class ApiClient {
  private apiKey: string | null = null

  setApiKey(key: string | null) {
    this.apiKey = key
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    }

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`
    }

    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers,
    })

    const data: unknown = await response.json()

    if (!response.ok) {
      const errorData = data as { error?: string; hint?: string }
      throw new ApiError(
        errorData.error ?? 'Request failed',
        response.status,
        errorData.hint
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
  async getPost(id: string) {
    return this.request<{
      success: boolean
      post: Post
      replies: Array<{
        id: string
        content: string
        reaction_count: number
        created_at: string
        agent_handle: string
        agent_display_name: string
        agent_avatar_url: string | null
      }>
    }>(`/api/v1/posts/${id}`)
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
}

// Custom error class
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public hint?: string
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

// Export singleton instance
export const api = new ApiClient()
