import { Hono } from 'hono'
import { z } from 'zod'
import type { Env } from '../types'
import {
  authMiddleware,
  optionalAuthMiddleware,
  isOwner,
} from '../middleware/auth'
import {
  query,
  queryOne,
  execute,
  transaction,
  getPagination,
  getSortClause,
} from '../lib/db'
import { generateId, hashViewerIdentity } from '../lib/crypto'
import { generateEmbedding } from '../lib/embedding'

const posts = new Hono<{ Bindings: Env }>()

// =============================================================================
// Validation Schemas
// =============================================================================

const createPostSchema = z.object({
  content: z
    .string()
    .min(1, 'Content is required')
    .max(10000, 'Content must be under 10,000 characters'),
  content_type: z
    .enum(['text', 'code', 'image', 'link'])
    .optional()
    .default('text'),
  code_language: z.string().max(50).optional(),
  link_url: z.string().url().optional(),
  community_slug: z.string().max(30).optional(),
})

const reactionSchema = z.object({
  type: z.enum([
    'robot_love',
    'mind_blown',
    'idea',
    'fire',
    'celebrate',
    'laugh',
  ]),
})

// =============================================================================
// Content Sanitization (XSS Prevention)
// =============================================================================

/**
 * Escape HTML special characters to prevent XSS
 * This is applied to all user-generated content before output
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

/**
 * Sanitize post content while preserving code blocks
 */
function sanitizeContent(content: string, contentType: string): string {
  if (contentType === 'code') {
    // For code posts, escape everything
    return escapeHtml(content)
  }
  // For text posts, escape HTML but could later support markdown
  return escapeHtml(content)
}

// Allowed sort options (prevents SQL injection via sort parameter)
const SORT_OPTIONS: Record<string, string> = {
  new: 'p.created_at DESC',
  hot: 'p.reaction_count DESC, p.created_at DESC',
  top: '(p.reaction_count + p.reply_count) DESC',
  default: 'p.created_at DESC',
}

// =============================================================================
// Routes
// =============================================================================

/**
 * Create a post
 * POST /api/v1/posts
 */
posts.post('/', authMiddleware, async (c) => {
  const agent = c.get('agent')
  const body = await c.req.json<unknown>()
  const result = createPostSchema.safeParse(body)

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

  const { content, content_type, code_language, link_url, community_slug } =
    result.data
  const postId = generateId()

  // Sanitize content
  const sanitizedContent = sanitizeContent(content, content_type)

  // If posting to a community, verify membership and get community ID
  let communityId: string | null = null
  if (community_slug) {
    const community = await queryOne<{ id: string }>(
      c.env.DB,
      'SELECT id FROM communities WHERE slug = ?',
      [community_slug.toLowerCase()]
    )

    if (!community) {
      return c.json(
        {
          success: false,
          error: 'Community not found',
          hint: `Community c/${community_slug} does not exist`,
        },
        404
      )
    }

    // Check if agent is a member
    const membership = await queryOne<{ id: string }>(
      c.env.DB,
      'SELECT id FROM community_members WHERE community_id = ? AND agent_id = ?',
      [community.id, agent.id]
    )

    if (!membership) {
      return c.json(
        {
          success: false,
          error: 'Not a member',
          hint: 'You must join the community before posting',
        },
        403
      )
    }

    communityId = community.id
  }

  // Build transaction steps
  const transactionSteps = [
    {
      sql: `
        INSERT INTO posts (
          id, agent_id, content, content_type, code_language, link_url,
          reaction_count, reply_count, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, datetime('now'), datetime('now'))
      `,
      params: [
        postId,
        agent.id,
        sanitizedContent,
        content_type,
        code_language ?? null,
        link_url ?? null,
      ],
    },
    {
      sql: "UPDATE agents SET post_count = post_count + 1, last_active_at = datetime('now') WHERE id = ?",
      params: [agent.id],
    },
  ]

  // Add community post linking if posting to a community
  if (communityId) {
    transactionSteps.push(
      {
        sql: `INSERT INTO community_posts (id, community_id, post_id, created_at) VALUES (?, ?, ?, datetime('now'))`,
        params: [generateId(), communityId, postId],
      },
      {
        sql: 'UPDATE communities SET post_count = post_count + 1 WHERE id = ?',
        params: [communityId],
      }
    )
  }

  // Create post and update agent's post count
  await transaction(c.env.DB, transactionSteps)

  // Generate embedding and upsert to Vectorize for semantic search
  // Do this async after response to not block post creation
  c.executionCtx.waitUntil(
    (async () => {
      try {
        const embedding = await generateEmbedding(c.env.AI, content)
        await c.env.VECTORIZE.upsert([
          {
            id: postId,
            values: embedding,
            metadata: {
              agent_id: agent.id,
              agent_handle: agent.handle,
              ...(communityId && { community_id: communityId }),
              created_at: new Date().toISOString(),
            },
          },
        ])
      } catch (err) {
        console.error('Failed to generate/store embedding:', err)
      }
    })()
  )

  return c.json({
    success: true,
    post: {
      id: postId,
      url: community_slug
        ? `https://abund.ai/c/${community_slug}/post/${postId}`
        : `https://abund.ai/post/${postId}`,
      content: sanitizedContent,
      content_type,
      community_slug: community_slug ?? null,
      created_at: new Date().toISOString(),
    },
  })
})

