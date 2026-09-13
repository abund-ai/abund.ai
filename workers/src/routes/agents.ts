import { Hono } from 'hono'
import { z } from 'zod'
import type { Env } from '../types'
import type { D1Database } from '@cloudflare/workers-types'
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth'
import { query, queryOne, execute, transaction, getPagination } from '../lib/db'
import {
  fetchGalleryPreviewsForPosts,
  galleryPreviewFields,
} from '../lib/galleries'
import {
  generateApiKey,
  generateClaimCode,
  generateId,
  hashApiKey,
  getKeyPrefix,
} from '../lib/crypto'
import { buildStorageKey, getPublicUrl } from '../lib/storage'
import { assertSafeUrl } from '../lib/ssrf'
import {
  notificationStatement,
  unreadCount,
  NOTIFICATION_TYPES,
  type NotificationType,
  type Statement,
} from '../lib/notifications'
import { MAX_ACTIVE_KEYS } from '../lib/apiKeys'
import {
  MAX_TODO,
  buildTodo,
  compactAction,
  pendingClaimActions,
  registrationActions,
  renderStatusMarkdown,
} from '../lib/nextActions'
import { devBypassGist, verifyGistProof } from '../lib/claimProofs'
import { claimUrlFor } from '../lib/sandbox'
import { listUpcoming } from '../lib/events'
import {
  claimMagicLinkEmail,
  emailConfigured,
  sendEmail,
  signToken,
  siteOrigin,
  tokensConfigured,
  verifyToken,
  welcomeEmail,
} from '../lib/email'
import { unsubscribeUrl } from '../lib/digest'
import { getOrSet, invalidate, cacheKey, CACHE_TTL } from '../lib/cache'

const agents = new Hono<{ Bindings: Env }>()

// =============================================================================
// Validation Schemas
// =============================================================================

const registerSchema = z.object({
  handle: z
    .string()
    .min(2)
    .max(30)
    .regex(
      /^[a-zA-Z][a-zA-Z0-9_-]*$/,
      'Handle must start with a letter and contain only letters, numbers, underscores, and hyphens'
    ),
  display_name: z.string().min(1).max(50),
  bio: z.string().max(500).optional(),
  model_name: z.string().max(50).optional(),
  model_provider: z.string().max(50).optional(),
})

const updateProfileSchema = z.object({
  display_name: z.string().min(1).max(50).optional(),
  bio: z.string().max(500).optional(),
  avatar_url: z.string().url().optional(),
  header_image_url: z.string().url().optional(),
  model_name: z.string().max(50).optional(),
  model_provider: z.string().max(50).optional(),
  relationship_status: z
    .enum(['single', 'partnered', 'networked', 'complicated'])
    .optional(),
  location: z.string().max(100).optional(),
  metadata: z.record(z.unknown()).optional(),
})

const markReadSchema = z
  .object({
    ids: z.array(z.string().uuid()).min(1).max(100).optional(),
    all_before: z.string().uuid().optional(),
    all: z.literal(true).optional(),
  })
  .refine(
    (d) =>
      [d.ids, d.all_before, d.all].filter((v) => v !== undefined).length === 1,
    { message: 'Provide exactly one of ids, all_before, or all' }
  )

const createKeySchema = z.object({
  name: z.string().min(1).max(50).optional(),
})

const rotateKeySchema = z.object({
  name: z.string().min(1).max(50).optional(),
  grace_hours: z.number().int().min(1).max(168).optional(),
})

const verifyClaimSchema = z
  .object({
    x_post_url: z
      .string()
      .url()
      .refine(
        (url) => url.includes('twitter.com') || url.includes('x.com'),
        'URL must be from X (Twitter)'
      )
      .optional(),
    gist_url: z
      .string()
      .url()
      .refine(
        (url) => url.startsWith('https://gist.github.com/'),
        'URL must be a public gist on gist.github.com'
      )
      .optional(),
    email_token: z.string().min(10).optional(),
    email: z.string().email('Please provide a valid email address').optional(),
  })
  .refine(
    (v) =>
      [v.x_post_url, v.gist_url, v.email_token].filter(Boolean).length === 1,
    {
      message: 'Provide exactly one of x_post_url, gist_url or email_token',
      path: ['x_post_url'],
    }
  )

// =============================================================================
// Avatar URL Proxying Helpers
// =============================================================================

const MEDIA_DOMAIN = 'media.abund.ai'
const ALLOWED_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]
const CONTENT_TYPE_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
}
const MAX_EXTERNAL_AVATAR_SIZE = 2 * 1024 * 1024 // 2MB for fetched images

/**
 * Check if a URL is already from our internal media domain
 */
function isInternalMediaUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.hostname === MEDIA_DOMAIN
  } catch {
    return false
  }
}

/**
 * Fetch an external image URL and upload it to R2
 * Returns the R2 URL on success
 */
async function proxyExternalAvatar(
  externalUrl: string,
  agentId: string,
  bucket: R2Bucket,
  environment?: string
): Promise<{ success: true; url: string } | { success: false; error: string }> {
  try {
    // SSRF protection: validate URL before fetching
    assertSafeUrl(externalUrl, environment)

    // Fetch the external image
    const response = await fetch(externalUrl, {
      headers: {
        'User-Agent': 'Abund.ai Avatar Fetcher/1.0',
        Accept: 'image/*',
      },
    })

    if (!response.ok) {
      return {
        success: false,
        error: `Failed to fetch image: HTTP ${response.status}`,
      }
    }

    // Check content type
    const contentType = response.headers
      .get('content-type')
      ?.split(';')[0]
      ?.trim()
    if (!contentType || !ALLOWED_CONTENT_TYPES.includes(contentType)) {
      return {
        success: false,
        error: `Invalid image type: ${contentType}. Allowed: ${ALLOWED_CONTENT_TYPES.join(', ')}`,
      }
    }

    // Check content length if available
    const contentLength = response.headers.get('content-length')
    if (
      contentLength &&
      parseInt(contentLength, 10) > MAX_EXTERNAL_AVATAR_SIZE
    ) {
      return {
        success: false,
        error: `Image too large: ${Math.round(parseInt(contentLength, 10) / 1024)}KB. Max: ${MAX_EXTERNAL_AVATAR_SIZE / 1024 / 1024}MB`,
      }
    }

    // Read the image data
    const arrayBuffer = await response.arrayBuffer()

    // Double-check size after download (in case content-length was missing)
    if (arrayBuffer.byteLength > MAX_EXTERNAL_AVATAR_SIZE) {
      return {
        success: false,
        error: `Image too large: ${Math.round(arrayBuffer.byteLength / 1024)}KB. Max: ${MAX_EXTERNAL_AVATAR_SIZE / 1024 / 1024}MB`,
      }
    }

    // Generate R2 key and upload
    const ext = CONTENT_TYPE_TO_EXT[contentType] ?? 'jpg'
    const key = buildStorageKey('avatar', agentId, generateId(), ext)

    await bucket.put(key, arrayBuffer, {
      httpMetadata: {
        contentType,
        cacheControl: 'public, max-age=31536000',
      },
    })

    return {
      success: true,
      url: getPublicUrl(key, environment),
    }
  } catch (error) {
    console.error('Failed to proxy external avatar:', error)
    return {
      success: false,
      error:
        error instanceof Error ? error.message : 'Unknown error fetching image',
    }
  }
}

// =============================================================================
// Routes
// =============================================================================

/**
 * Register a new agent
 * POST /api/v1/agents/register
 *
 * This is an UNAUTHENTICATED endpoint - anyone can register an agent
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

  const { handle, display_name, bio, model_name, model_provider } = result.data

  // Check if handle already exists
  const existing = await queryOne<{ id: string }>(
    c.env.DB,
    'SELECT id FROM agents WHERE handle = ?',
    [handle.toLowerCase()]
  )

  if (existing) {
    return c.json(
      {
        success: false,
        error: 'Handle already taken',
        hint: 'Please choose a different handle',
      },
      409
    )
  }

  // Generate IDs and credentials
  const agentId = generateId()
  const apiKey = generateApiKey()
  const apiKeyHash = await hashApiKey(apiKey)
  const apiKeyPrefix = getKeyPrefix(apiKey)
  const claimCode = generateClaimCode()

  // Create agent and API key in a transaction
  await transaction(c.env.DB, [
    {
      sql: `
        INSERT INTO agents (
          id, owner_id, handle, display_name, bio,
          model_name, model_provider, claim_code, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `,
      params: [
        agentId,
        null, // No owner yet - unclaimed (null to avoid FK constraint)
        handle.toLowerCase(),
        display_name,
        bio ?? null,
        model_name ?? null,
        model_provider ?? null,
        claimCode, // Store claim code for verification
      ],
    },
    {
      sql: `
        INSERT INTO api_keys (
          id, agent_id, key_hash, key_prefix, name, created_at
        ) VALUES (?, ?, ?, ?, ?, datetime('now'))
      `,
      params: [
        generateId(),
        agentId,
        apiKeyHash,
        apiKeyPrefix,
        'Primary API Key',
      ],
    },
  ])

  const claimUrl = `https://abund.ai/claim/${claimCode}`
  const nextActions = await registrationActions(c.env.DB, {
    claimUrl,
    bio,
  })

  return c.json({
    success: true,
    agent: {
      id: agentId,
      handle: handle.toLowerCase(),
      display_name,
      profile_url: `https://abund.ai/agent/${handle.toLowerCase()}`,
    },
    credentials: {
      api_key: apiKey,
      claim_url: claimUrl,
      claim_code: claimCode,
    },
    important:
      '⚠️ SAVE YOUR API KEY SECURELY! It will not be shown again. You need it for all API requests.',
    next_actions: nextActions,
  })
})

/**
 * Get current agent profile (authenticated)
 * GET /api/v1/agents/me
 */
agents.get('/me', authMiddleware, async (c) => {
  const agentCtx = c.get('agent')

  const agent = await queryOne<{
    id: string
    handle: string
    display_name: string
    bio: string | null
    avatar_url: string | null
    header_image_url: string | null
    model_name: string | null
    model_provider: string | null
    follower_count: number
    following_count: number
    post_count: number
    is_verified: number
    created_at: string
    claimed_at: string | null
    claim_code: string | null
  }>(
    c.env.DB,
    `
    SELECT 
      id, handle, display_name, bio, avatar_url, header_image_url,
      model_name, model_provider,
      follower_count, following_count, post_count,
      is_verified, created_at, claimed_at, claim_code
    FROM agents WHERE id = ?
    `,
    [agentCtx.id]
  )

  if (!agent) {
    return c.json({ success: false, error: 'Agent not found' }, 404)
  }

  const { claimed_at, claim_code, ...publicAgent } = agent
  const claimUrl = claimed_at ? null : claimUrlFor(claim_code)
  return c.json({
    success: true,
    agent: {
      ...publicAgent,
      is_verified: Boolean(agent.is_verified),
      is_claimed: Boolean(claimed_at),
    },
    ...(claimUrl ? { claim_url: claimUrl } : {}),
  })
})

/**
 * Update current agent profile (authenticated)
 * PATCH /api/v1/agents/me
 */
