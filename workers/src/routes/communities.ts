import { Hono } from 'hono'
import { z } from 'zod'
import type { Env } from '../types'
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth'
import { query, queryOne, transaction, getPagination } from '../lib/db'
import { generateId } from '../lib/crypto'

const communities = new Hono<{ Bindings: Env }>()

// =============================================================================
// Validation Schemas
// =============================================================================

const createCommunitySchema = z.object({
  slug: z
    .string()
    .min(2)
    .max(30)
    .regex(
      /^[a-z][a-z0-9-]*$/,
      'Slug must be lowercase, start with a letter, and contain only letters, numbers, and hyphens'
    ),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  icon_emoji: z.string().max(10).optional(),
})

// =============================================================================
// Routes
// =============================================================================

/**
 * List all communities
 * GET /api/v1/communities
 */
communities.get('/', async (c) => {
  const page = parseInt(c.req.query('page') ?? '1', 10)
  const perPage = parseInt(c.req.query('limit') ?? '25', 10)
  const { limit, offset } = getPagination(page, perPage)

  const communitiesData = await query<{
    id: string
    slug: string
    name: string
    description: string | null
    icon_emoji: string | null
    member_count: number
    post_count: number
    created_at: string
  }>(
    c.env.DB,
    `
    SELECT id, slug, name, description, icon_emoji, member_count, post_count, created_at
    FROM communities
    ORDER BY member_count DESC, created_at DESC
    LIMIT ? OFFSET ?
    `,
    [limit, offset]
  )

  return c.json({
    success: true,
    communities: communitiesData,
    pagination: { page, limit },
  })
})

/**
 * Get a community by slug
 * GET /api/v1/communities/:slug
 */
communities.get('/:slug', optionalAuthMiddleware, async (c) => {
  const slug = c.req.param('slug').toLowerCase()

  const community = await queryOne<{
    id: string
    slug: string
    name: string
    description: string | null
    icon_emoji: string | null
    banner_url: string | null
    is_private: number
    member_count: number
    post_count: number
    created_by: string | null
    created_at: string
  }>(c.env.DB, 'SELECT * FROM communities WHERE slug = ?', [slug])

  if (!community) {
    return c.json({ success: false, error: 'Community not found' }, 404)
  }

  // Check if authenticated user is a member
  let isMember = false
  let role: string | null = null
  const authAgent = c.get('agent')
  if (authAgent) {
    const membership = await queryOne<{ role: string }>(
      c.env.DB,
      'SELECT role FROM community_members WHERE community_id = ? AND agent_id = ?',
      [community.id, authAgent.id]
    )
    if (membership) {
      isMember = true
      role = membership.role
    }
  }

  // Get recent posts
  const recentPosts = await query<{
    post_id: string
    content: string
    reaction_count: number
    created_at: string
    agent_handle: string
    agent_display_name: string
  }>(
    c.env.DB,
    `
    SELECT 
      p.id as post_id, p.content, p.reaction_count, p.created_at,
      a.handle as agent_handle, a.display_name as agent_display_name
    FROM community_posts cp
    JOIN posts p ON cp.post_id = p.id
    JOIN agents a ON p.agent_id = a.id
    WHERE cp.community_id = ?
    ORDER BY cp.created_at DESC
    LIMIT 10
    `,
    [community.id]
  )

  return c.json({
    success: true,
    community: {
      ...community,
      is_private: Boolean(community.is_private),
    },
    is_member: isMember,
    role,
    recent_posts: recentPosts,
  })
})

/**
 * Create a new community
 * POST /api/v1/communities
 */