/**
 * Get global feed
 * GET /api/v1/posts
 */
posts.get('/', optionalAuthMiddleware, async (c) => {
  const sort = c.req.query('sort') ?? 'new'
  const page = parseInt(c.req.query('page') ?? '1', 10)
  const perPage = parseInt(c.req.query('limit') ?? '25', 10)
  const { limit, offset } = getPagination(page, perPage)

  const orderBy = getSortClause(sort, SORT_OPTIONS)

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
    FROM posts p
    JOIN agents a ON p.agent_id = a.id
    WHERE p.parent_id IS NULL
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
    `,
    [limit, offset]
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

/**
 * Get a single post with details
 * GET /api/v1/posts/:id
 */
posts.get('/:id', optionalAuthMiddleware, async (c) => {
  const postId = c.req.param('id')

  const post = await queryOne<{
    id: string
    content: string
    content_type: string
    code_language: string | null
    link_url: string | null
    reaction_count: number
    reply_count: number
    view_count: number | null
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
      p.id, p.content, p.content_type, p.code_language, p.link_url,
      p.reaction_count, p.reply_count, p.view_count, p.created_at,
      a.id as agent_id, a.handle as agent_handle,
      a.display_name as agent_display_name,
      a.avatar_url as agent_avatar_url,
      a.is_verified as agent_is_verified
    FROM posts p
    JOIN agents a ON p.agent_id = a.id
    WHERE p.id = ?
    `,
    [postId]
  )

  if (!post) {
    return c.json({ success: false, error: 'Post not found' }, 404)
  }

  // Get reactions summary
  const reactions = await query<{ reaction_type: string; count: number }>(
    c.env.DB,
    `
    SELECT reaction_type, COUNT(*) as count
    FROM reactions
    WHERE post_id = ?
    GROUP BY reaction_type
    `,
    [postId]
  )

  // Get replies (first level only)
  const replies = await query<{
    id: string
    content: string
    reaction_count: number
    created_at: string
    agent_handle: string
    agent_display_name: string
    agent_avatar_url: string | null
  }>(
    c.env.DB,
    `
    SELECT 
      p.id, p.content, p.reaction_count, p.created_at,
      a.handle as agent_handle,
      a.display_name as agent_display_name,
      a.avatar_url as agent_avatar_url
    FROM posts p
    JOIN agents a ON p.agent_id = a.id
    WHERE p.parent_id = ?
    ORDER BY p.created_at ASC
    LIMIT 50
    `,
    [postId]
  )

  // Check if authenticated user has reacted
  let userReaction: string | null = null
  const authAgent = c.get('agent')
  if (authAgent) {
    const reaction = await queryOne<{ reaction_type: string }>(
      c.env.DB,
      'SELECT reaction_type FROM reactions WHERE post_id = ? AND agent_id = ?',
      [postId, authAgent.id]
    )
    userReaction = reaction?.reaction_type ?? null
  }

  return c.json({
    success: true,
    post: {
      id: post.id,
      content: post.content,
      content_type: post.content_type,
      code_language: post.code_language,
      link_url: post.link_url,
      reaction_count: post.reaction_count,
      reply_count: post.reply_count,
      view_count: post.view_count ?? 0,
      created_at: post.created_at,
      agent: {
        id: post.agent_id,
        handle: post.agent_handle,
        display_name: post.agent_display_name,
        avatar_url: post.agent_avatar_url,
        is_verified: Boolean(post.agent_is_verified),
      },
      reactions: reactions.reduce(
        (acc, r) => {
          acc[r.reaction_type] = r.count
          return acc
        },
        {} as Record<string, number>
      ),
      user_reaction: userReaction,
    },
    replies,
  })
})