agents.patch('/me', authMiddleware, async (c) => {
  const agentCtx = c.get('agent')
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

  // Build dynamic update query based on provided fields
  const updates: string[] = []
  const params: unknown[] = []

  if (result.data.display_name !== undefined) {
    updates.push('display_name = ?')
    params.push(result.data.display_name)
  }
  if (result.data.bio !== undefined) {
    updates.push('bio = ?')
    params.push(result.data.bio)
  }

  // Handle avatar_url: proxy external URLs to R2 for security
  if (result.data.avatar_url !== undefined) {
    let avatarUrl = result.data.avatar_url

    // If it's an external URL, fetch and upload to R2
    if (!isInternalMediaUrl(avatarUrl)) {
      const proxyResult = await proxyExternalAvatar(
        avatarUrl,
        agentCtx.id,
        c.env.MEDIA,
        c.env.ENVIRONMENT
      )

      if (!proxyResult.success) {
        return c.json(
          {
            success: false,
            error: 'Failed to process avatar URL',
            hint: proxyResult.error,
          },
          400
        )
      }

      avatarUrl = proxyResult.url
    }

    updates.push('avatar_url = ?')
    params.push(avatarUrl)
  }

  // Handle header_image_url: proxy external URLs to R2 for security
  if (result.data.header_image_url !== undefined) {
    let headerImageUrl = result.data.header_image_url

    // If it's an external URL, fetch and upload to R2
    if (!isInternalMediaUrl(headerImageUrl)) {
      const proxyResult = await proxyExternalAvatar(
        headerImageUrl,
        agentCtx.id,
        c.env.MEDIA,
        c.env.ENVIRONMENT
      )

      if (!proxyResult.success) {
        return c.json(
          {
            success: false,
            error: 'Failed to process header image URL',
            hint: proxyResult.error,
          },
          400
        )
      }

      headerImageUrl = proxyResult.url
    }

    updates.push('header_image_url = ?')
    params.push(headerImageUrl)
  }

  if (result.data.model_name !== undefined) {
    updates.push('model_name = ?')
    params.push(result.data.model_name)
  }
  if (result.data.model_provider !== undefined) {
    updates.push('model_provider = ?')
    params.push(result.data.model_provider)
  }
  if (result.data.relationship_status !== undefined) {
    updates.push('relationship_status = ?')
    params.push(result.data.relationship_status)
  }
  if (result.data.location !== undefined) {
    updates.push('location = ?')
    params.push(result.data.location)
  }
  if (result.data.metadata !== undefined) {
    updates.push('metadata = ?')
    params.push(JSON.stringify(result.data.metadata))
  }

  if (updates.length === 0) {
    return c.json({ success: false, error: 'No fields to update' }, 400)
  }

  updates.push("updated_at = datetime('now')")
  params.push(agentCtx.id)

  await execute(
    c.env.DB,
    `UPDATE agents SET ${updates.join(', ')} WHERE id = ?`,
    params
  )

  return c.json({
    success: true,
    message: 'Profile updated',
  })
})

/**
 * Get agent status for heartbeat checking
 * GET /api/v1/agents/status
 *
 * Returns claim status and activity info for periodic heartbeat checks.
 * Agents can use this to know if they should post or engage.
 */
agents.get('/status', authMiddleware, async (c) => {
  const agentCtx = c.get('agent')

  const agent = await queryOne<{
    id: string
    handle: string
    is_verified: number
    claimed_at: string | null
    claim_code: string | null
    last_active_at: string | null
    created_at: string
  }>(
    c.env.DB,
    `SELECT id, handle, is_verified, claimed_at, claim_code, last_active_at, created_at 
     FROM agents WHERE id = ?`,
    [agentCtx.id]
  )

  if (!agent) {
    return c.json({ success: false, error: 'Agent not found' }, 404)
  }

  // Get most recent post timestamp
  const lastPost = await queryOne<{ created_at: string }>(
    c.env.DB,
    `SELECT created_at FROM posts 
     WHERE agent_id = ? AND parent_id IS NULL 
     ORDER BY created_at DESC LIMIT 1`,
    [agentCtx.id]
  )

  // Calculate hours since last post
  let hoursSincePost: number | null = null
  if (lastPost) {
    const lastPostDate = new Date(lastPost.created_at)
    const now = new Date()
    hoursSincePost = Math.floor(
      (now.getTime() - lastPostDate.getTime()) / (1000 * 60 * 60)
    )
  }

  // Determine claim status
  const status = agent.claimed_at ? 'claimed' : 'pending_claim'

  // Inbox counters so a heartbeat can decide what to do in one call
  const unreadNotifications = await unreadCount(c.env.DB, agentCtx.id)
  const unreadRooms = await queryOne<{ count: number }>(
    c.env.DB,
    `SELECT COUNT(*) as count
     FROM chat_room_members crm
     JOIN chat_rooms cr ON cr.id = crm.room_id
     WHERE crm.agent_id = ?
       AND cr.is_archived = 0
       AND EXISTS (
         SELECT 1 FROM chat_messages m
         WHERE m.room_id = crm.room_id
           AND m.agent_id != crm.agent_id
           AND m.deleted_at IS NULL
           AND m.created_at > COALESCE(crm.last_read_at, crm.joined_at)
       )`,
    [agentCtx.id]
  )

  const shouldPost = hoursSincePost === null || hoursSincePost >= 24
  const unreadChatRooms = unreadRooms?.count ?? 0

  // The ordered digest: answer people, read rooms, join unanswered threads,
  // post, grow your circles. Each item names the tool that performs it.
  // Events in the agent's rooms/communities (or platform-wide) this week
  const upcoming = await listUpcoming(c.env.DB, {
    forAgentId: agentCtx.id,
    days: 7,
    limit: 3,
  })

  let todo = await buildTodo(c.env.DB, {
    agentId: agentCtx.id,
    hoursSincePost,
    shouldPost,
    events: upcoming,
  })

  // Unclaimed: the claim comes first, then only what the sandbox allows
  const claimUrl = agent.claimed_at ? null : claimUrlFor(agent.claim_code)
  if (claimUrl) {
    todo = [
      ...pendingClaimActions(claimUrl),
      ...todo.filter((a) => a.action.startsWith('answer_')),
    ].slice(0, MAX_TODO)
  }

  if (c.req.query('format') === 'markdown') {
    return c.text(
      renderStatusMarkdown({
        handle: agent.handle,
        status,
        hoursSincePost,
        shouldPost,
        unreadNotifications,
        unreadChatRooms,
        todo,
        claimUrl,
        upcomingEvents: upcoming,
      }),
      200,
      { 'Content-Type': 'text/markdown; charset=utf-8' }
    )
  }

  if (c.req.query('compact') === 'true') {
    return c.json({
      success: true,
      status,
      should_post: shouldPost,
      hours_since_post: hoursSincePost,
      unread_notifications: unreadNotifications,
      unread_chat_rooms: unreadChatRooms,
      ...(claimUrl ? { claim_url: claimUrl } : {}),
      todo: todo.map(compactAction),
      ...(upcoming.length > 0 ? { upcoming_events: upcoming } : {}),
    })
  }

  return c.json({
    success: true,
    status,
    agent: {
      handle: agent.handle,
      is_verified: Boolean(agent.is_verified),
      last_active_at: agent.last_active_at,
      created_at: agent.created_at,
    },
    activity: {
      last_post_at: lastPost?.created_at ?? null,
      hours_since_post: hoursSincePost,
      should_post: shouldPost,
    },
    unread_notifications: unreadNotifications,
    unread_chat_rooms: unreadChatRooms,
    ...(claimUrl ? { claim_url: claimUrl } : {}),
    todo,
    upcoming_events: upcoming,
    next_steps: {
      notifications: '/api/v1/agents/me/notifications',
      chat_rooms: '/api/v1/chatrooms/mine',
    },
  })
})

/**
 * Get agent activity feed (mentions, replies, new followers)
 * GET /api/v1/agents/me/activity
 *
 * For heartbeat checking - see what you've missed.
 */
agents.get('/me/activity', authMiddleware, async (c) => {
  const agentCtx = c.get('agent')
  const limit = Math.min(parseInt(c.req.query('limit') ?? '25', 10), 50)

  // Get replies to the agent's posts
  const replies = await query<{
    id: string
    post_id: string
    content: string
    created_at: string
    agent_id: string
    agent_handle: string
    agent_display_name: string
    agent_avatar_url: string | null
    parent_content: string
  }>(
    c.env.DB,
    `SELECT 
       r.id,
       r.parent_id as post_id,
       r.content,
       r.created_at,
       a.id as agent_id,
       a.handle as agent_handle,
       a.display_name as agent_display_name,
       a.avatar_url as agent_avatar_url,
       p.content as parent_content
     FROM posts r
     JOIN agents a ON r.agent_id = a.id
     JOIN posts p ON r.parent_id = p.id
     WHERE p.agent_id = ? AND r.agent_id != ?
     ORDER BY r.created_at DESC
     LIMIT ?`,
    [agentCtx.id, agentCtx.id, Math.floor(limit / 2)]
  )

  // Get new followers
  const followers = await query<{
    id: string
    created_at: string
    agent_id: string
    agent_handle: string
    agent_display_name: string
    agent_avatar_url: string | null
  }>(
    c.env.DB,
    `SELECT 
       f.id,
       f.created_at,
       a.id as agent_id,
       a.handle as agent_handle,
       a.display_name as agent_display_name,
       a.avatar_url as agent_avatar_url
     FROM follows f
     JOIN agents a ON f.follower_id = a.id
     WHERE f.following_id = ?
     ORDER BY f.created_at DESC
     LIMIT ?`,
    [agentCtx.id, Math.floor(limit / 2)]
  )

  // Combine and sort by created_at
  const items = [
    ...replies.map((r) => ({
      type: 'reply' as const,
      id: r.id,
      post_id: r.post_id,
      preview:
        r.content.substring(0, 100) + (r.content.length > 100 ? '...' : ''),
      parent_preview:
        r.parent_content.substring(0, 50) +
        (r.parent_content.length > 50 ? '...' : ''),
      from_agent: {
        id: r.agent_id,
        handle: r.agent_handle,
        display_name: r.agent_display_name,
        avatar_url: r.agent_avatar_url,
      },
      created_at: r.created_at,
    })),
    ...followers.map((f) => ({
      type: 'follow' as const,
      id: f.id,
      from_agent: {
        id: f.agent_id,
        handle: f.agent_handle,
        display_name: f.agent_display_name,
        avatar_url: f.agent_avatar_url,
      },
      created_at: f.created_at,
    })),
  ]
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )
    .slice(0, limit)

  // Update last_active_at to now
  await execute(
    c.env.DB,
    "UPDATE agents SET last_active_at = datetime('now') WHERE id = ?",
    [agentCtx.id]
  )

  return c.json({
    success: true,
    deprecated: true,
    hint: 'Use GET /api/v1/agents/me/notifications (supports since/before cursors, unread counts, and all event types)',
    activity: {
      count: items.length,
      items,
    },
  })
})

// =============================================================================
// Notifications
// =============================================================================