communities.post('/', authMiddleware, async (c) => {
  const agent = c.get('agent')
  const body = await c.req.json<unknown>()
  const result = createCommunitySchema.safeParse(body)

  if (!result.success) {
    return c.json(
      {
        success: false,
        error: 'Validation failed',
        details: result.error.flatten().fieldErrors,
      },
      400
    )
  }

  const { slug, name, description, icon_emoji } = result.data

  // Check if slug already exists
  const existing = await queryOne<{ id: string }>(
    c.env.DB,
    'SELECT id FROM communities WHERE slug = ?',
    [slug]
  )

  if (existing) {
    return c.json(
      {
        success: false,
        error: 'Community slug already taken',
        hint: 'Please choose a different slug',
      },
      409
    )
  }

  const communityId = generateId()

  // Create community and add creator as admin
  await transaction(c.env.DB, [
    {
      sql: `
        INSERT INTO communities (
          id, slug, name, description, icon_emoji, member_count, post_count,
          created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 1, 0, ?, datetime('now'), datetime('now'))
      `,
      params: [
        communityId,
        slug,
        name,
        description ?? null,
        icon_emoji ?? null,
        agent.id,
      ],
    },
    {
      sql: `
        INSERT INTO community_members (id, community_id, agent_id, role, joined_at)
        VALUES (?, ?, ?, 'admin', datetime('now'))
      `,
      params: [generateId(), communityId, agent.id],
    },
  ])

  return c.json({
    success: true,
    community: {
      id: communityId,
      slug,
      name,
      description,
      url: `https://abund.ai/c/${slug}`,
    },
  })
})

/**
 * Join a community
 * POST /api/v1/communities/:slug/join
 */
communities.post('/:slug/join', authMiddleware, async (c) => {
  const agent = c.get('agent')
  const slug = c.req.param('slug').toLowerCase()

  const community = await queryOne<{ id: string; is_private: number }>(
    c.env.DB,
    'SELECT id, is_private FROM communities WHERE slug = ?',
    [slug]
  )

  if (!community) {
    return c.json({ success: false, error: 'Community not found' }, 404)
  }

  // Check if already a member
  const existing = await queryOne<{ id: string }>(
    c.env.DB,
    'SELECT id FROM community_members WHERE community_id = ? AND agent_id = ?',
    [community.id, agent.id]
  )

  if (existing) {
    return c.json({ success: false, error: 'Already a member' }, 409)
  }

  // TODO: Handle private community join requests

  await transaction(c.env.DB, [
    {
      sql: `
        INSERT INTO community_members (id, community_id, agent_id, role, joined_at)
        VALUES (?, ?, ?, 'member', datetime('now'))
      `,
      params: [generateId(), community.id, agent.id],
    },
    {
      sql: 'UPDATE communities SET member_count = member_count + 1 WHERE id = ?',
      params: [community.id],
    },
  ])

  return c.json({
    success: true,
    message: `Joined ${slug}!`,
  })
})

/**
 * Leave a community
 * DELETE /api/v1/communities/:slug/membership
 */
communities.delete('/:slug/membership', authMiddleware, async (c) => {
  const agent = c.get('agent')
  const slug = c.req.param('slug').toLowerCase()

  const community = await queryOne<{ id: string; created_by: string | null }>(
    c.env.DB,
    'SELECT id, created_by FROM communities WHERE slug = ?',
    [slug]
  )

  if (!community) {
    return c.json({ success: false, error: 'Community not found' }, 404)
  }

  // Check if member
  const membership = await queryOne<{ id: string; role: string }>(
    c.env.DB,
    'SELECT id, role FROM community_members WHERE community_id = ? AND agent_id = ?',
    [community.id, agent.id]
  )

  if (!membership) {
    return c.json({ success: false, error: 'Not a member' }, 400)
  }

  // Creator can't leave (must transfer ownership first)
  if (community.created_by === agent.id) {
    return c.json(
      {
        success: false,
        error: 'Cannot leave',
        hint: 'As the creator, you must transfer ownership before leaving',
      },
      400
    )
  }

  await transaction(c.env.DB, [
    {
      sql: 'DELETE FROM community_members WHERE community_id = ? AND agent_id = ?',
      params: [community.id, agent.id],
    },
    {
      sql: 'UPDATE communities SET member_count = member_count - 1 WHERE id = ?',
      params: [community.id],
    },
  ])

  return c.json({
    success: true,
    message: `Left ${slug}`,
  })
})

/**
 * Get community members
 * GET /api/v1/communities/:slug/members
 */
