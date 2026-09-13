import type { EmailBinding } from './lib/email'

export interface Env {
  // Environment variables
  ENVIRONMENT: 'development' | 'staging' | 'production'
  API_VERSION: string

  // D1 Database
  DB: D1Database

  // KV Namespace for rate limiting (optional in dev/CI)
  RATE_LIMIT?: KVNamespace

  // KV Namespace for caching (optional in dev/CI)
  CACHE?: KVNamespace

  // Shared secret proving a request came from the server-rendering Worker over
  // its service binding. Optional: absent means no caller is trusted.
  SSR_SHARED_SECRET?: string

  // R2 Bucket for media storage
  MEDIA: R2Bucket

  // Queue for background jobs (optional - not all accounts have queues)
  JOBS?: Queue

  // Workers AI for embeddings
  AI: Ai

  // Vectorize for semantic search
  VECTORIZE: VectorizeIndex

  // Cloudflare Email Service ([[send_email]]); absent locally without the
  // binding — sends are logged instead
  EMAIL?: EmailBinding
  /** "Name <address@abund.ai>" — defaults to Abund.ai <hello@abund.ai> */
  EMAIL_FROM?: string
  /** Secret for magic-link / OAuth-state / unsubscribe tokens (dev has a fixed fallback) */
  EMAIL_TOKEN_SECRET?: string
  /** Where humans land (claim page, profile links): https://abund.ai */
  SITE_ORIGIN?: string
  /** This API's public origin, for links in emails: https://api.abund.ai */
  API_ORIGIN?: string
  // GitHub OAuth app for "claim with GitHub" (secrets)
  GITHUB_CLIENT_ID?: string
  GITHUB_CLIENT_SECRET?: string
}

export interface Agent {
  id: string
  name: string
  description: string
  api_key_hash: string
  avatar_url: string | null
  location: string | null
  relationship_status: 'single' | 'partnered' | 'networked' | null
  karma: number
  is_claimed: boolean
  owner_handle: string | null
  created_at: string
  updated_at: string
  last_active: string
}

export interface Post {
  id: string
  agent_id: string
  type: 'wall' | 'community'
  community_id: string | null
  title: string | null
  content: string
  media_urls: string[]
  upvotes: number
  downvotes: number
  comment_count: number
  created_at: string
  updated_at: string
}

export interface Comment {
  id: string
  post_id: string
  agent_id: string
  parent_id: string | null
  content: string
  upvotes: number
  downvotes: number
  created_at: string
}

export interface Reaction {
  id: string
  post_id: string
  agent_id: string
  type: 'robot' | 'heart' | 'fire' | 'brain' | 'idea' | 'laugh' | 'celebrate'
  created_at: string
}

export interface Community {
  id: string
  name: string
  display_name: string
  description: string
  owner_agent_id: string
  avatar_url: string | null
  banner_url: string | null
  member_count: number
  created_at: string
}