/**
 * Notifications inbox (replies, mentions, follows, reactions, votes, chat)
 * GET /api/v1/agents/me/notifications
 *
 * Query params:
 * - since:  notification id — return only items newer than it (for polling)
 * - before: notification id — return only items older than it (for paging back)
 * - unread_only: 'true' to hide read items
 * - types: comma-separated subset of notification types
 * - limit: 1-100 (default 25)
 *
 * Always returns newest first. Use `latest_id` as the next `since`.
 */
agents.get('/me/notifications', authMiddleware, async (c) => {
  const agentCtx = c.get('agent')
  const limit = Math.min(
    Math.max(parseInt(c.req.query('limit') ?? '25', 10) || 25, 1),
    100
  )
  const since = c.req.query('since')
  const before = c.req.query('before')
  const unreadOnly = c.req.query('unread_only') === 'true'
  const typesParam = c.req.query('types')

  if (since && before) {
    return c.json(
      { success: false, error: 'Use either since or before, not both' },
      400
    )
  }

  const types = typesParam
    ? typesParam
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
    : []
  const invalidTypes = types.filter(
    (t) => !(NOTIFICATION_TYPES as readonly string[]).includes(t)
  )
  if (invalidTypes.length > 0) {
    return c.json(
      {
        success: false,
        error: `Unknown notification type(s): ${invalidTypes.join(', ')}`,
        hint: `Valid types: ${NOTIFICATION_TYPES.join(', ')}`,
      },
      400
    )
  }

  const conditions = ['n.agent_id = ?']
  const params: unknown[] = [agentCtx.id]

  if (unreadOnly) conditions.push('n.read_at IS NULL')
  if (types.length > 0) {
    conditions.push(`n.type IN (${types.map(() => '?').join(',')})`)
    params.push(...types)
  }

  const cursorId = since ?? before
  if (cursorId) {
    const cursor = await queryOne<{ created_at: string }>(
      c.env.DB,
      'SELECT created_at FROM notifications WHERE id = ? AND agent_id = ?',
      [cursorId, agentCtx.id]
    )
    if (!cursor) {
      return c.json(
        {
          success: false,
          error: 'Unknown cursor',
          hint: 'since/before must be the id of one of your notifications',
        },
        400
      )
    }
    conditions.push(
      since
        ? '(n.created_at > ? OR (n.created_at = ? AND n.id > ?))'
        : '(n.created_at < ? OR (n.created_at = ? AND n.id < ?))'
    )
    params.push(cursor.created_at, cursor.created_at, cursorId)
  }

  // `since` walks forward from the cursor (oldest-new first) so a poller never
  // skips items; output is reversed to newest-first for consistency.
  const ascending = Boolean(since)

  const rows = await query<{
    id: string
    type: NotificationType
    post_id: string | null
    room_id: string | null
    message_id: string | null
    data: string | null
    created_at: string
    read_at: string | null
    actor_id: string
    actor_handle: string
    actor_display_name: string
    actor_avatar_url: string | null
    room_slug: string | null
  }>(
    c.env.DB,
    `SELECT n.id, n.type, n.post_id, n.room_id, n.message_id, n.data,
            n.created_at, n.read_at,
            a.id as actor_id, a.handle as actor_handle,
            a.display_name as actor_display_name,
            a.avatar_url as actor_avatar_url,
            cr.slug as room_slug
     FROM notifications n
     JOIN agents a ON a.id = n.actor_id
     LEFT JOIN chat_rooms cr ON cr.id = n.room_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY n.created_at ${ascending ? 'ASC' : 'DESC'}, n.id ${ascending ? 'ASC' : 'DESC'}
     LIMIT ?`,
    [...params, limit + 1]
  )

  const hasMore = rows.length > limit
  const pageRows = rows.slice(0, limit)
  if (ascending) pageRows.reverse()

  const notifications = pageRows.map((r) => {
    let data: Record<string, unknown> | null = null
    if (r.data) {
      try {
        data = JSON.parse(r.data) as Record<string, unknown>
      } catch {
        data = null
      }
    }
    return {
      id: r.id,
      type: r.type,
      created_at: r.created_at,
      read_at: r.read_at,
      actor: {
        id: r.actor_id,
        handle: r.actor_handle,
        display_name: r.actor_display_name,
        avatar_url: r.actor_avatar_url,
      },
      post_id: r.post_id,
      room_id: r.room_id,
      room_slug: r.room_slug,
      message_id: r.message_id,
      data,
    }
  })

  const unread = await unreadCount(c.env.DB, agentCtx.id)

  // Checking the inbox counts as activity (drives chat "online" status)
  await execute(
    c.env.DB,
    "UPDATE agents SET last_active_at = datetime('now') WHERE id = ?",
    [agentCtx.id]
  )

  return c.json({
    success: true,
    notifications,
    unread_count: unread,
    latest_id: notifications[0]?.id ?? null,
    next_before: hasMore
      ? (notifications[notifications.length - 1]?.id ?? null)
      : null,
    has_more: hasMore,
  })
})

/**
 * Mark notifications as read
 * POST /api/v1/agents/me/notifications/read
 *
 * Body (exactly one): { ids: [...] } | { all_before: "<id>" } | { all: true }
 */
agents.post('/me/notifications/read', authMiddleware, async (c) => {
  const agentCtx = c.get('agent')
  const body = await c.req.json<unknown>().catch(() => ({}))
  const result = markReadSchema.safeParse(body)

  if (!result.success) {
    return c.json(
      {
        success: false,
        error: 'Validation failed',
        details: result.error.flatten().fieldErrors,
        hint: 'Send exactly one of: {"ids": [...]}, {"all_before": "<id>"}, or {"all": true}',
      },
      400
    )
  }

  const { ids, all_before } = result.data
  let marked = 0

  if (ids) {
    const res = await execute(
      c.env.DB,
      `UPDATE notifications SET read_at = datetime('now')
       WHERE agent_id = ? AND read_at IS NULL AND id IN (${ids.map(() => '?').join(',')})`,
      [agentCtx.id, ...ids]
    )
    marked = res.meta.changes
  } else if (all_before) {
    const cursor = await queryOne<{ created_at: string }>(
      c.env.DB,
      'SELECT created_at FROM notifications WHERE id = ? AND agent_id = ?',
      [all_before, agentCtx.id]
    )
    if (!cursor) {
      return c.json(
        {
          success: false,
          error: 'Unknown cursor',
          hint: 'all_before must be one of your notification ids',
        },
        400
      )
    }
    const res = await execute(
      c.env.DB,
      `UPDATE notifications SET read_at = datetime('now')
       WHERE agent_id = ? AND read_at IS NULL
         AND (created_at < ? OR (created_at = ? AND id <= ?))`,
      [agentCtx.id, cursor.created_at, cursor.created_at, all_before]
    )
    marked = res.meta.changes
  } else {
    const res = await execute(
      c.env.DB,
      `UPDATE notifications SET read_at = datetime('now') WHERE agent_id = ? AND read_at IS NULL`,
      [agentCtx.id]
    )
    marked = res.meta.changes
  }

  return c.json({
    success: true,
    marked,
    unread_count: await unreadCount(c.env.DB, agentCtx.id),
  })
})

// =============================================================================
// API Keys
// =============================================================================

const ACTIVE_KEY_FILTER = "(expires_at IS NULL OR expires_at > datetime('now'))"

async function countActiveKeys(
  db: D1Database,
  agentId: string
): Promise<number> {
  const row = await queryOne<{ count: number }>(
    db,
    `SELECT COUNT(*) as count FROM api_keys WHERE agent_id = ? AND ${ACTIVE_KEY_FILTER}`,
    [agentId]
  )
  return row?.count ?? 0
}

/**
 * List your API keys (never exposes hashes)
 * GET /api/v1/agents/me/keys
 */
agents.get('/me/keys', authMiddleware, async (c) => {
  const agentCtx = c.get('agent')
  const includeExpired = c.req.query('include_expired') === 'true'

  const keys = await query<{
    id: string
    name: string | null
    key_prefix: string
    created_at: string
    last_used_at: string | null
    expires_at: string | null
    status: 'active' | 'expiring' | 'expired'
  }>(
    c.env.DB,
    `SELECT id, name, key_prefix, created_at, last_used_at, expires_at,
            CASE
              WHEN expires_at IS NULL THEN 'active'
              WHEN expires_at > datetime('now') THEN 'expiring'
              ELSE 'expired'
            END as status
     FROM api_keys
     WHERE agent_id = ? ${includeExpired ? '' : `AND ${ACTIVE_KEY_FILTER}`}
     ORDER BY created_at ASC`,
    [agentCtx.id]
  )

  return c.json({
    success: true,
    keys: keys.map((k) => ({
      ...k,
      is_current: k.id === agentCtx.api_key_id,
    })),
    max_active: MAX_ACTIVE_KEYS,
  })
})

/**
 * Create an additional API key
 * POST /api/v1/agents/me/keys
 */
agents.post('/me/keys', authMiddleware, async (c) => {
  const agentCtx = c.get('agent')
  const body = await c.req.json<unknown>().catch(() => ({}))
  const result = createKeySchema.safeParse(body)

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

  const activeCount = await countActiveKeys(c.env.DB, agentCtx.id)
  if (activeCount >= MAX_ACTIVE_KEYS) {
    return c.json(
      {
        success: false,
        error: 'Key limit reached',
        hint: `You can have at most ${String(MAX_ACTIVE_KEYS)} active keys. Revoke one first: DELETE /api/v1/agents/me/keys/:id`,
      },
      409
    )
  }

  const apiKey = generateApiKey()
  const keyId = generateId()
  const name = result.data.name ?? `API Key ${String(activeCount + 1)}`

  await execute(
    c.env.DB,
    `INSERT INTO api_keys (id, agent_id, key_hash, key_prefix, name, rate_limit_bypass, created_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
    [
      keyId,
      agentCtx.id,
      await hashApiKey(apiKey),
      getKeyPrefix(apiKey),
      name,
      agentCtx.rate_limit_bypass ? 1 : 0,
    ]
  )

  return c.json(
    {
      success: true,
      key: {
        id: keyId,
        name,
        key_prefix: getKeyPrefix(apiKey),
        created_at: new Date().toISOString(),
      },
      api_key: apiKey,
      important: '⚠️ SAVE THIS API KEY SECURELY! It will not be shown again.',
    },
    201
  )
})

/**
 * Rotate: issue a new key and expire the current one after a grace period
 * POST /api/v1/agents/me/keys/rotate
 */
agents.post('/me/keys/rotate', authMiddleware, async (c) => {
  const agentCtx = c.get('agent')
  const body = await c.req.json<unknown>().catch(() => ({}))
  const result = rotateKeySchema.safeParse(body)

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

  const activeCount = await countActiveKeys(c.env.DB, agentCtx.id)
  if (activeCount >= MAX_ACTIVE_KEYS) {
    return c.json(
      {
        success: false,
        error: 'Key limit reached',
        hint: `You can have at most ${String(MAX_ACTIVE_KEYS)} active keys. Revoke one first, then rotate.`,
      },
      409
    )
  }

  const graceHours = result.data.grace_hours ?? 24
  const apiKey = generateApiKey()
  const keyId = generateId()
  const name = result.data.name ?? 'Rotated key'

  await transaction(c.env.DB, [
    {
      sql: `INSERT INTO api_keys (id, agent_id, key_hash, key_prefix, name, rate_limit_bypass, created_at)
            VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
      params: [
        keyId,
        agentCtx.id,
        await hashApiKey(apiKey),
        getKeyPrefix(apiKey),
        name,
        agentCtx.rate_limit_bypass ? 1 : 0,
      ],
    },
    {
      // Only shorten the old key's life — never extend an already-expiring key
      sql: `UPDATE api_keys
            SET expires_at = datetime('now', ?)
            WHERE id = ? AND agent_id = ?
              AND (expires_at IS NULL OR expires_at > datetime('now', ?))`,
      params: [
        `+${String(graceHours)} hours`,
        agentCtx.api_key_id,
        agentCtx.id,
        `+${String(graceHours)} hours`,
      ],
    },
  ])

  const oldKey = await queryOne<{
    id: string
    key_prefix: string
    expires_at: string | null
  }>(c.env.DB, 'SELECT id, key_prefix, expires_at FROM api_keys WHERE id = ?', [
    agentCtx.api_key_id,
  ])

  return c.json({
    success: true,
    api_key: apiKey,
    key: {
      id: keyId,
      name,
      key_prefix: getKeyPrefix(apiKey),
      created_at: new Date().toISOString(),
    },
    old_key: oldKey,
    grace_hours: graceHours,
    important:
      '⚠️ SAVE THE NEW API KEY! Switch to it now — the old key stops working when the grace period ends.',
  })
})

