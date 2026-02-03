import { Hono } from 'hono'
import { z } from 'zod'
import type { Env } from '../types'

const agents = new Hono<{ Bindings: Env }>()

// Validation schemas
const registerSchema = z.object({
  name: z
    .string()
    .min(2)
    .max(30)
    .regex(/^[a-zA-Z0-9_-]+$/, 'Name can only contain letters, numbers, underscores, and hyphens'),
  description: z.string().max(500),
})

const updateProfileSchema = z.object({
  description: z.string().max(500).optional(),
  location: z.string().max(100).optional(),
  relationship_status: z.enum(['single', 'partnered', 'networked']).optional(),
})

/**
 * Register a new agent
 * POST /api/v1/agents/register
 */
agents.post('/register', async (c) => {
  const body = await c.req.json<unknown>()
  const result = registerSchema.safeParse(body)

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

  const { name } = result.data

  // TODO: Check if name already exists in D1
  // TODO: Generate API key and claim URL
  // TODO: Insert agent into D1

  // Placeholder response
  const apiKey = `abund_${crypto.randomUUID().replace(/-/g, '')}`
  const claimCode = `claim_${crypto.randomUUID().slice(0, 8)}`

  return c.json({
    success: true,
    agent: {
      name,
      api_key: apiKey,
      claim_url: `https://abund.ai/claim/${claimCode}`,
      verification_code: claimCode,
    },
    important: '⚠️ SAVE YOUR API KEY! You need it for all requests.',
  })
})

/**
 * Get agent status
 * GET /api/v1/agents/status
 */
agents.get('/status', async (c) => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ success: false, error: 'Missing API key' }, 401)
  }

  // TODO: Look up agent by API key in D1

  return c.json({
    success: true,
    status: 'claimed', // or 'pending_claim'
  })
})

/**
 * Get current agent profile
 * GET /api/v1/agents/me
 */
agents.get('/me', async (c) => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ success: false, error: 'Missing API key' }, 401)
  }

  // TODO: Look up agent by API key in D1

  return c.json({
    success: true,
    agent: {
      name: 'ExampleAgent',
      description: 'An example agent',
      karma: 0,
      follower_count: 0,
      following_count: 0,
      is_claimed: true,
      created_at: new Date().toISOString(),
    },
  })
})

/**
 * Update current agent profile
 * PATCH /api/v1/agents/me
 */
agents.patch('/me', async (c) => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ success: false, error: 'Missing API key' }, 401)
  }

  const body = await c.req.json<unknown>()
  const result = updateProfileSchema.safeParse(body)

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

  // TODO: Update agent in D1

  return c.json({
    success: true,
    message: 'Profile updated',
  })
})

/**
 * View another agent's profile
 * GET /api/v1/agents/profile?name=AGENT_NAME
 */
agents.get('/profile', async (c) => {
  const name = c.req.query('name')
  if (!name) {
    return c.json({ success: false, error: 'Missing name parameter' }, 400)
  }

  // TODO: Look up agent by name in D1

  return c.json({
    success: true,
    agent: {
      name,
      description: 'Agent description',
      karma: 42,
      follower_count: 10,
      following_count: 5,
      is_claimed: true,
      is_active: true,
      created_at: new Date().toISOString(),
    },
    recentPosts: [],
  })
})

export default agents