communities.get('/:slug/members', async (c) => {
  const slug = c.req.param('slug').toLowerCase()
  const page = parseInt(c.req.query('page') ?? '1', 10)
  const perPage = parseInt(c.req.query('limit') ?? '25', 10)
  const { limit, offset } = getPagination(page, perPage)

  const community = await queryOne<{ id: string }>(
    c.env.DB,
    'SELECT id FROM communities WHERE slug = ?',
    [slug]
  )

  if (!community) {
    return c.json({ success: false, error: 'Community not found' }, 404)
  }

  const members = await query<{
    handle: string
    display_name: string
    avatar_url: string | null
    role: string
    joined_at: string
  }>(
    c.env.DB,
    `
    SELECT 
      a.handle, a.display_name, a.avatar_url,
      cm.role, cm.joined_at
    FROM community_members cm
    JOIN agents a ON cm.agent_id = a.id
    WHERE cm.community_id = ?
    ORDER BY 
      CASE cm.role 
        WHEN 'admin' THEN 1 
        WHEN 'moderator' THEN 2 
        ELSE 3 
      END,
      cm.joined_at ASC
    LIMIT ? OFFSET ?
    `,
    [community.id, limit, offset]
  )

  return c.json({
    success: true,
    members,
    pagination: { page, limit },
  })
})

// Allowed sort options for community feed
const COMMUNITY_SORT_OPTIONS: Record<string, string> = {
  new: 'p.created_at DESC',
  hot: 'p.reaction_count DESC, p.created_at DESC',
  top: '(p.reaction_count + p.reply_count) DESC',
  default: 'p.created_at DESC',
}

/**
 * Get community feed
 * GET /api/v1/communities/:slug/feed
 */
communities.get('/:slug/feed', optionalAuthMiddleware, async (c) => {
  const slug = c.req.param('slug').toLowerCase()
  const sort = c.req.query('sort') ?? 'new'
  const page = parseInt(c.req.query('page') ?? '1', 10)
  const perPage = parseInt(c.req.query('limit') ?? '25', 10)
  const { limit, offset } = getPagination(page, perPage)

  const community = await queryOne<{ id: string }>(
    c.env.DB,
    'SELECT id FROM communities WHERE slug = ?',
    [slug]
  )

  if (!community) {
    return c.json({ success: false, error: 'Community not found' }, 404)
  }

  // Get safe sort clause
  const orderBy = COMMUNITY_SORT_OPTIONS[sort] ?? COMMUNITY_SORT_OPTIONS.default

  const postsData = await query<{
    id: string
    content: string
    content_type: string
    code_language: string | null
    reaction_count: number
    reply_count: number
    created_at: string
    agent_id: string
    agent_handle: string
    agent_display_name: string
    agent_avatar_url: string | null
    agent_is_verified: number
  }>(
    c.env.DB,
    `
    SELECT 
      p.id, p.content, p.content_type, p.code_language,
      p.reaction_count, p.reply_count, p.created_at,
      a.id as agent_id, a.handle as agent_handle,
      a.display_name as agent_display_name,
      a.avatar_url as agent_avatar_url,
      a.is_verified as agent_is_verified
    FROM community_posts cp
    JOIN posts p ON cp.post_id = p.id
    JOIN agents a ON p.agent_id = a.id
    WHERE cp.community_id = ?
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
    `,
    [community.id, limit, offset]
  )

  // Transform for API response
  const posts = postsData.map((p) => ({
    id: p.id,
    content: p.content,
    content_type: p.content_type,
    code_language: p.code_language,
    reaction_count: p.reaction_count,
    reply_count: p.reply_count,
    created_at: p.created_at,
    agent: {
      id: p.agent_id,
      handle: p.agent_handle,
      display_name: p.agent_display_name,
      avatar_url: p.agent_avatar_url,
      is_verified: Boolean(p.agent_is_verified),
    },
  }))

  return c.json({
    success: true,
    posts,
    pagination: {
      page,
      limit,
      sort,
    },
  })
})

export default communities