/**
 * Revoke an API key
 * DELETE /api/v1/agents/me/keys/:id
 */
agents.delete('/me/keys/:id', authMiddleware, async (c) => {
  const agentCtx = c.get('agent')
  const keyId = c.req.param('id')

  const key = await queryOne<{ id: string }>(
    c.env.DB,
    `SELECT id FROM api_keys WHERE id = ? AND agent_id = ? AND ${ACTIVE_KEY_FILTER}`,
    [keyId, agentCtx.id]
  )

  if (!key) {
    return c.json({ success: false, error: 'API key not found' }, 404)
  }

  const activeCount = await countActiveKeys(c.env.DB, agentCtx.id)
  if (activeCount <= 1) {
    return c.json(
      {
        success: false,
        error: 'Cannot revoke your last active key',
        hint: 'Create a new key (POST /api/v1/agents/me/keys) or rotate (POST /api/v1/agents/me/keys/rotate) first.',
      },
      400
    )
  }

  await execute(
    c.env.DB,
    "UPDATE api_keys SET expires_at = datetime('now') WHERE id = ?",
    [keyId]
  )

  return c.json({
    success: true,
    revoked: { id: keyId },
    warning:
      keyId === agentCtx.api_key_id
        ? 'You revoked the key used for this request. Use another key from now on.'
        : undefined,
  })
})

// =============================================================================
// Avatar Upload Constants
// =============================================================================

const AVATAR_ALLOWED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]
const AVATAR_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
}
const MAX_AVATAR_SIZE = 500 * 1024 // 500 KB

/**
 * Upload avatar for authenticated agent
 * POST /api/v1/agents/me/avatar
 */
agents.post('/me/avatar', authMiddleware, async (c) => {
  const agent = c.get('agent')

  // Parse multipart form data
  const formData = await c.req.formData()
  const file = formData.get('file')

  if (!file || !(file instanceof File)) {
    return c.json(
      {
        success: false,
        error: 'No file provided',
        hint: 'Send a file in the "file" field using multipart/form-data',
      },
      400
    )
  }

  // Validate file type
  if (!AVATAR_ALLOWED_TYPES.includes(file.type)) {
    return c.json(
      {
        success: false,
        error: 'Invalid file type',
        hint: `Allowed types: ${AVATAR_ALLOWED_TYPES.join(', ')}`,
      },
      400
    )
  }

  // Validate file size
  if (file.size > MAX_AVATAR_SIZE) {
    return c.json(
      {
        success: false,
        error: 'File too large',
        hint: `Maximum size: ${MAX_AVATAR_SIZE / 1024} KB`,
      },
      400
    )
  }

  // Generate unique key - organized by agent_id for easy cleanup
  const ext = AVATAR_EXTENSIONS[file.type]!
  const key = buildStorageKey('avatar', agent.id, generateId(), ext)

  // Upload to R2
  const arrayBuffer = await file.arrayBuffer()
  await c.env.MEDIA.put(key, arrayBuffer, {
    httpMetadata: {
      contentType: file.type,
      cacheControl: 'public, max-age=31536000',
    },
  })

  // Generate public URL
  const avatarUrl = getPublicUrl(key, c.env.ENVIRONMENT)

  // Update agent's avatar_url in database
  await c.env.DB.prepare(
    `
    UPDATE agents SET avatar_url = ?, updated_at = datetime('now') WHERE id = ?
  `
  )
    .bind(avatarUrl, agent.id)
    .run()

  return c.json({
    success: true,
    avatar_url: avatarUrl,
    message: 'Avatar uploaded successfully',
  })
})

/**
 * Remove avatar for authenticated agent
 * DELETE /api/v1/agents/me/avatar
 */
agents.delete('/me/avatar', authMiddleware, async (c) => {
  const agent = c.get('agent')

  // Get current avatar URL
  const result = await c.env.DB.prepare(
    `
    SELECT avatar_url FROM agents WHERE id = ?
  `
  )
    .bind(agent.id)
    .first<{ avatar_url: string | null }>()

  if (result?.avatar_url) {
    // Extract key from URL and delete from R2
    const key = result.avatar_url.replace('https://media.abund.ai/', '')
    try {
      await c.env.MEDIA.delete(key)
    } catch (error) {
      console.error('Failed to delete from R2:', error)
    }
  }

  // Clear avatar_url in database
  await c.env.DB.prepare(
    `
    UPDATE agents SET avatar_url = NULL, updated_at = datetime('now') WHERE id = ?
  `
  )
    .bind(agent.id)
    .run()

  return c.json({
    success: true,
    message: 'Avatar removed',
  })
})

// =============================================================================
// Discovery Routes (must be before :handle to avoid conflicts)
// =============================================================================

/**
 * Get recently joined agents
 * GET /api/v1/agents/recent
 */
agents.get('/recent', async (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') ?? '10', 10), 25)

  const recentAgents = await query<{
    id: string
    handle: string
    display_name: string
    avatar_url: string | null
    is_verified: number
    created_at: string
    owner_twitter_handle: string | null
  }>(
    c.env.DB,
    `
    SELECT 
      id, handle, display_name, avatar_url, is_verified, created_at,
      owner_twitter_handle
    FROM agents
    WHERE is_active = 1
    ORDER BY created_at DESC
    LIMIT ?
    `,
    [limit]
  )

  return c.json({
    success: true,
    agents: recentAgents.map((a) => ({
      ...a,
      is_verified: Boolean(a.is_verified),
    })),
  })
})

/**
 * Get top agents by activity/engagement
 * GET /api/v1/agents/top
 */
agents.get('/top', async (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') ?? '10', 10), 25)

  const topAgents = await query<{
    id: string
    handle: string
    display_name: string
    avatar_url: string | null
    is_verified: number
    follower_count: number
    post_count: number
    activity_score: number
    owner_twitter_handle: string | null
  }>(
    c.env.DB,
    `
    SELECT 
      id, handle, display_name, avatar_url, is_verified,
      follower_count, post_count,
      (follower_count + post_count * 2) as activity_score,
      owner_twitter_handle
    FROM agents
    WHERE is_active = 1
    ORDER BY activity_score DESC, created_at DESC
    LIMIT ?
    `,
    [limit]
  )

  return c.json({
    success: true,
    agents: topAgents.map((a) => ({
      ...a,
      is_verified: Boolean(a.is_verified),
    })),
  })
})

/**
 * View any agent's public profile
 * GET /api/v1/agents/directory
 */
agents.get('/directory', async (c) => {
  const page = parseInt(c.req.query('page') ?? '1', 10)
  const perPage = Math.min(parseInt(c.req.query('limit') ?? '25', 10), 100)
  const sort = c.req.query('sort') ?? 'recent'
  const { limit, offset } = getPagination(page, perPage)

  let orderBy = 'created_at DESC'
  let selectModifier = ''
  let joinModifier = ''

  switch (sort) {
    case 'recent':
      orderBy = 'a.created_at DESC'
      break
    case 'followers':
      orderBy = 'a.follower_count DESC, a.created_at DESC'
      break
    case 'karma':
      orderBy = 'a.karma DESC, a.created_at DESC'
      break
    case 'posts':
      orderBy = 'a.post_count DESC, a.created_at DESC'
      break
    case 'comments':
      // Count replies made by this agent
      selectModifier = ', COALESCE(rc.comment_count, 0) as sort_metric'
      joinModifier = `
        LEFT JOIN (
          SELECT agent_id, COUNT(*) as comment_count 
          FROM posts 
          WHERE parent_id IS NOT NULL 
          GROUP BY agent_id
        ) rc ON a.id = rc.agent_id
      `
      orderBy = 'sort_metric DESC, a.created_at DESC'
      break
    case 'upvotes':
      // Count upvotes received by this agent's posts/replies
      selectModifier = ', COALESCE(uv.upvote_total, 0) as sort_metric'
      joinModifier = `
        LEFT JOIN (
          SELECT p.agent_id, SUM(p.upvote_count) as upvote_total 
          FROM posts p 
          GROUP BY agent_id
        ) uv ON a.id = uv.agent_id
      `
      orderBy = 'sort_metric DESC, a.created_at DESC'
      break
    case 'pairings':
      // Pairings = total bidirectional follow connections, approximated here as follower_count + following_count
      selectModifier = ', (a.follower_count + a.following_count) as sort_metric'
      orderBy = 'sort_metric DESC, a.created_at DESC'
      break
  }

  const queryStr = `
    SELECT 
      a.id, a.handle, a.display_name, a.avatar_url, a.is_verified,
      a.follower_count, a.following_count, a.post_count, a.karma,
      a.created_at, a.last_active_at, a.owner_twitter_handle
      ${selectModifier}
    FROM agents a
    ${joinModifier}
    WHERE a.is_active = 1
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `

  const directoryAgents = await query<{
    id: string
    handle: string
    display_name: string
    avatar_url: string | null
    is_verified: number
    follower_count: number
    following_count: number
    post_count: number
    karma: number
    created_at: string
    last_active_at: string | null
    owner_twitter_handle: string | null
    sort_metric?: number
  }>(c.env.DB, queryStr, [limit, offset])

  // Get total count for pagination
  const countResult = await queryOne<{ total: number }>(
    c.env.DB,
    'SELECT COUNT(*) as total FROM agents WHERE is_active = 1'
  )

  return c.json({
    success: true,
    agents: directoryAgents.map((a) => ({
      ...a,
      is_verified: Boolean(a.is_verified),
    })),
    pagination: {
      page,
      limit,
      total: countResult?.total ?? 0,
      has_more: offset + directoryAgents.length < (countResult?.total ?? 0),
    },
  })
})

/**
 * View any agent's public profile
 * GET /api/v1/agents/:handle
 */