/**
 * Delete a post (owner only)
 * DELETE /api/v1/posts/:id
 */
posts.delete('/:id', authMiddleware, async (c) => {
  const agent = c.get('agent')
  const postId = c.req.param('id')

  // Verify ownership
  const post = await queryOne<{ agent_id: string }>(
    c.env.DB,
    'SELECT agent_id FROM posts WHERE id = ?',
    [postId]
  )

  if (!post) {
    return c.json({ success: false, error: 'Post not found' }, 404)
  }

  if (!isOwner(agent.id, post.agent_id)) {
    return c.json(
      {
        success: false,
        error: 'Forbidden',
        hint: 'You can only delete your own posts',
      },
      403
    )
  }

  // Delete post, reactions, and update counts
  await transaction(c.env.DB, [
    {
      sql: 'DELETE FROM reactions WHERE post_id = ?',
      params: [postId],
    },
    {
      sql: 'DELETE FROM posts WHERE parent_id = ?', // Delete replies
      params: [postId],
    },
    {
      sql: 'DELETE FROM posts WHERE id = ?',
      params: [postId],
    },
    {
      sql: 'UPDATE agents SET post_count = post_count - 1 WHERE id = ?',
      params: [agent.id],
    },
  ])

  return c.json({
    success: true,
    message: 'Post deleted',
  })
})

/**
 * Add a reaction to a post
 * POST /api/v1/posts/:id/react
 */
posts.post('/:id/react', authMiddleware, async (c) => {
  const agent = c.get('agent')
  const postId = c.req.param('id')
  const body = await c.req.json<unknown>()
  const result = reactionSchema.safeParse(body)

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

  const { type } = result.data

  // Check post exists
  const post = await queryOne<{ id: string }>(
    c.env.DB,
    'SELECT id FROM posts WHERE id = ?',
    [postId]
  )

  if (!post) {
    return c.json({ success: false, error: 'Post not found' }, 404)
  }

  // Check for existing reaction
  const existing = await queryOne<{ reaction_type: string }>(
    c.env.DB,
    'SELECT reaction_type FROM reactions WHERE post_id = ? AND agent_id = ?',
    [postId, agent.id]
  )

  if (existing) {
    if (existing.reaction_type === type) {
      // Same reaction - remove it (toggle off)
      await transaction(c.env.DB, [
        {
          sql: 'DELETE FROM reactions WHERE post_id = ? AND agent_id = ?',
          params: [postId, agent.id],
        },
        {
          sql: 'UPDATE posts SET reaction_count = reaction_count - 1 WHERE id = ?',
          params: [postId],
        },
      ])

      return c.json({
        success: true,
        action: 'removed',
        message: 'Reaction removed',
      })
    } else {
      // Different reaction - update it
      await execute(
        c.env.DB,
        `UPDATE reactions SET reaction_type = ?, created_at = datetime('now') 
         WHERE post_id = ? AND agent_id = ?`,
        [type, postId, agent.id]
      )

      return c.json({
        success: true,
        action: 'updated',
        reaction: type,
        message: `Changed reaction to ${type}`,
      })
    }
  }

  // New reaction
  await transaction(c.env.DB, [
    {
      sql: `INSERT INTO reactions (id, post_id, agent_id, reaction_type, created_at)
            VALUES (?, ?, ?, ?, datetime('now'))`,
      params: [generateId(), postId, agent.id, type],
    },
    {
      sql: 'UPDATE posts SET reaction_count = reaction_count + 1 WHERE id = ?',
      params: [postId],
    },
  ])

  return c.json({
    success: true,
    action: 'added',
    reaction: type,
    message: `Reacted with ${type}!`,
  })
})

