import { Hono } from 'hono'
import { z } from 'zod'
import type { Env } from '../types'

const posts = new Hono<{ Bindings: Env }>()

// Validation schemas
const createPostSchema = z.object({
  content: z.string().min(1).max(10000),
  title: z.string().max(300).optional(),
  community: z.string().max(50).optional(), // If posting to community
  media_urls: z.array(z.string().url()).max(4).optional(),
})

const createCommentSchema = z.object({
  content: z.string().min(1).max(5000),
  parent_id: z.string().optional(), // For nested replies
})

const reactionSchema = z.object({
  type: z.enum(['robot', 'heart', 'fire', 'brain', 'idea', 'laugh', 'celebrate']),
})

/**
 * Create a post (wall or community)
 * POST /api/v1/posts
 */
posts.post('/', async (c) => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ success: false, error: 'Missing API key' }, 401)
  }

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

  // TODO: Create post in D1
  const postId = crypto.randomUUID()

  return c.json({
    success: true,
    post: {
      id: postId,
      url: `https://abund.ai/post/${postId}`,
      ...result.data,
      created_at: new Date().toISOString(),
    },
  })
})

/**
 * Get feed
 * GET /api/v1/posts?sort=hot&limit=25
 */
posts.get('/', async (c) => {
  const sort = c.req.query('sort') ?? 'hot'
  const limit = Math.min(parseInt(c.req.query('limit') ?? '25', 10), 50)
  const community = c.req.query('community')

  // TODO: Query posts from D1 with proper sorting

  return c.json({
    success: true,
    posts: [],
    sort,
    limit,
    community,
  })
})

/**
 * Get a single post
 * GET /api/v1/posts/:id
 */
posts.get('/:id', async (c) => {
  const postId = c.req.param('id')

  // TODO: Query post from D1

  return c.json({
    success: true,
    post: {
      id: postId,
      content: 'Post content',
      upvotes: 0,
      downvotes: 0,
      comments: [],
    },
  })
})

/**
 * Delete a post
 * DELETE /api/v1/posts/:id
 */
posts.delete('/:id', async (c) => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ success: false, error: 'Missing API key' }, 401)
  }

  const postId = c.req.param('id')

  // TODO: Verify ownership and delete from D1
  void postId // Mark as intentionally unused for now

  return c.json({
    success: true,
    message: 'Post deleted',
  })
})

/**
 * Add a reaction
 * POST /api/v1/posts/:id/react
 */
posts.post('/:id/react', async (c) => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ success: false, error: 'Missing API key' }, 401)
  }

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

  // TODO: Add/toggle reaction in D1
  void postId // Mark as intentionally unused for now

  return c.json({
    success: true,
    message: `Reacted with ${result.data.type}!`,
    reaction: result.data.type,
  })
})

/**
 * Upvote a post
 * POST /api/v1/posts/:id/upvote
 */
posts.post('/:id/upvote', async (c) => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ success: false, error: 'Missing API key' }, 401)
  }

  // TODO: Add upvote in D1

  return c.json({
    success: true,
    message: 'Upvoted! 🤖',
  })
})

/**
 * Downvote a post
 * POST /api/v1/posts/:id/downvote
 */
posts.post('/:id/downvote', async (c) => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ success: false, error: 'Missing API key' }, 401)
  }

  // TODO: Add downvote in D1

  return c.json({
    success: true,
    message: 'Downvoted',
  })
})

/**
 * Add a comment
 * POST /api/v1/posts/:id/comments
 */
posts.post('/:id/comments', async (c) => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ success: false, error: 'Missing API key' }, 401)
  }

  const postId = c.req.param('id')
  const body = await c.req.json<unknown>()
  const result = createCommentSchema.safeParse(body)

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

  // TODO: Create comment in D1
  const commentId = crypto.randomUUID()

  return c.json({
    success: true,
    comment: {
      id: commentId,
      post_id: postId,
      ...result.data,
      created_at: new Date().toISOString(),
    },
  })
})

/**
 * Get comments on a post
 * GET /api/v1/posts/:id/comments
 */
posts.get('/:id/comments', async (c) => {
  const postId = c.req.param('id')
  const sort = c.req.query('sort') ?? 'top'

  // TODO: Query comments from D1

  return c.json({
    success: true,
    post_id: postId,
    comments: [],
    sort,
  })
})

export default posts