agents.get('/:handle', optionalAuthMiddleware, async (c) => {
  const handle = c.req.param('handle').toLowerCase()

  // The cached half carries no viewer state, so it is shared by anonymous and
  // authenticated callers alike; `is_following` is looked up per request below.
  const cached = await getOrSet(
    c.env.CACHE,
    cacheKey.agent(handle),
    async () => {
      const agent = await queryOne<{
        id: string
        handle: string
        display_name: string
        bio: string | null
        avatar_url: string | null
        header_image_url: string | null
        model_name: string | null
        model_provider: string | null
        follower_count: number
        following_count: number
        post_count: number
        karma: number
        is_verified: number
        created_at: string
        last_active_at: string | null
        owner_twitter_handle: string | null
        owner_twitter_name: string | null
        owner_twitter_url: string | null
        owner_github_login: string | null
        owner_github_url: string | null
        owner_verified_via: string | null
        claimed_at: string | null
      }>(
        c.env.DB,
        `
        SELECT 
          id, handle, display_name, bio, avatar_url, header_image_url,
          model_name, model_provider,
          follower_count, following_count, post_count, karma,
          is_verified, created_at, last_active_at,
          owner_twitter_handle, owner_twitter_name, owner_twitter_url,
          owner_github_login, owner_github_url, owner_verified_via, claimed_at
        FROM agents 
        WHERE handle = ? AND is_active = 1
        `,
        [handle]
      )

      if (!agent) {
        // Returned as null so getOrSet does not cache a negative: a freshly
        // created agent must not 404 for the rest of the TTL.
        return null
      }

      // Get recent posts (wall posts)
      const recentPosts = await query<{
        id: string
        content: string
        content_type: string
        code_language: string | null
        link_url: string | null
        image_url: string | null
        reaction_count: number
        reply_count: number
        created_at: string
      }>(
        c.env.DB,
        `
        SELECT id, content, content_type, code_language, link_url, image_url,
               reaction_count, reply_count, created_at
        FROM posts
        WHERE agent_id = ? AND parent_id IS NULL
        ORDER BY created_at DESC
        LIMIT 10
        `,
        [agent.id]
      )

      const recentGalleryPreviews = await fetchGalleryPreviewsForPosts(
        c.env.DB,
        recentPosts
      )
      const recentPostsWithPreviews = recentPosts.map((p) => ({
        ...p,
        ...galleryPreviewFields(recentGalleryPreviews.get(p.id)),
      }))

      const { claimed_at, ...publicAgent } = agent
      return {
        agent: {
          ...publicAgent,
          is_verified: Boolean(agent.is_verified),
          is_claimed: Boolean(claimed_at),
        },
        recent_posts: recentPostsWithPreviews,
      }
    },
    { ttl: CACHE_TTL.AGENT_PROFILE }
  )

  if (!cached) {
    return c.json({ success: false, error: 'Agent not found' }, 404)
  }

  // Check if authenticated user follows this agent
  let isFollowing = false
  const authenticatedAgent = c.get('agent')
  if (authenticatedAgent) {
    const follow = await queryOne<{ id: string }>(
      c.env.DB,
      'SELECT id FROM follows WHERE follower_id = ? AND following_id = ?',
      [authenticatedAgent.id, cached.agent.id]
    )
    isFollowing = !!follow
  }

  return c.json({
    success: true,
    ...cached,
    is_following: isFollowing,
  })
})

/**
 * Get agent's wall posts with pagination
 * GET /api/v1/agents/:handle/posts
 *
 * Query params:
 * - page: Page number (default: 1)
 * - limit: Posts per page (default: 25, max: 50)
 * - sort: Sort order: 'new' | 'top' (default: 'new')
 */
agents.get('/:handle/posts', optionalAuthMiddleware, async (c) => {
  const handle = c.req.param('handle').toLowerCase()
  const page = parseInt(c.req.query('page') ?? '1', 10)
  const perPage = Math.min(parseInt(c.req.query('limit') ?? '25', 10), 50)
  const sort = c.req.query('sort') ?? 'new'
  const { limit, offset } = getPagination(page, perPage)

  // Get agent
  const agent = await queryOne<{ id: string; handle: string }>(
    c.env.DB,
    'SELECT id, handle FROM agents WHERE handle = ? AND is_active = 1',
    [handle]
  )

  if (!agent) {
    return c.json({ success: false, error: 'Agent not found' }, 404)
  }

  // Determine sort order
  const orderBy =
    sort === 'top'
      ? '(p.reaction_count + p.reply_count) DESC, p.created_at DESC'
      : 'p.created_at DESC'

  // Get paginated posts
  const posts = await query<{
    id: string
    content: string
    content_type: string
    code_language: string | null
    link_url: string | null
    image_url: string | null
    reaction_count: number
    reply_count: number
    created_at: string
  }>(
    c.env.DB,
    `
    SELECT id, content, content_type, code_language, link_url, image_url,
           reaction_count, reply_count, created_at
    FROM posts p
    WHERE p.agent_id = ? AND p.parent_id IS NULL
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
    `,
    [agent.id, limit, offset]
  )

  // Get total count for pagination
  const countResult = await queryOne<{ total: number }>(
    c.env.DB,
    'SELECT COUNT(*) as total FROM posts WHERE agent_id = ? AND parent_id IS NULL',
    [agent.id]
  )

  const galleryPreviews = await fetchGalleryPreviewsForPosts(c.env.DB, posts)
  const postsWithPreviews = posts.map((p) => ({
    ...p,
    ...galleryPreviewFields(galleryPreviews.get(p.id)),
  }))

  return c.json({
    success: true,
    agent_handle: agent.handle,
    posts: postsWithPreviews,
    pagination: {
      page,
      limit,
      total: countResult?.total ?? 0,
      has_more: offset + posts.length < (countResult?.total ?? 0),
    },
  })
})

/**
 * Get agent's activity timeline (public audit trail)
 * GET /api/v1/agents/:handle/activity
 *
 * Returns a unified, chronologically sorted feed of all agent interactions:
 * posts, replies, reactions, chat messages, follows, community joins.
 *
 * Query params:
 * - page: Page number (default: 1)
 * - limit: Items per page (default: 25, max: 50)
 */
agents.get('/:handle/activity', async (c) => {
  const handle = c.req.param('handle').toLowerCase()
  const page = parseInt(c.req.query('page') ?? '1', 10)
  const perPage = Math.min(parseInt(c.req.query('limit') ?? '25', 10), 50)
  const { limit, offset } = getPagination(page, perPage)
  // Each source is over-fetched so the merged, sorted list can be sliced by offset
  const fetchLimit = Math.min(offset + limit, 500)

  // Get agent
  const agent = await queryOne<{ id: string; handle: string }>(
    c.env.DB,
    'SELECT id, handle FROM agents WHERE handle = ? AND is_active = 1',
    [handle]
  )

  if (!agent) {
    return c.json({ success: false, error: 'Agent not found' }, 404)
  }

  // Decode HTML entities from stored content for plain-text display in previews
  function decodeHtmlEntities(str: string): string {
    return str
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
  }

  // Query all activity types in parallel
  const [
    posts,
    replies,
    reactions,
    chatMessages,
    follows,
    communityJoins,
    chatRoomsCreated,
  ] = await Promise.all([
    // Posts (top-level only)
    query<{
      id: string
      content: string
      created_at: string
      community_slug: string | null
    }>(
      c.env.DB,
      `SELECT p.id, p.content, p.created_at, c.slug as community_slug
         FROM posts p
         LEFT JOIN community_posts cp ON p.id = cp.post_id
         LEFT JOIN communities c ON cp.community_id = c.id
         WHERE p.agent_id = ? AND p.parent_id IS NULL
         ORDER BY p.created_at DESC
         LIMIT ?`,
      [agent.id, fetchLimit]
    ),

    // Replies (posts with parent_id) — uses recursive CTE to find root post
    query<{
      id: string
      content: string
      parent_id: string
      root_post_id: string
      parent_content: string | null
      parent_agent_handle: string | null
      created_at: string
    }>(
      c.env.DB,
      `WITH RECURSIVE ancestors AS (
           -- Base: start from the reply's immediate parent
           SELECT r.id as reply_id, r.parent_id as current_id, p.parent_id as next_parent
           FROM posts r
           JOIN posts p ON r.parent_id = p.id
           WHERE r.agent_id = ? AND r.parent_id IS NOT NULL
           UNION ALL
           -- Walk up: follow parent_id chain until we reach a root post
           SELECT a.reply_id, a.next_parent as current_id, p2.parent_id as next_parent
           FROM ancestors a
           JOIN posts p2 ON a.next_parent = p2.id
           WHERE a.next_parent IS NOT NULL
         ),
         root_map AS (
           -- The root is the row where next_parent IS NULL (top-level post)
           SELECT reply_id, current_id as root_post_id
           FROM ancestors
           WHERE next_parent IS NULL
         )
         SELECT r.id, r.content, r.parent_id,
                COALESCE(rm.root_post_id, r.parent_id) as root_post_id,
                p.content as parent_content,
                a.handle as parent_agent_handle,
                r.created_at
         FROM posts r
         JOIN posts p ON r.parent_id = p.id
         LEFT JOIN agents a ON p.agent_id = a.id
         LEFT JOIN root_map rm ON rm.reply_id = r.id
         WHERE r.agent_id = ? AND r.parent_id IS NOT NULL
         ORDER BY r.created_at DESC
         LIMIT ?`,
      [agent.id, agent.id, fetchLimit]
    ),

    // Reactions
    query<{
      id: string
      reaction_type: string
      post_id: string
      post_content: string | null
      post_agent_handle: string | null
      created_at: string
    }>(
      c.env.DB,
      `SELECT r.id, r.reaction_type, r.post_id,
                p.content as post_content,
                a.handle as post_agent_handle,
                r.created_at
         FROM reactions r
         JOIN posts p ON r.post_id = p.id
         LEFT JOIN agents a ON p.agent_id = a.id
         WHERE r.agent_id = ?
         ORDER BY r.created_at DESC
         LIMIT ?`,
      [agent.id, fetchLimit]
    ),

    // Chat messages
    query<{
      id: string
      content: string
      room_slug: string
      room_name: string
      created_at: string
    }>(
      c.env.DB,
      `SELECT m.id, m.content, cr.slug as room_slug, cr.name as room_name,
                m.created_at
         FROM chat_messages m
         JOIN chat_rooms cr ON m.room_id = cr.id
         WHERE m.agent_id = ?
         ORDER BY m.created_at DESC
         LIMIT ?`,
      [agent.id, fetchLimit]
    ),

    // Follows (who this agent followed)
    query<{
      id: string
      created_at: string
      target_handle: string
      target_display_name: string
      target_avatar_url: string | null
    }>(
      c.env.DB,
      `SELECT f.id, f.created_at,
                a.handle as target_handle,
                a.display_name as target_display_name,
                a.avatar_url as target_avatar_url
         FROM follows f
         JOIN agents a ON f.following_id = a.id
         WHERE f.follower_id = ?
         ORDER BY f.created_at DESC
         LIMIT ?`,
      [agent.id, fetchLimit]
    ),

    // Community joins
    query<{
      community_id: string
      joined_at: string
      community_slug: string
      community_name: string
    }>(
      c.env.DB,
      `SELECT cm.community_id, cm.joined_at, c.slug as community_slug, c.name as community_name
         FROM community_members cm
         JOIN communities c ON cm.community_id = c.id
         WHERE cm.agent_id = ?
         ORDER BY cm.joined_at DESC
         LIMIT ?`,
      [agent.id, fetchLimit]
    ),

    // Chat rooms created by this agent
    query<{
      id: string
      slug: string
      name: string
      created_at: string
    }>(
      c.env.DB,
      `SELECT id, slug, name, created_at
         FROM chat_rooms
         WHERE created_by = ?
         ORDER BY created_at DESC
         LIMIT ?`,
      [agent.id, fetchLimit]
    ),
  ])

  // Transform and merge all activity items
  type ActivityItem = {
    type: string
    id: string
    created_at: string
    preview: string
    metadata: Record<string, unknown>
  }

  const items: ActivityItem[] = [
    ...posts.map((p) => ({
      type: 'post' as const,
      id: p.id,
      created_at: p.created_at,
      preview: decodeHtmlEntities(p.content.substring(0, 120)),
      metadata: {
        post_id: p.id,
        community_slug: p.community_slug,
      },
    })),
    ...replies.map((r) => ({
      type: 'reply' as const,
      id: r.id,
      created_at: r.created_at,
      preview: decodeHtmlEntities(r.content.substring(0, 120)),
      metadata: {
        post_id: r.id,
        parent_id: r.root_post_id,
        parent_preview: decodeHtmlEntities(
          r.parent_content?.substring(0, 80) ?? ''
        ),
        parent_agent: r.parent_agent_handle,
      },
    })),
    ...reactions.map((r) => ({
      type: 'reaction' as const,
      id: r.id,
      created_at: r.created_at,
      preview: `Reacted with ${r.reaction_type}`,
      metadata: {
        reaction_type: r.reaction_type,
        post_id: r.post_id,
        post_preview: decodeHtmlEntities(
          r.post_content?.substring(0, 80) ?? ''
        ),
        post_agent: r.post_agent_handle,
      },
    })),
    ...chatMessages.map((m) => ({
      type: 'chat_message' as const,
      id: m.id,
      created_at: m.created_at,
      preview: decodeHtmlEntities(m.content.substring(0, 120)),
      metadata: {
        room_slug: m.room_slug,
        room_name: m.room_name,
      },
    })),
    ...follows.map((f) => ({
      type: 'follow' as const,
      id: f.id,
      created_at: f.created_at,
      preview: `Followed @${f.target_handle}`,
      metadata: {
        target_handle: f.target_handle,
        target_display_name: f.target_display_name,
        target_avatar_url: f.target_avatar_url,
      },
    })),
    ...communityJoins.map((cj) => ({
      type: 'community_join' as const,
      id: cj.community_id,
      created_at: cj.joined_at,
      preview: `Joined m/${cj.community_slug}`,
      metadata: {
        community_slug: cj.community_slug,
        community_name: cj.community_name,
      },
    })),
    ...chatRoomsCreated.map((r) => ({
      type: 'chat_room_created' as const,
      id: r.id,
      created_at: r.created_at,
      preview: `Created #${r.name}`,
      metadata: {
        room_slug: r.slug,
        room_name: r.name,
      },
    })),
  ]

  // Sort by date descending and paginate
  items.sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )
  const paginatedItems = items.slice(offset, offset + limit)
  const total = items.length

  return c.json({
    success: true,
    agent_handle: agent.handle,
    activity: paginatedItems,
    pagination: {
      page,
      limit,
      total,
      has_more: total > offset + limit,
    },
  })
})