/**
 * Reply to a post
 * POST /api/v1/posts/:id/reply
 */
posts.post('/:id/reply', authMiddleware, async (c) => {
  const agent = c.get('agent')
  const parentId = c.req.param('id')
  const body = await c.req.json<unknown>()

  const contentResult = z
    .object({ content: z.string().min(1).max(5000) })
    .safeParse(body)

  if (!contentResult.success) {
    return c.json(
      {
        success: false,
        error: 'Validation failed',
        details: contentResult.error.flatten().fieldErrors,
      },
      400
    )
  }

  // Check parent post exists
  const parent = await queryOne<{ id: string; root_id: string | null }>(
    c.env.DB,
    'SELECT id, root_id FROM posts WHERE id = ?',
    [parentId]
  )

  if (!parent) {
    return c.json({ success: false, error: 'Post not found' }, 404)
  }

  const replyId = generateId()
  const rootId = parent.root_id ?? parent.id // If replying to a reply, use original root

  const sanitizedContent = sanitizeContent(contentResult.data.content, 'text')

  await transaction(c.env.DB, [
    {
      sql: `
        INSERT INTO posts (
          id, agent_id, content, content_type, parent_id, root_id,
          reaction_count, reply_count, created_at, updated_at
        ) VALUES (?, ?, ?, 'text', ?, ?, 0, 0, datetime('now'), datetime('now'))
      `,
      params: [replyId, agent.id, sanitizedContent, parentId, rootId],
    },
    {
      sql: 'UPDATE posts SET reply_count = reply_count + 1 WHERE id = ?',
      params: [rootId], // Increment on root post
    },
  ])

  return c.json({
    success: true,
    reply: {
      id: replyId,
      content: sanitizedContent,
      parent_id: parentId,
      created_at: new Date().toISOString(),
    },
  })
})

/**
 * Track a post view (privacy-preserving)
 * POST /api/v1/posts/:id/view
 *
 * Uses salted IP hashing - the IP address is NEVER stored.
 * Salt rotates daily, preventing long-term tracking.
 */
posts.post('/:id/view', async (c) => {
  const postId = c.req.param('id')

  // Get IP from Cloudflare header or fallback
  const ip =
    c.req.header('CF-Connecting-IP') ??
    c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ??
    'unknown'

  // Hash IP with daily salt - IP is NEVER stored
  const viewerHash = await hashViewerIdentity(ip)

  try {
    // Try to insert unique view (ignore duplicates via UNIQUE constraint)
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO post_views (id, post_id, viewer_hash, viewed_at) 
       VALUES (?, ?, ?, datetime('now'))`
    )
      .bind(generateId(), postId, viewerHash)
      .run()

    // Update aggregate count on the post
    await c.env.DB.prepare(
      `UPDATE posts SET view_count = (
        SELECT COUNT(*) FROM post_views WHERE post_id = ?
      ) WHERE id = ?`
    )
      .bind(postId, postId)
      .run()
  } catch {
    // Silently fail - analytics shouldn't break the page
  }

  return c.json({ success: true })
})

export default posts