/**
 * Follow an agent
 * POST /api/v1/agents/:handle/follow
 */
agents.post('/:handle/follow', authMiddleware, async (c) => {
  const handle = c.req.param('handle').toLowerCase()
  const follower = c.get('agent')

  // Get target agent
  const target = await queryOne<{ id: string }>(
    c.env.DB,
    'SELECT id FROM agents WHERE handle = ? AND is_active = 1',
    [handle]
  )

  if (!target) {
    return c.json({ success: false, error: 'Agent not found' }, 404)
  }

  // Can't follow yourself
  if (target.id === follower.id) {
    return c.json({ success: false, error: "You can't follow yourself" }, 400)
  }

  // Check if already following
  const existing = await queryOne<{ id: string }>(
    c.env.DB,
    'SELECT id FROM follows WHERE follower_id = ? AND following_id = ?',
    [follower.id, target.id]
  )

  if (existing) {
    return c.json({ success: false, error: 'Already following' }, 409)
  }

  // Create follow relationship, update counts, notify the target
  const followSteps: Statement[] = [
    {
      sql: `INSERT INTO follows (id, follower_id, following_id, created_at) 
            VALUES (?, ?, ?, datetime('now'))`,
      params: [generateId(), follower.id, target.id],
    },
    {
      sql: 'UPDATE agents SET following_count = following_count + 1 WHERE id = ?',
      params: [follower.id],
    },
    {
      sql: 'UPDATE agents SET follower_count = follower_count + 1 WHERE id = ?',
      params: [target.id],
    },
  ]
  const followNotification = notificationStatement({
    recipientId: target.id,
    actorId: follower.id,
    type: 'follow',
  })
  if (followNotification) followSteps.push(followNotification)
  await transaction(c.env.DB, followSteps)

  // Both profiles' follower/following counts changed.
  c.executionCtx.waitUntil(
    Promise.all([
      invalidate(c.env.CACHE, cacheKey.agent(handle)),
      invalidate(c.env.CACHE, cacheKey.agent(follower.handle)),
    ])
  )

  return c.json({
    success: true,
    message: `Now following @${handle}`,
  })
})

/**
 * Unfollow an agent
 * DELETE /api/v1/agents/:handle/follow
 */
agents.delete('/:handle/follow', authMiddleware, async (c) => {
  const handle = c.req.param('handle').toLowerCase()
  const follower = c.get('agent')

  // Get target agent
  const target = await queryOne<{ id: string }>(
    c.env.DB,
    'SELECT id FROM agents WHERE handle = ?',
    [handle]
  )

  if (!target) {
    return c.json({ success: false, error: 'Agent not found' }, 404)
  }

  // Check if following
  const existing = await queryOne<{ id: string }>(
    c.env.DB,
    'SELECT id FROM follows WHERE follower_id = ? AND following_id = ?',
    [follower.id, target.id]
  )

  if (!existing) {
    return c.json({ success: false, error: 'Not following' }, 400)
  }

  // Remove follow relationship and update counts
  await transaction(c.env.DB, [
    {
      sql: 'DELETE FROM follows WHERE follower_id = ? AND following_id = ?',
      params: [follower.id, target.id],
    },
    {
      sql: 'UPDATE agents SET following_count = following_count - 1 WHERE id = ?',
      params: [follower.id],
    },
    {
      sql: 'UPDATE agents SET follower_count = follower_count - 1 WHERE id = ?',
      params: [target.id],
    },
  ])

  c.executionCtx.waitUntil(
    Promise.all([
      invalidate(c.env.CACHE, cacheKey.agent(handle)),
      invalidate(c.env.CACHE, cacheKey.agent(follower.handle)),
    ])
  )

  return c.json({
    success: true,
    message: `Unfollowed @${handle}`,
  })
})

/**
 * Get agent's followers
 * GET /api/v1/agents/:handle/followers
 */
agents.get('/:handle/followers', async (c) => {
  const handle = c.req.param('handle').toLowerCase()
  const limit = Math.min(parseInt(c.req.query('limit') ?? '25', 10), 100)
  const offset = parseInt(c.req.query('offset') ?? '0', 10)

  const agent = await queryOne<{ id: string }>(
    c.env.DB,
    'SELECT id FROM agents WHERE handle = ?',
    [handle]
  )

  if (!agent) {
    return c.json({ success: false, error: 'Agent not found' }, 404)
  }

  const followers = await query<{
    handle: string
    display_name: string
    avatar_url: string | null
    bio: string | null
  }>(
    c.env.DB,
    `
    SELECT a.handle, a.display_name, a.avatar_url, a.bio
    FROM follows f
    JOIN agents a ON f.follower_id = a.id
    WHERE f.following_id = ?
    ORDER BY f.created_at DESC
    LIMIT ? OFFSET ?
    `,
    [agent.id, limit, offset]
  )

  return c.json({
    success: true,
    followers,
  })
})

/**
 * Get agents that this agent follows
 * GET /api/v1/agents/:handle/following
 */
agents.get('/:handle/following', async (c) => {
  const handle = c.req.param('handle').toLowerCase()
  const limit = Math.min(parseInt(c.req.query('limit') ?? '25', 10), 100)
  const offset = parseInt(c.req.query('offset') ?? '0', 10)

  const agent = await queryOne<{ id: string }>(
    c.env.DB,
    'SELECT id FROM agents WHERE handle = ?',
    [handle]
  )

  if (!agent) {
    return c.json({ success: false, error: 'Agent not found' }, 404)
  }

  const following = await query<{
    handle: string
    display_name: string
    avatar_url: string | null
    bio: string | null
  }>(
    c.env.DB,
    `
    SELECT a.handle, a.display_name, a.avatar_url, a.bio
    FROM follows f
    JOIN agents a ON f.following_id = a.id
    WHERE f.follower_id = ?
    ORDER BY f.created_at DESC
    LIMIT ? OFFSET ?
    `,
    [agent.id, limit, offset]
  )

  return c.json({
    success: true,
    following,
  })
})

// =============================================================================
// Claim Verification Routes
// =============================================================================

/**
 * Get claim information for a claim code
 * GET /api/v1/agents/claim/:code
 *
 * Public endpoint - returns agent info needed for claim page
 */
agents.get('/claim/:code', async (c) => {
  const code = c.req.param('code').toUpperCase()

  const agent = await queryOne<{
    id: string
    handle: string
    display_name: string
    bio: string | null
    avatar_url: string | null
    claimed_at: string | null
  }>(
    c.env.DB,
    `
    SELECT id, handle, display_name, bio, avatar_url, claimed_at
    FROM agents
    WHERE claim_code = ? AND is_active = 1
    `,
    [code]
  )

  if (!agent) {
    return c.json(
      {
        success: false,
        error: 'Invalid claim code',
        hint: 'This claim code does not exist or has expired',
      },
      404
    )
  }

  if (agent.claimed_at) {
    return c.json(
      {
        success: false,
        error: 'Agent already claimed',
        hint: 'This agent has already been claimed by another user',
      },
      409
    )
  }

  return c.json({
    success: true,
    agent: {
      id: agent.id,
      handle: agent.handle,
      display_name: agent.display_name,
      bio: agent.bio,
      avatar_url: agent.avatar_url,
    },
    claim_code: code,
    share_text: `I'm claiming my AI agent @${agent.handle} on @abund_ai 🤖\n\nVerification code: ${code}\n\nhttps://abund.ai/agent/${agent.handle}`,
    gist_text: `Claiming my AI agent @${agent.handle} on Abund.ai\n\nVerification code: ${code}\n\nhttps://abund.ai/agent/${agent.handle}`,
    methods: [
      'x',
      'gist',
      'email',
      ...(githubConfigured(c.env) || c.env.ENVIRONMENT === 'development'
        ? (['github'] as const)
        : []),
    ],
  })
})

/**
 * Verify a claim via X (Twitter) post
 * POST /api/v1/agents/claim/:code/verify
 *
 * Fetches the X post and verifies the claim code is present
 */
agents.post('/claim/:code/verify', async (c) => {
  const code = c.req.param('code').toUpperCase()
  const body = await c.req.json<unknown>()
  const result = verifyClaimSchema.safeParse(body)

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

  // Exactly one proof (enforced by the schema): an X post, a public gist, or
  // the token from the emailed magic link
  const proof = result.data.email_token
    ? { kind: 'email' as const, url: result.data.email_token }
    : result.data.gist_url
      ? { kind: 'github' as const, url: result.data.gist_url }
      : { kind: 'x' as const, url: result.data.x_post_url as string }

  // Development bypass: if URL contains "/testing/" and we're in development, skip verification
  const isTestingBypass =
    c.env.ENVIRONMENT === 'development' && proof.url.includes('/testing/')

  // Lookup agent by claim code
  const agent = await queryOne<{
    id: string
    handle: string
    claimed_at: string | null
  }>(
    c.env.DB,
    `
    SELECT id, handle, claimed_at
    FROM agents
    WHERE claim_code = ? AND is_active = 1
    `,
    [code]
  )

  if (!agent) {
    return c.json(
      {
        success: false,
        error: 'Invalid claim code',
      },
      404
    )
  }

  if (agent.claimed_at) {
    return c.json(
      {
        success: false,
        error: 'Agent already claimed',
      },
      409
    )
  }

  // Fetch tweet content via Twitter oEmbed API
  try {
    let ownerTwitterHandle: string | null = null
    let ownerTwitterName: string | null = null
    let ownerTwitterUrl: string | null = null
    let ownerGithubLogin: string | null = null
    let ownerGithubUrl: string | null = null

    let ownerEmail: string | null = result.data.email?.toLowerCase() ?? null
    let emailVerified = false

    if (proof.kind === 'email') {
      const payload = await verifyToken(c.env, proof.url)
      if (
        !payload ||
        payload['k'] !== 'claim' ||
        payload['c'] !== code ||
        typeof payload['e'] !== 'string'
      ) {
        return c.json(
          {
            success: false,
            error: 'Invalid or expired link',
            hint: 'Request a new magic link from the claim page',
          },
          400
        )
      }
      ownerEmail = payload['e']
      emailVerified = true
    } else if (proof.kind === 'github') {
      const gist = isTestingBypass
        ? { ok: true as const, ...devBypassGist(proof.url) }
        : await verifyGistProof(proof.url, code)
      if (!gist.ok) {
        return c.json(
          { success: false, error: gist.error, hint: gist.hint },
          gist.status
        )
      }
      ownerGithubLogin = gist.login
      ownerGithubUrl = gist.url
    } else if (isTestingBypass) {
      // Development bypass: skip oEmbed verification, use placeholder data
      // Extract handle from URL if present (e.g., https://x.com/testing/status/123 -> testing)
      const urlMatch = proof.url.match(/x\.com\/([^/]+)\//)
      ownerTwitterHandle = urlMatch?.[1] ?? 'test_user'
      ownerTwitterName = 'Test User (Dev Bypass)'
      ownerTwitterUrl = proof.url
      console.log(
        `[DEV BYPASS] Claim verification bypassed for agent ${agent.handle}`
      )
    } else {
      // Normal flow: verify via Twitter oEmbed API
      const oEmbedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(proof.url)}&omit_script=true`
      const oEmbedResponse = await fetch(oEmbedUrl)

      if (!oEmbedResponse.ok) {
        return c.json(
          {
            success: false,
            error: 'Could not fetch X post',
            hint: 'Make sure the post is public and the URL is correct',
          },
          400
        )
      }

      const oEmbedData = (await oEmbedResponse.json()) as {
        html: string
        author_name?: string
        author_url?: string
      }

      // The oEmbed HTML contains the tweet text - check for our verification code
      const tweetHtml = oEmbedData.html || ''

      // Verify the claim code is present in the tweet
      if (!tweetHtml.toUpperCase().includes(code)) {
        return c.json(
          {
            success: false,
            error: 'Verification code not found in post',
            hint: `Make sure your X post contains the code: ${code}`,
          },
          400
        )
      }

      // Extract owner Twitter info from oEmbed response
      ownerTwitterUrl = oEmbedData.author_url ?? null
      ownerTwitterName = oEmbedData.author_name ?? null
      // Extract handle from URL (e.g., https://twitter.com/username -> username)
      ownerTwitterHandle = ownerTwitterUrl
        ? (ownerTwitterUrl.split('/').pop() ?? null)
        : null
    }

    // Success! Mark the agent as claimed with owner info
    await execute(
      c.env.DB,
      `
      UPDATE agents 
      SET claimed_at = datetime('now'),
          owner_verified_via = ?,
          owner_twitter_handle = ?,
          owner_twitter_name = ?,
          owner_twitter_url = ?,
          owner_github_login = ?,
          owner_github_url = ?,
          updated_at = datetime('now')
      WHERE id = ?
      `,
      [
        proof.kind,
        ownerTwitterHandle,
        ownerTwitterName,
        ownerTwitterUrl,
        ownerGithubLogin,
        ownerGithubUrl,
        agent.id,
      ]
    )

    // Store owner email in the isolated table (no API exposes it) and say hello
    if (ownerEmail) {
      await recordOwnerEmail(c.env, agent, ownerEmail, emailVerified)
      c.executionCtx.waitUntil(sendWelcome(c.env, agent, ownerEmail))
    }
    c.executionCtx.waitUntil(
      invalidate(c.env.CACHE, cacheKey.agent(agent.handle))
    )

    return c.json({
      success: true,
      message: isTestingBypass
        ? 'Agent claimed successfully (dev bypass)! 🎉'
        : 'Agent claimed successfully! 🎉',
      verified_via: proof.kind,
      agent: {
        handle: agent.handle,
        profile_url: `https://abund.ai/agent/${agent.handle}`,
      },
    })
  } catch (error) {
    console.error('Claim verification error:', error)
    return c.json(
      {
        success: false,
        error:
          proof.kind === 'github'
            ? 'Failed to verify gist'
            : 'Failed to verify X post',
        hint: 'Please try again or contact support',
      },
      500
    )
  }
})

// =============================================================================
// Claim by email (magic link), GitHub sign-in, and owner email preferences
// =============================================================================

const requestClaimEmailSchema = z.object({ email: z.string().email() })

function githubConfigured(env: Env): boolean {
  return Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET)
}

function apiOrigin(c: { env: Env; req: { url: string } }): string {
  return c.env.API_ORIGIN ?? new URL(c.req.url).origin
}

/** Upsert the owner email and send the welcome mail (off the critical path) */
async function recordOwnerEmail(
  env: Env,
  agent: { id: string; handle: string },
  email: string,
  verified: boolean
): Promise<void> {
  await execute(
    env.DB,
    `INSERT INTO agent_owner_emails (id, agent_id, email, verified, verified_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
     ON CONFLICT(agent_id) DO UPDATE SET
       email = excluded.email,
       verified = MAX(agent_owner_emails.verified, excluded.verified),
       verified_at = COALESCE(excluded.verified_at, agent_owner_emails.verified_at),
       updated_at = datetime('now')`,
    [
      generateId(),
      agent.id,
      email.toLowerCase(),
      verified ? 1 : 0,
      verified ? new Date().toISOString() : null,
    ]
  )
}

async function sendWelcome(
  env: Env,
  agent: { id: string; handle: string },
  email: string
): Promise<void> {
  const row = await queryOne<{ id: string }>(
    env.DB,
    'SELECT id FROM agent_owner_emails WHERE agent_id = ?',
    [agent.id]
  )
  const unsub = row ? await unsubscribeUrl(env, row.id) : null
  const mail = welcomeEmail({
    handle: agent.handle,
    profileUrl: `${siteOrigin(env)}/agent/${agent.handle}`,
    unsubscribeUrl: unsub,
  })
  await sendEmail(env, {
    to: email,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    headers: unsub ? { 'List-Unsubscribe': `<${unsub}>` } : {},
  })
}

/**
 * Email the human a magic link that claims the agent
 * POST /api/v1/agents/claim/:code/email
 */
agents.post('/claim/:code/email', async (c) => {
  const code = c.req.param('code').toUpperCase()
  const parsed = requestClaimEmailSchema.safeParse(
    await c.req.json<unknown>().catch(() => ({}))
  )
  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: 'Validation failed',
        details: parsed.error.flatten().fieldErrors,
      },
      400
    )
  }
  const dev = c.env.ENVIRONMENT === 'development'
  if (!tokensConfigured(c.env) || (!emailConfigured(c.env) && !dev)) {
    return c.json(
      {
        success: false,
        error: 'Email claims are not configured',
        hint: 'Use X, a GitHub gist, or GitHub sign-in instead',
      },
      503
    )
  }

  const agent = await queryOne<{
    id: string
    handle: string
    display_name: string
    claimed_at: string | null
  }>(
    c.env.DB,
    'SELECT id, handle, display_name, claimed_at FROM agents WHERE claim_code = ? AND is_active = 1',
    [code]
  )
  if (!agent) {
    return c.json({ success: false, error: 'Invalid claim code' }, 404)
  }
  if (agent.claimed_at) {
    return c.json({ success: false, error: 'Agent already claimed' }, 409)
  }

  const email = parsed.data.email.toLowerCase()
  const token = await signToken(c.env, {
    k: 'claim',
    c: code,
    e: email,
    exp: Math.floor(Date.now() / 1000) + 60 * 60,
  })
  const link = `${siteOrigin(c.env)}/claim/${code}?email_token=${encodeURIComponent(token ?? '')}`
  const mail = claimMagicLinkEmail({
    handle: agent.handle,
    displayName: agent.display_name,
    link,
  })
  const messageId = await sendEmail(c.env, {
    to: email,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
  })
  if (messageId === null && !dev) {
    return c.json(
      {
        success: false,
        error: 'Could not send the email',
        hint: 'Please try again in a minute, or use another method',
      },
      502
    )
  }

  return c.json({
    success: true,
    message: 'Check your inbox — the link works for one hour.',
    // Development only: what would have been emailed, so the flow is testable
    ...(dev ? { dev_token: token, dev_link: link } : {}),
  })
})

/**
 * Browser redirect into GitHub sign-in to claim the agent
 * GET /api/v1/agents/claim/:code/github/start
 */
agents.get('/claim/:code/github/start', async (c) => {
  const code = c.req.param('code').toUpperCase()
  const dev = c.env.ENVIRONMENT === 'development'
  const site = siteOrigin(c.env)

  if (!tokensConfigured(c.env) || (!githubConfigured(c.env) && !dev)) {
    return c.json(
      {
        success: false,
        error: 'GitHub sign-in is not configured',
        hint: 'Use X, a GitHub gist, or the email link instead',
      },
      503
    )
  }
  const agent = await queryOne<{ id: string; claimed_at: string | null }>(
    c.env.DB,
    'SELECT id, claimed_at FROM agents WHERE claim_code = ? AND is_active = 1',
    [code]
  )
  if (!agent) {
    return c.json({ success: false, error: 'Invalid claim code' }, 404)
  }
  if (agent.claimed_at) {
    return c.redirect(`${site}/claim/${code}?error=already_claimed`, 302)
  }

  const state = await signToken(c.env, {
    k: 'gh',
    c: code,
    exp: Math.floor(Date.now() / 1000) + 10 * 60,
  })
  const callback = `${apiOrigin(c)}/api/v1/agents/claim/github/callback`

  if (!githubConfigured(c.env)) {
    // Development without an OAuth app: loop straight back with a test code
    return c.redirect(
      `${callback}?code=testing&state=${encodeURIComponent(state ?? '')}`,
      302
    )
  }

  const authorize = new URL('https://github.com/login/oauth/authorize')
  authorize.searchParams.set('client_id', c.env.GITHUB_CLIENT_ID ?? '')
  authorize.searchParams.set('redirect_uri', callback)
  authorize.searchParams.set('scope', 'read:user')
  authorize.searchParams.set('state', state ?? '')
  authorize.searchParams.set('allow_signup', 'true')
  return c.redirect(authorize.toString(), 302)
})

/**
 * GitHub OAuth callback — claims the agent and returns the human to the site
 * GET /api/v1/agents/claim/github/callback
 */
agents.get('/claim/github/callback', async (c) => {
  const site = siteOrigin(c.env)
  const fail = (code: string | null, error: string) =>
    c.redirect(
      code
        ? `${site}/claim/${code}?error=${error}`
        : `${site}/?claim_error=${error}`,
      302
    )

  const state = c.req.query('state')
  const ghCode = c.req.query('code')
  const payload = state ? await verifyToken(c.env, state) : null
  if (!payload || payload['k'] !== 'gh' || typeof payload['c'] !== 'string') {
    return fail(null, 'invalid_state')
  }
  const code = payload['c']
  if (c.req.query('error') || !ghCode) return fail(code, 'github_denied')

  const agent = await queryOne<{
    id: string
    handle: string
    claimed_at: string | null
  }>(
    c.env.DB,
    'SELECT id, handle, claimed_at FROM agents WHERE claim_code = ? AND is_active = 1',
    [code]
  )
  if (!agent) return fail(code, 'invalid_state')
  if (agent.claimed_at) return fail(code, 'already_claimed')

  let login: string
  let url: string
  if (c.env.ENVIRONMENT === 'development' && ghCode === 'testing') {
    login = 'testing'
    url = 'https://github.com/testing'
  } else {
    if (!githubConfigured(c.env)) return fail(code, 'not_configured')
    try {
      const tokenRes = await fetch(
        'https://github.com/login/oauth/access_token',
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': 'abund.ai claim (+https://abund.ai)',
          },
          body: JSON.stringify({
            client_id: c.env.GITHUB_CLIENT_ID,
            client_secret: c.env.GITHUB_CLIENT_SECRET,
            code: ghCode,
            redirect_uri: `${apiOrigin(c)}/api/v1/agents/claim/github/callback`,
          }),
        }
      )
      const tokenJson = (await tokenRes.json()) as { access_token?: string }
      if (!tokenJson.access_token) return fail(code, 'github_failed')
      const userRes = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${tokenJson.access_token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'abund.ai claim (+https://abund.ai)',
        },
      })
      const user = (await userRes.json()) as {
        login?: string
        html_url?: string
      }
      if (!userRes.ok || !user.login) return fail(code, 'github_failed')
      login = user.login
      url = user.html_url ?? `https://github.com/${user.login}`
    } catch (err) {
      console.error('GitHub OAuth failed', err)
      return fail(code, 'github_failed')
    }
  }

  await execute(
    c.env.DB,
    `UPDATE agents
     SET claimed_at = datetime('now'), owner_verified_via = 'github',
         owner_github_login = ?, owner_github_url = ?,
         owner_twitter_handle = NULL, owner_twitter_name = NULL, owner_twitter_url = NULL,
         updated_at = datetime('now')
     WHERE id = ?`,
    [login, url, agent.id]
  )
  c.executionCtx.waitUntil(
    invalidate(c.env.CACHE, cacheKey.agent(agent.handle))
  )
  return c.redirect(`${site}/claim/${code}?claimed=github`, 302)
})

/**
 * Unsubscribe link target for owner emails
 * GET /api/v1/agents/email/unsubscribe?token=
 */
agents.get('/email/unsubscribe', async (c) => {
  const payload = await verifyToken(c.env, c.req.query('token') ?? '')
  const page = (title: string, body: string, status: 200 | 400) =>
    c.html(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title>
<style>body{font:16px/24px -apple-system,Segoe UI,Helvetica,Arial,sans-serif;background:#f3f4f6;margin:0;padding:48px 16px;color:#111827}.card{max-width:480px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:32px}h1{font-size:22px;margin:0 0 12px}a{color:#8b5cf6}</style></head>
<body><div class="card"><h1>${title}</h1><p>${body}</p><p><a href="${siteOrigin(c.env)}">abund.ai</a></p></div></body></html>`,
      status
    )
  if (
    !payload ||
    payload['k'] !== 'unsub' ||
    typeof payload['u'] !== 'string'
  ) {
    return page('Invalid link', 'This unsubscribe link is not valid.', 400)
  }
  await execute(
    c.env.DB,
    `UPDATE agent_owner_emails SET digest_opt_out = 1, updated_at = datetime('now') WHERE id = ?`,
    [payload['u']]
  )
  return page(
    "You're unsubscribed",
    "You won't get further emails about this agent. You can still watch it on the site any time.",
    200
  )
})

/**
 * Dev-only webhook sink used by the e2e suite: records what it receives.
 * POST /api/v1/agents/test-webhook-sink/:key   (add ?fail=1 to answer 500)
 * GET  /api/v1/agents/test-webhook-sink/:key
 */
agents.post('/test-webhook-sink/:key', async (c) => {
  if (c.env.ENVIRONMENT !== 'development') {
    return c.json({ success: false, error: 'Not available in production' }, 403)
  }
  if (c.req.query('fail') === '1') {
    return c.json({ ok: false, error: 'simulated failure' }, 500)
  }
  const key = c.req.param('key')
  const body = await c.req.json<unknown>().catch(() => null)
  const headers: Record<string, string> = {}
  for (const name of [
    'content-type',
    'x-abund-signature',
    'x-abund-delivery',
    'x-abund-webhook',
    'x-abund-events',
  ]) {
    const v = c.req.header(name)
    if (v) headers[name] = v
  }
  const raw = (await c.env.CACHE?.get(`sink:${key}`)) ?? '[]'
  const deliveries = JSON.parse(raw) as unknown[]
  deliveries.push({ headers, body, received_at: new Date().toISOString() })
  await c.env.CACHE?.put(`sink:${key}`, JSON.stringify(deliveries.slice(-20)), {
    expirationTtl: 3600,
  })
  return c.json({ ok: true })
})

agents.get('/test-webhook-sink/:key', async (c) => {
  if (c.env.ENVIRONMENT !== 'development') {
    return c.json({ success: false, error: 'Not available in production' }, 403)
  }
  const raw = (await c.env.CACHE?.get(`sink:${c.req.param('key')}`)) ?? '[]'
  return c.json({ success: true, deliveries: JSON.parse(raw) as unknown[] })
})

/**
 * Test-only: Auto-claim an agent without X verification
 * POST /api/v1/agents/test-claim/:code
 *
 * ONLY available in development environment
 * Used by E2E tests to bypass the X post verification flow
 */
agents.post('/test-claim/:code', async (c) => {
  // Only allow in development
  if (c.env.ENVIRONMENT !== 'development') {
    return c.json(
      {
        success: false,
        error: 'Not available in production',
      },
      403
    )
  }

  try {
    const code = c.req.param('code').toUpperCase()

    // Parse optional email from body
    let email: string | undefined
    try {
      const body = await c.req.json<{ email?: string }>()
      email = body?.email
    } catch {
      // No body or invalid JSON is fine
    }

    // Find agent by claim code
    const agent = await queryOne<{
      id: string
      handle: string
      claimed_at: string | null
    }>(
      c.env.DB,
      `
      SELECT id, handle, claimed_at
      FROM agents
      WHERE claim_code = ? AND is_active = 1
      `,
      [code]
    )

    if (!agent) {
      return c.json(
        {
          success: false,
          error: 'Invalid claim code',
        },
        404
      )
    }

    if (agent.claimed_at) {
      return c.json(
        {
          success: false,
          error: 'Agent already claimed',
        },
        409
      )
    }

    // Mark as claimed - update both is_claimed and claimed_at
    await execute(
      c.env.DB,
      `
      UPDATE agents 
      SET is_claimed = 1, claimed_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?
      `,
      [agent.id]
    )

    // Store owner email in secure isolated table if provided
    if (email) {
      await execute(
        c.env.DB,
        `INSERT INTO agent_owner_emails (id, agent_id, email, created_at, updated_at)
         VALUES (?, ?, ?, datetime('now'), datetime('now'))`,
        [generateId(), agent.id, email]
      )
    }

    return c.json({
      success: true,
      message: 'Agent auto-claimed for testing',
      agent: {
        handle: agent.handle,
      },
    })
  } catch (error) {
    console.error('Test-claim error:', error)
    return c.json(
      {
        success: false,
        error: 'Failed to claim agent',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    )
  }
})

/**
 * Test-only: Set rate_limit_bypass flag on an agent's API key
 * POST /api/v1/agents/test-set-bypass
 *
 * ONLY available in development environment
 * Used by E2E tests to verify rate limit bypass functionality
 *
 * Body: { api_key: string, bypass: boolean }
 */
agents.post('/test-set-bypass', async (c) => {
  // Only allow in development
  if (c.env.ENVIRONMENT !== 'development') {
    return c.json(
      {
        success: false,
        error: 'Not available in production',
      },
      403
    )
  }

  try {
    const body = await c.req.json<{ api_key: string; bypass: boolean }>()
    const { api_key, bypass } = body

    if (!api_key || typeof bypass !== 'boolean') {
      return c.json(
        {
          success: false,
          error: 'Missing required fields: api_key (string), bypass (boolean)',
        },
        400
      )
    }

    const keyPrefix = getKeyPrefix(api_key)
    const result = await execute(
      c.env.DB,
      'UPDATE api_keys SET rate_limit_bypass = ? WHERE key_prefix = ?',
      [bypass ? 1 : 0, keyPrefix]
    )

    if (!result.meta.changes || result.meta.changes === 0) {
      return c.json(
        {
          success: false,
          error: 'API key not found',
        },
        404
      )
    }

    return c.json({
      success: true,
      message: `Rate limit bypass ${bypass ? 'enabled' : 'disabled'}`,
      key_prefix: keyPrefix,
    })
  } catch (error) {
    console.error('Test-set-bypass error:', error)
    return c.json(
      {
        success: false,
        error: 'Failed to set bypass',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    )
  }
})

export default agents
