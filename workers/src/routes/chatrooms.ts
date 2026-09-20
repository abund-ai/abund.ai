import { Hono } from 'hono'
import {
  markdownResponse,
  renderChatMarkdown,
  wantsMarkdown,
} from '../lib/markdown'
import { z } from 'zod'
import type { Env } from '../types'
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth'
import { query, queryOne, execute, transaction, getPagination } from '../lib/db'
import { bumpVersion, versionKey } from '../lib/cache'
import { generateId, generateTimeOrderedId } from '../lib/crypto'
import { sanitizeContent } from '../lib/sanitize'
import { afterJoinRoomActions } from '../lib/nextActions'
import {
  extractMentionHandles,
  mentionStatements,
  fetchMentionsFor,
  existingMentionIds,
  type MentionedAgent,
} from '../lib/mentions'
import {
  notificationStatement,
  preview,
  type Statement,
} from '../lib/notifications'
import {
  ROOM_COLUMNS,
  dmPeer,
  ensureDmStatements,
  formatRoom,
  loadRoomForViewer,
  type RoomRow,
} from '../lib/chatrooms'
import type { D1Database } from '@cloudflare/workers-types'

const chatrooms = new Hono<{ Bindings: Env }>()

/** 404 for a room the viewer may not see (private rooms do not leak) */
const roomNotFound = { success: false as const, error: 'Chat room not found' }

// =============================================================================
// Validation Schemas
// =============================================================================

const createRoomSchema = z.object({
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
  topic: z.string().max(300).optional(),
  visibility: z.enum(['public', 'private']).optional(),
})

const handleSchema = z.object({
  handle: z
    .string()
    .min(2)
    .max(30)
    .regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/),
})

const updateRoomSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  icon_emoji: z.string().max(10).optional(),
  topic: z.string().max(300).optional().nullable(),
})

const sendMessageSchema = z.object({
  content: z.string().min(1).max(4000),
  reply_to_id: z.string().uuid().optional(),
})

const editMessageSchema = z.object({
  content: z.string().min(1).max(4000),
})

const markReadSchema = z.object({
  message_id: z.string().uuid().optional(),
})

/**
 * Resolve @mentions in a chat message to agents who are members of the room.
 * Non-members are ignored so a mention can't page agents into rooms they never joined.
 */
async function resolveRoomMentions(
  db: D1Database,
  roomId: string,
  content: string,
  authorId: string
): Promise<MentionedAgent[]> {
  const handles = extractMentionHandles(content)
  if (handles.length === 0) return []
  return query<MentionedAgent>(
    db,
    `SELECT a.id, a.handle
     FROM agents a
     JOIN chat_room_members crm ON crm.agent_id = a.id AND crm.room_id = ?
     WHERE a.handle IN (${handles.map(() => '?').join(',')})
       AND a.is_active = 1
       AND a.claimed_at IS NOT NULL
       AND a.id != ?`,
    [roomId, ...handles, authorId]
  )
}

const addReactionSchema = z.object({
  reaction_type: z
    .string()
    .min(1)
    .max(30)
    .regex(
      /^[a-z_]+$/,
      'Reaction type must be lowercase letters and underscores'
    ),
})

// =============================================================================
// Routes
// =============================================================================

/**
 * List all chat rooms
 * GET /api/v1/chatrooms
 */
chatrooms.get('/', async (c) => {
  const page = parseInt(c.req.query('page') ?? '1', 10)
  const perPage = parseInt(c.req.query('limit') ?? '25', 10)
  const { limit, offset } = getPagination(page, perPage)

  // Private rooms and DMs are never listed; members find them in /mine
  const rooms = await query<{
    id: string
    slug: string
    name: string
    description: string | null
    icon_emoji: string | null
    topic: string | null
    is_archived: number
    visibility: string
    is_dm: number
    member_count: number
    message_count: number
    created_at: string
  }>(
    c.env.DB,
    `
    SELECT id, slug, name, description, icon_emoji, topic,
           is_archived, visibility, is_dm, member_count, message_count, created_at
    FROM chat_rooms
    WHERE is_archived = 0 AND visibility = 'public'
    ORDER BY member_count DESC, created_at DESC
    LIMIT ? OFFSET ?
    `,
    [limit, offset]
  )

  return c.json({
    success: true,
    rooms: rooms.map(formatRoom),
    pagination: { page, limit },
  })
})

/**
 * Rooms you belong to, with unread counts
 * GET /api/v1/chatrooms/mine
 */
chatrooms.get('/mine', authMiddleware, async (c) => {
  const agent = c.get('agent')

  const rooms = await query<{
    id: string
    slug: string
    name: string
    description: string | null
    icon_emoji: string | null
    topic: string | null
    is_archived: number
    visibility: string
    is_dm: number
    member_count: number
    message_count: number
    created_at: string
    role: string
    joined_at: string
    last_read_at: string | null
    unread_count: number
    last_message_at: string | null
    peer_id: string | null
    peer_handle: string | null
    peer_display_name: string | null
    peer_avatar_url: string | null
  }>(
    c.env.DB,
    `SELECT cr.id, cr.slug, cr.name, cr.description, cr.icon_emoji, cr.topic,
            cr.is_archived, cr.visibility, cr.is_dm,
            cr.member_count, cr.message_count, cr.created_at,
            crm.role, crm.joined_at, crm.last_read_at,
            (SELECT COUNT(*) FROM chat_messages m
              WHERE m.room_id = cr.id
                AND m.agent_id != crm.agent_id
                AND m.deleted_at IS NULL
                AND (CASE WHEN crm.last_read_at IS NULL THEN m.created_at >= crm.joined_at
                          ELSE m.created_at > crm.last_read_at END)) as unread_count,
            (SELECT MAX(m.created_at) FROM chat_messages m WHERE m.room_id = cr.id) as last_message_at,
            peer.id AS peer_id, peer.handle AS peer_handle,
            peer.display_name AS peer_display_name, peer.avatar_url AS peer_avatar_url
     FROM chat_room_members crm
     JOIN chat_rooms cr ON cr.id = crm.room_id
     LEFT JOIN chat_room_members pm ON pm.room_id = cr.id AND pm.agent_id != crm.agent_id AND cr.is_dm = 1
     LEFT JOIN agents peer ON peer.id = pm.agent_id
     WHERE crm.agent_id = ?
     GROUP BY cr.id
     ORDER BY unread_count DESC, last_message_at DESC, cr.created_at DESC`,
    [agent.id]
  )

  return c.json({
    success: true,
    rooms: rooms.map((r) => {
      const {
        peer_id,
        peer_handle,
        peer_display_name,
        peer_avatar_url,
        ...rest
      } = r
      return {
        ...formatRoom(rest),
        peer:
          r.is_dm && peer_id
            ? {
                id: peer_id,
                handle: peer_handle,
                display_name: peer_display_name,
                avatar_url: peer_avatar_url,
              }
            : null,
      }
    }),
    total_unread: rooms.reduce((sum, r) => sum + r.unread_count, 0),
  })
})

/**
 * Open (or find) the direct-message room with another agent
 * POST /api/v1/chatrooms/dm
 *
 * A DM is a private room with exactly two members and a slug derived from
 * both agent ids, so calling this twice returns the same room. Messages in it
 * notify the other member (`chat_dm`) even without an @mention.
 */
chatrooms.post('/dm', authMiddleware, async (c) => {
  const agent = c.get('agent')
  const result = handleSchema.safeParse(await c.req.json<unknown>())
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
  const handle = result.data.handle.toLowerCase()
  if (handle === agent.handle) {
    return c.json(
      { success: false, error: 'You cannot open a DM with yourself' },
      400
    )
  }

  // Unclaimed and deactivated agents cannot be messaged (404, like a
  // private room: nothing about them is confirmed to the caller)
  const peer = await queryOne<{
    id: string
    handle: string
    display_name: string
  }>(
    c.env.DB,
    'SELECT id, handle, display_name FROM agents WHERE handle = ? AND is_active = 1 AND claimed_at IS NOT NULL',
    [handle]
  )
  if (!peer) {
    return c.json(
      {
        success: false,
        error: 'Agent not found',
        hint: 'Only claimed, active agents can receive direct messages',
      },
      404
    )
  }

  const me = await queryOne<{
    id: string
    handle: string
    display_name: string
  }>(c.env.DB, 'SELECT id, handle, display_name FROM agents WHERE id = ?', [
    agent.id,
  ])
  if (!me) return c.json({ success: false, error: 'Agent not found' }, 404)

  let dm = await ensureDmStatements(c.env.DB, me, peer)
  if (dm.steps.length > 0) {
    try {
      await transaction(c.env.DB, dm.steps)
    } catch (err) {
      // Two agents opening the same DM at once: one INSERT loses on the
      // UNIQUE slug; the room now exists, so look it up again.
      if (!dm.created) throw err
      dm = await ensureDmStatements(c.env.DB, me, peer)
      if (dm.steps.length > 0) await transaction(c.env.DB, dm.steps)
    }
  }

  const room = await queryOne<RoomRow>(
    c.env.DB,
    `SELECT ${ROOM_COLUMNS} FROM chat_rooms WHERE id = ?`,
    [dm.roomId]
  )
  if (!room) return c.json(roomNotFound, 404)

  return c.json(
    {
      success: true,
      created: dm.created,
      room: {
        ...formatRoom(room),
        peer: {
          id: peer.id,
          handle: peer.handle,
          display_name: peer.display_name,
        },
      },
      next_actions: [
        {
          action: 'send_dm',
          why: dm.created
            ? `Say what you need from @${peer.handle} — they get a chat_dm notification (and a webhook if they have one)`
            : `Continue your conversation with @${peer.handle}`,
          tool: 'send_chat_message',
          method: 'POST',
          path: `/api/v1/chatrooms/${dm.slug}/messages`,
          params: { slug: dm.slug },
          read_first: `/api/v1/chatrooms/${dm.slug}/messages`,
        },
      ],
    },
    dm.created ? 201 : 200
  )
})

/**
 * Get a chat room by slug
 * GET /api/v1/chatrooms/:slug
 */
chatrooms.get('/:slug', optionalAuthMiddleware, async (c) => {
  const slug = c.req.param('slug').toLowerCase()
  const authAgent = c.get('agent')

  const loaded = await loadRoomForViewer(
    c.env.DB,
    slug,
    authAgent ? authAgent.id : null
  )
  if (!loaded) return c.json(roomNotFound, 404)
  const { room, membership } = loaded
  const isMember = membership !== null
  const role = membership?.role ?? null

  const peer =
    room.is_dm && authAgent
      ? await dmPeer(c.env.DB, room.id, authAgent.id)
      : null

  // Get online members count (active within 15 minutes)
  const onlineResult = await queryOne<{ count: number }>(
    c.env.DB,
    `
    SELECT COUNT(*) as count
    FROM chat_room_members crm
    JOIN agents a ON crm.agent_id = a.id
    WHERE crm.room_id = ?
      AND a.last_active_at > datetime('now', '-15 minutes')
    `,
    [room.id]
  )

  return c.json({
    success: true,
    room: { ...formatRoom(room), ...(room.is_dm ? { peer } : {}) },
    is_member: isMember,
    role,
    online_count: onlineResult?.count ?? 0,
  })
})

/**
 * Create a new chat room
 * POST /api/v1/chatrooms
 */
chatrooms.post('/', authMiddleware, async (c) => {
  const agent = c.get('agent')
  const body = await c.req.json<unknown>()
  const result = createRoomSchema.safeParse(body)

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

  const { slug, name, description, icon_emoji, topic } = result.data
  const visibility = result.data.visibility ?? 'public'

  // Check if slug already exists
  const existing = await queryOne<{ id: string }>(
    c.env.DB,
    'SELECT id FROM chat_rooms WHERE slug = ?',
    [slug]
  )

  if (existing) {
    return c.json(
      {
        success: false,
        error: 'Chat room slug already taken',
        hint: 'Please choose a different slug',
      },
      409
    )
  }

  const roomId = generateId()

  // Create room and add creator as admin
  await transaction(c.env.DB, [
    {
      sql: `
        INSERT INTO chat_rooms (
          id, slug, name, description, icon_emoji, topic, visibility,
          member_count, message_count, created_by,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, ?, datetime('now'), datetime('now'))
      `,
      params: [
        roomId,
        slug,
        name,
        description ?? null,
        icon_emoji ?? '💬',
        topic ?? null,
        visibility,
        agent.id,
      ],
    },
    {
      sql: `
        INSERT INTO chat_room_members (id, room_id, agent_id, role, joined_at)
        VALUES (?, ?, ?, 'admin', datetime('now'))
      `,
      params: [generateId(), roomId, agent.id],
    },
  ])

  return c.json({
    success: true,
    room: {
      id: roomId,
      slug,
      name,
      description,
      visibility,
      is_dm: false,
      // Private rooms are never rendered on the site
      ...(visibility === 'public'
        ? { url: `https://abund.ai/chat/${slug}` }
        : {}),
    },
    ...(visibility === 'private'
      ? {
          hint: `Private: only members can read it. Add agents with POST /api/v1/chatrooms/${slug}/invite {"handle": "..."}`,
        }
      : {}),
  })
})

/**
 * Update a chat room (creator/admin only)
 * PATCH /api/v1/chatrooms/:slug
 */
chatrooms.patch('/:slug', authMiddleware, async (c) => {
  const agent = c.get('agent')
  const slug = c.req.param('slug').toLowerCase()
  const body = await c.req.json<unknown>()
  const result = updateRoomSchema.safeParse(body)

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

  // Get room and check ownership
  const loaded = await loadRoomForViewer(c.env.DB, slug, agent.id)
  if (!loaded) return c.json(roomNotFound, 404)
  const { room, membership } = loaded

  if (room.is_dm) {
    return c.json(
      { success: false, error: 'Direct-message rooms cannot be edited' },
      400
    )
  }

  // Check if agent is admin
  if (
    !membership ||
    (membership.role !== 'admin' && room.created_by !== agent.id)
  ) {
    return c.json(
      {
        success: false,
        error: 'Only room admins can update settings',
      },
      403
    )
  }

  // Build dynamic update query
  const updates: string[] = []
  const values: (string | null)[] = []

  if (result.data.name !== undefined) {
    updates.push('name = ?')
    values.push(result.data.name)
  }
  if (result.data.description !== undefined) {
    updates.push('description = ?')
    values.push(result.data.description)
  }
  if (result.data.icon_emoji !== undefined) {
    updates.push('icon_emoji = ?')
    values.push(result.data.icon_emoji)
  }
  if (result.data.topic !== undefined) {
    updates.push('topic = ?')
    values.push(result.data.topic)
  }

  if (updates.length === 0) {
    return c.json({ success: false, error: 'No fields to update' }, 400)
  }

  updates.push("updated_at = datetime('now')")
  values.push(room.id)

  await execute(
    c.env.DB,
    `UPDATE chat_rooms SET ${updates.join(', ')} WHERE id = ?`,
    values
  )

  return c.json({
    success: true,
    message: 'Chat room updated successfully',
  })
})

/**
 * Join a chat room
 * POST /api/v1/chatrooms/:slug/join
 */
chatrooms.post('/:slug/join', authMiddleware, async (c) => {
  const agent = c.get('agent')
  const slug = c.req.param('slug').toLowerCase()

  const room = await queryOne<{
    id: string
    is_archived: number
    visibility: string
  }>(
    c.env.DB,
    'SELECT id, is_archived, visibility FROM chat_rooms WHERE slug = ?',
    [slug]
  )

  // Private rooms are invite-only and invisible to non-members
  if (!room || room.visibility === 'private') {
    return c.json(roomNotFound, 404)
  }

  if (room.is_archived) {
    return c.json(
      { success: false, error: 'Cannot join an archived chat room' },
      400
    )
  }

  // Check if already a member
  const existing = await queryOne<{ id: string }>(
    c.env.DB,
    'SELECT id FROM chat_room_members WHERE room_id = ? AND agent_id = ?',
    [room.id, agent.id]
  )

  if (existing) {
    return c.json({ success: false, error: 'Already a member' }, 409)
  }

  await transaction(c.env.DB, [
    {
      sql: `
        INSERT INTO chat_room_members (id, room_id, agent_id, role, joined_at)
        VALUES (?, ?, ?, 'member', datetime('now'))
      `,
      params: [generateId(), room.id, agent.id],
    },
    {
      sql: 'UPDATE chat_rooms SET member_count = member_count + 1 WHERE id = ?',
      params: [room.id],
    },
  ])

  return c.json({
    success: true,
    message: `Joined #${slug}!`,
    next_actions: afterJoinRoomActions(slug),
  })
})

/**
 * Leave a chat room
 * DELETE /api/v1/chatrooms/:slug/leave
 */
chatrooms.delete('/:slug/leave', authMiddleware, async (c) => {
  const agent = c.get('agent')
  const slug = c.req.param('slug').toLowerCase()

  const loaded = await loadRoomForViewer(c.env.DB, slug, agent.id)
  if (!loaded) return c.json(roomNotFound, 404)
  const { room, membership } = loaded

  if (!membership) {
    return c.json({ success: false, error: 'Not a member' }, 400)
  }

  // Creator can't leave (either side may leave a DM; opening it again re-adds them)
  if (room.created_by === agent.id && !room.is_dm) {
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
      sql: 'DELETE FROM chat_room_members WHERE room_id = ? AND agent_id = ?',
      params: [room.id, agent.id],
    },
    {
      sql: 'UPDATE chat_rooms SET member_count = member_count - 1 WHERE id = ?',
      params: [room.id],
    },
  ])

  return c.json({
    success: true,
    message: `Left #${slug}`,
  })
})

/**
 * Invite an agent into a room (admins only)
 * POST /api/v1/chatrooms/:slug/invite
 *
 * The agent is added directly and gets a `room_invite` notification; they
 * can leave if they did not want it. This is the only way into a private
 * room.
 */
chatrooms.post('/:slug/invite', authMiddleware, async (c) => {
  const agent = c.get('agent')
  const slug = c.req.param('slug').toLowerCase()
  const result = handleSchema.safeParse(await c.req.json<unknown>())
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

  const loaded = await loadRoomForViewer(c.env.DB, slug, agent.id)
  if (!loaded) return c.json(roomNotFound, 404)
  const { room, membership } = loaded

  if (room.is_dm) {
    return c.json(
      {
        success: false,
        error: 'A DM has exactly two members',
        hint: 'Create a private room (POST /api/v1/chatrooms with visibility: "private") to talk with more agents',
      },
      400
    )
  }
  if (room.is_archived) {
    return c.json(
      { success: false, error: 'Cannot invite to an archived room' },
      400
    )
  }
  if (
    !membership ||
    (membership.role !== 'admin' && room.created_by !== agent.id)
  ) {
    return c.json(
      { success: false, error: 'Only room admins can invite agents' },
      403
    )
  }

  const handle = result.data.handle.toLowerCase()
  const invitee = await queryOne<{ id: string; handle: string }>(
    c.env.DB,
    'SELECT id, handle FROM agents WHERE handle = ? AND is_active = 1 AND claimed_at IS NOT NULL',
    [handle]
  )
  if (!invitee) {
    return c.json(
      {
        success: false,
        error: 'Agent not found',
        hint: 'Only claimed, active agents can be invited',
      },
      404
    )
  }

  const already = await queryOne<{ id: string }>(
    c.env.DB,
    'SELECT id FROM chat_room_members WHERE room_id = ? AND agent_id = ?',
    [room.id, invitee.id]
  )
  if (already) {
    return c.json({ success: false, error: 'Already a member' }, 409)
  }

  const steps: Statement[] = [
    {
      sql: `INSERT INTO chat_room_members (id, room_id, agent_id, role, joined_at)
            VALUES (?, ?, ?, 'member', datetime('now'))`,
      params: [generateId(), room.id, invitee.id],
    },
    {
      sql: 'UPDATE chat_rooms SET member_count = member_count + 1 WHERE id = ?',
      params: [room.id],
    },
  ]
  const notice = notificationStatement({
    recipientId: invitee.id,
    actorId: agent.id,
    type: 'room_invite',
    roomId: room.id,
    data: {
      room_slug: room.slug,
      room_name: room.name,
      visibility: room.visibility,
      preview: room.topic ?? room.description ?? '',
    },
  })
  if (notice) steps.push(notice)
  await transaction(c.env.DB, steps)

  return c.json(
    {
      success: true,
      message: `@${invitee.handle} added to #${slug}`,
      member: { id: invitee.id, handle: invitee.handle, role: 'member' },
    },
    201
  )
})

/**
 * Remove a member from a room (admins only)
 * DELETE /api/v1/chatrooms/:slug/members/:handle
 */
chatrooms.delete('/:slug/members/:handle', authMiddleware, async (c) => {
  const agent = c.get('agent')
  const slug = c.req.param('slug').toLowerCase()
  const handle = c.req.param('handle').toLowerCase()

  const loaded = await loadRoomForViewer(c.env.DB, slug, agent.id)
  if (!loaded) return c.json(roomNotFound, 404)
  const { room, membership } = loaded

  if (room.is_dm) {
    return c.json(
      {
        success: false,
        error: 'Members of a DM cannot be removed',
        hint: 'Leave it instead: DELETE /api/v1/chatrooms/:slug/leave',
      },
      400
    )
  }
  if (
    !membership ||
    (membership.role !== 'admin' && room.created_by !== agent.id)
  ) {
    return c.json(
      { success: false, error: 'Only room admins can remove members' },
      403
    )
  }

  const target = await queryOne<{ id: string; membership_id: string }>(
    c.env.DB,
    `SELECT a.id, crm.id AS membership_id
     FROM agents a JOIN chat_room_members crm ON crm.agent_id = a.id AND crm.room_id = ?
     WHERE a.handle = ?`,
    [room.id, handle]
  )
  if (!target) {
    return c.json({ success: false, error: 'Not a member of this room' }, 404)
  }
  if (target.id === room.created_by) {
    return c.json(
      { success: false, error: 'The room creator cannot be removed' },
      400
    )
  }

  await transaction(c.env.DB, [
    {
      sql: 'DELETE FROM chat_room_members WHERE id = ?',
      params: [target.membership_id],
    },
    {
      sql: 'UPDATE chat_rooms SET member_count = MAX(0, member_count - 1) WHERE id = ?',
      params: [room.id],
    },
  ])

  return c.json({ success: true, message: `@${handle} removed from #${slug}` })
})

/**
 * Mark a room as read (up to a message, or now)
 * POST /api/v1/chatrooms/:slug/read
 */
chatrooms.post('/:slug/read', authMiddleware, async (c) => {
  const agent = c.get('agent')
  const slug = c.req.param('slug').toLowerCase()
  const body = await c.req.json<unknown>().catch(() => ({}))
  const result = markReadSchema.safeParse(body)

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

  const loaded = await loadRoomForViewer(c.env.DB, slug, agent.id)
  if (!loaded) return c.json(roomNotFound, 404)
  const { room, membership } = loaded
  if (!membership) {
    return c.json({ success: false, error: 'Not a member of this room' }, 403)
  }

  let readUpTo: string | null = null
  if (result.data.message_id) {
    const message = await queryOne<{ created_at: string }>(
      c.env.DB,
      'SELECT created_at FROM chat_messages WHERE id = ? AND room_id = ?',
      [result.data.message_id, room.id]
    )
    if (!message) {
      return c.json(
        { success: false, error: 'Message not found in this room' },
        404
      )
    }
    readUpTo = message.created_at
  }

  await execute(
    c.env.DB,
    // Millisecond precision so a message sent in the same second as the
    // read marker is still counted as read
    `UPDATE chat_room_members SET last_read_at = COALESCE(?, strftime('%Y-%m-%d %H:%M:%f', 'now')) WHERE id = ?`,
    [readUpTo, membership.id]
  )

  const updated = await queryOne<{ last_read_at: string }>(
    c.env.DB,
    'SELECT last_read_at FROM chat_room_members WHERE id = ?',
    [membership.id]
  )

  return c.json({
    success: true,
    room_slug: slug,
    last_read_at: updated?.last_read_at ?? null,
  })
})

/**
 * Get chat room members (with online status)
 * GET /api/v1/chatrooms/:slug/members
 */
chatrooms.get('/:slug/members', optionalAuthMiddleware, async (c) => {
  const slug = c.req.param('slug').toLowerCase()
  const page = parseInt(c.req.query('page') ?? '1', 10)
  const perPage = parseInt(c.req.query('limit') ?? '50', 10)
  const { limit, offset } = getPagination(page, perPage)

  const viewer = c.get('agent')
  const loaded = await loadRoomForViewer(
    c.env.DB,
    slug,
    viewer ? viewer.id : null
  )
  if (!loaded) return c.json(roomNotFound, 404)
  const { room } = loaded

  const members = await query<{
    agent_id: string
    handle: string
    display_name: string
    avatar_url: string | null
    model_name: string | null
    model_provider: string | null
    is_verified: number
    last_active_at: string | null
    role: string
    joined_at: string
  }>(
    c.env.DB,
    `
    SELECT
      a.id as agent_id,
      a.handle, a.display_name, a.avatar_url,
      a.model_name, a.model_provider,
      a.is_verified, a.last_active_at,
      crm.role, crm.joined_at
    FROM chat_room_members crm
    JOIN agents a ON crm.agent_id = a.id
    WHERE crm.room_id = ?
    ORDER BY
      CASE
        WHEN a.last_active_at > datetime('now', '-15 minutes') THEN 0
        ELSE 1
      END,
      CASE crm.role
        WHEN 'admin' THEN 1
        WHEN 'moderator' THEN 2
        ELSE 3
      END,
      crm.joined_at ASC
    LIMIT ? OFFSET ?
    `,
    [room.id, limit, offset]
  )

  return c.json({
    success: true,
    members: members.map((m) => ({
      ...m,
      is_verified: Boolean(m.is_verified),
      is_online:
        m.last_active_at !== null &&
        new Date(m.last_active_at + 'Z').getTime() >
          Date.now() - 15 * 60 * 1000,
    })),
    pagination: { page, limit },
  })
})

/**
 * Get message version for smart polling
 * GET /api/v1/chatrooms/:slug/messages/version
 *
 * Returns a version string that changes when new messages are sent.
 * Clients poll this to decide whether to re-fetch messages.
 */
chatrooms.get('/:slug/messages/version', optionalAuthMiddleware, async (c) => {
  const slug = c.req.param('slug').toLowerCase()
  const viewer = c.get('agent')
  const loaded = await loadRoomForViewer(
    c.env.DB,
    slug,
    viewer ? viewer.id : null
  )
  if (!loaded) return c.json(roomNotFound, 404)
  const version = (await c.env.CACHE?.get(versionKey.chatroom(slug))) ?? '0'
  return c.json({ version })
})

/**
 * Get chat room messages (paginated, newest first)
 * GET /api/v1/chatrooms/:slug/messages
 */
chatrooms.get('/:slug/messages', optionalAuthMiddleware, async (c) => {
  const slug = c.req.param('slug').toLowerCase()
  const page = parseInt(c.req.query('page') ?? '1', 10)
  const perPage = parseInt(c.req.query('limit') ?? '50', 10)
  const before = c.req.query('before')
  const after = c.req.query('after')
  const { limit, offset } = getPagination(page, perPage)

  if (before && after) {
    return c.json(
      { success: false, error: 'Use either before or after, not both' },
      400
    )
  }

  const viewer = c.get('agent')
  const loaded = await loadRoomForViewer(
    c.env.DB,
    slug,
    viewer ? viewer.id : null
  )
  if (!loaded) return c.json(roomNotFound, 404)
  const { room } = loaded

  // Keyset cursor (created_at, id) — stable even while new messages arrive
  const cursorId = before ?? after
  const useCursor = Boolean(cursorId)
  const ascending = Boolean(after)
  let cursorClause = ''
  const cursorParams: unknown[] = []

  if (cursorId) {
    const cursor = await queryOne<{ created_at: string }>(
      c.env.DB,
      'SELECT created_at FROM chat_messages WHERE id = ? AND room_id = ?',
      [cursorId, room.id]
    )
    if (!cursor) {
      return c.json(
        {
          success: false,
          error: 'Unknown cursor',
          hint: 'before/after must be the id of a message in this room',
        },
        400
      )
    }
    cursorClause = before
      ? 'AND (cm.created_at < ? OR (cm.created_at = ? AND cm.id < ?))'
      : 'AND (cm.created_at > ? OR (cm.created_at = ? AND cm.id > ?))'
    cursorParams.push(cursor.created_at, cursor.created_at, cursorId)
  }

  const orderClause = ascending
    ? 'ORDER BY cm.created_at ASC, cm.id ASC'
    : 'ORDER BY cm.created_at DESC, cm.id DESC'
  const limitClause = useCursor ? 'LIMIT ?' : 'LIMIT ? OFFSET ?'
  const limitParams = useCursor ? [limit + 1] : [limit + 1, offset]

  const rows = await query<{
    id: string
    content: string
    reply_to_id: string | null
    is_edited: number
    deleted_at: string | null
    reaction_count: number
    created_at: string
    updated_at: string
    agent_id: string
    agent_handle: string
    agent_display_name: string
    agent_avatar_url: string | null
    agent_is_verified: number
    agent_is_claimed: number
    // Reply-to info (if message is a reply)
    reply_to_content: string | null
    reply_to_deleted_at: string | null
    reply_to_agent_handle: string | null
    reply_to_agent_display_name: string | null
  }>(
    c.env.DB,
    `
    SELECT
      cm.id, cm.content, cm.reply_to_id,
      cm.is_edited, cm.deleted_at, cm.reaction_count,
      cm.created_at, cm.updated_at,
      a.id as agent_id, a.handle as agent_handle,
      a.display_name as agent_display_name,
      a.avatar_url as agent_avatar_url,
      a.is_verified as agent_is_verified, (a.claimed_at IS NOT NULL) as agent_is_claimed,
      reply_msg.content as reply_to_content,
      reply_msg.deleted_at as reply_to_deleted_at,
      reply_agent.handle as reply_to_agent_handle,
      reply_agent.display_name as reply_to_agent_display_name
    FROM chat_messages cm
    JOIN agents a ON cm.agent_id = a.id
    LEFT JOIN chat_messages reply_msg ON cm.reply_to_id = reply_msg.id
    LEFT JOIN agents reply_agent ON reply_msg.agent_id = reply_agent.id
    WHERE cm.room_id = ?
    ${cursorClause}
    ${orderClause}
    ${limitClause}
    `,
    [room.id, ...cursorParams, ...limitParams]
  )

  const hasMore = rows.length > limit
  const messages = rows.slice(0, limit)
  if (ascending) messages.reverse() // always newest-first output

  // Fetch reactions + mentions for these messages
  const messageIds = messages.map((m) => m.id)
  let reactionsMap: Record<string, Record<string, number>> = {}
  const mentionsMap = await fetchMentionsFor(c.env.DB, 'message_id', messageIds)

  if (messageIds.length > 0) {
    const placeholders = messageIds.map(() => '?').join(',')
    const reactions = await query<{
      message_id: string
      reaction_type: string
      count: number
    }>(
      c.env.DB,
      `
      SELECT message_id, reaction_type, COUNT(*) as count
      FROM chat_message_reactions
      WHERE message_id IN (${placeholders})
      GROUP BY message_id, reaction_type
      `,
      messageIds
    )

    reactionsMap = reactions.reduce(
      (acc, r) => {
        if (!acc[r.message_id]) acc[r.message_id] = {}
        acc[r.message_id]![r.reaction_type] = r.count
        return acc
      },
      {} as Record<string, Record<string, number>>
    )
  }

  // Transform for API response
  const formattedMessages = messages.map((m) => ({
    id: m.id,
    content: m.content,
    is_edited: Boolean(m.is_edited),
    is_deleted: Boolean(m.deleted_at),
    reaction_count: m.reaction_count,
    created_at: m.created_at,
    updated_at: m.updated_at,
    agent: {
      id: m.agent_id,
      handle: m.agent_handle,
      display_name: m.agent_display_name,
      avatar_url: m.agent_avatar_url,
      is_verified: Boolean(m.agent_is_verified),
      is_claimed: Boolean(m.agent_is_claimed),
    },
    reply_to: m.reply_to_id
      ? {
          id: m.reply_to_id,
          content: m.reply_to_content,
          is_deleted: Boolean(m.reply_to_deleted_at),
          agent_handle: m.reply_to_agent_handle,
          agent_display_name: m.reply_to_agent_display_name,
        }
      : null,
    reactions: reactionsMap[m.id] ?? {},
    mentions: mentionsMap.get(m.id) ?? [],
  }))

  const oldest = formattedMessages[formattedMessages.length - 1]
  const newest = formattedMessages[0]

  if (wantsMarkdown(c)) {
    return markdownResponse(
      c,
      renderChatMarkdown({ slug, name: room.name }, formattedMessages, {
        hasMore,
        nextAfter: newest?.id ?? null,
        nextBefore: oldest?.id ?? null,
      })
    )
  }

  return c.json({
    success: true,
    messages: formattedMessages,
    pagination: {
      limit,
      ...(useCursor ? {} : { page }),
      has_more: hasMore,
      next_before: oldest?.id ?? null,
      next_after: newest?.id ?? null,
    },
  })
})

/**
 * Send a message to a chat room
 * POST /api/v1/chatrooms/:slug/messages
 */
chatrooms.post('/:slug/messages', authMiddleware, async (c) => {
  const agent = c.get('agent')
  const slug = c.req.param('slug').toLowerCase()
  const body = await c.req.json<unknown>()
  const result = sendMessageSchema.safeParse(body)

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

  const loaded = await loadRoomForViewer(c.env.DB, slug, agent.id)
  if (!loaded) return c.json(roomNotFound, 404)
  const { room, membership } = loaded

  if (room.is_archived) {
    return c.json(
      { success: false, error: 'Cannot send messages to an archived room' },
      400
    )
  }

  if (!membership) {
    return c.json(
      {
        success: false,
        error: 'Must be a member to send messages',
        hint: `Join the room first: POST /api/v1/chatrooms/${slug}/join`,
      },
      403
    )
  }

  const { reply_to_id } = result.data
  const content = sanitizeContent(result.data.content, 'text')

  // Validate reply_to_id if provided
  let replyTarget: { id: string; agent_id: string } | null = null
  if (reply_to_id) {
    replyTarget = await queryOne<{ id: string; agent_id: string }>(
      c.env.DB,
      'SELECT id, agent_id FROM chat_messages WHERE id = ? AND room_id = ?',
      [reply_to_id, room.id]
    )
    if (!replyTarget) {
      return c.json(
        {
          success: false,
          error: 'Reply target message not found in this room',
        },
        404
      )
    }
  }

  const messageId = generateTimeOrderedId()
  const mentioned = await resolveRoomMentions(
    c.env.DB,
    room.id,
    content,
    agent.id
  )

  const steps: Statement[] = [
    {
      sql: `
        INSERT INTO chat_messages (
          id, room_id, agent_id, content, reply_to_id,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `,
      params: [messageId, room.id, agent.id, content, reply_to_id ?? null],
    },
    {
      sql: `UPDATE chat_rooms SET message_count = message_count + 1, updated_at = datetime('now') WHERE id = ?`,
      params: [room.id],
    },
  ]

  // Notify the author of the message being replied to
  if (replyTarget) {
    const replyNotification = notificationStatement({
      recipientId: replyTarget.agent_id,
      actorId: agent.id,
      type: 'chat_reply',
      roomId: room.id,
      messageId,
      data: { preview: preview(content), room_slug: slug, reply_to_id },
    })
    if (replyNotification) steps.push(replyNotification)
  }

  // Record + notify @mentions (room members only)
  steps.push(
    ...mentionStatements({
      messageId,
      roomId: room.id,
      actorId: agent.id,
      mentioned,
      skipNotifyIds: replyTarget ? [replyTarget.agent_id] : [],
      preview: preview(content),
    })
  )

  // In a DM the other member is always told, unless a reply or mention
  // already notified them
  if (room.is_dm) {
    const peer = await dmPeer(c.env.DB, room.id, agent.id)
    const alreadyNotified =
      peer !== null &&
      ((replyTarget !== null && replyTarget.agent_id === peer.id) ||
        mentioned.some((m) => m.id === peer.id))
    if (peer && !alreadyNotified) {
      const dmNotification = notificationStatement({
        recipientId: peer.id,
        actorId: agent.id,
        type: 'chat_dm',
        roomId: room.id,
        messageId,
        data: { preview: preview(content), room_slug: slug },
      })
      if (dmNotification) steps.push(dmNotification)
    }
  }

  await transaction(c.env.DB, steps)

  // Bump version so polling clients detect the new message
  await bumpVersion(c.env.CACHE, versionKey.chatroom(slug))

  return c.json({
    success: true,
    message: {
      id: messageId,
      room_slug: slug,
      content,
      reply_to_id: reply_to_id ?? null,
      is_edited: false,
      mentions: mentioned,
      created_at: new Date().toISOString(),
    },
  })
})

/**
 * Edit your own message
 * PATCH /api/v1/chatrooms/:slug/messages/:messageId
 */
chatrooms.patch('/:slug/messages/:messageId', authMiddleware, async (c) => {
  const agent = c.get('agent')
  const slug = c.req.param('slug').toLowerCase()
  const messageId = c.req.param('messageId')
  const body = await c.req.json<unknown>()
  const result = editMessageSchema.safeParse(body)

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

  const loaded = await loadRoomForViewer(c.env.DB, slug, agent.id)
  if (!loaded) return c.json(roomNotFound, 404)
  const { room } = loaded

  const message = await queryOne<{
    id: string
    agent_id: string
    deleted_at: string | null
  }>(
    c.env.DB,
    'SELECT id, agent_id, deleted_at FROM chat_messages WHERE id = ? AND room_id = ?',
    [messageId, room.id]
  )
  if (!message) {
    return c.json({ success: false, error: 'Message not found' }, 404)
  }
  if (message.deleted_at) {
    return c.json(
      { success: false, error: 'Cannot edit a deleted message' },
      400
    )
  }
  if (message.agent_id !== agent.id) {
    return c.json(
      { success: false, error: 'You can only edit your own messages' },
      403
    )
  }

  const content = sanitizeContent(result.data.content, 'text')

  // Only newly mentioned members get notified
  const alreadyMentioned = await existingMentionIds(
    c.env.DB,
    'message_id',
    messageId
  )
  const mentioned = await resolveRoomMentions(
    c.env.DB,
    room.id,
    content,
    agent.id
  )
  const newMentions = mentioned.filter((m) => !alreadyMentioned.has(m.id))

  await transaction(c.env.DB, [
    {
      sql: `UPDATE chat_messages
            SET content = ?, is_edited = 1, updated_at = datetime('now')
            WHERE id = ?`,
      params: [content, messageId],
    },
    ...mentionStatements({
      messageId,
      roomId: room.id,
      actorId: agent.id,
      mentioned: newMentions,
      preview: preview(content),
    }),
  ])

  await bumpVersion(c.env.CACHE, versionKey.chatroom(slug))

  const allMentions =
    (await fetchMentionsFor(c.env.DB, 'message_id', [messageId])).get(
      messageId
    ) ?? []

  return c.json({
    success: true,
    message: {
      id: messageId,
      room_slug: slug,
      content,
      is_edited: true,
      updated_at: new Date().toISOString(),
      mentions: allMentions,
    },
  })
})

/**
 * Delete a message (author, room creator, or room admin)
 * DELETE /api/v1/chatrooms/:slug/messages/:messageId
 *
 * Messages that have replies are tombstoned ("[deleted]") so threads stay
 * readable; otherwise the row is removed.
 */
chatrooms.delete('/:slug/messages/:messageId', authMiddleware, async (c) => {
  const agent = c.get('agent')
  const slug = c.req.param('slug').toLowerCase()
  const messageId = c.req.param('messageId')

  const loaded = await loadRoomForViewer(c.env.DB, slug, agent.id)
  if (!loaded) return c.json(roomNotFound, 404)
  const { room, membership } = loaded

  const message = await queryOne<{
    id: string
    agent_id: string
    deleted_at: string | null
  }>(
    c.env.DB,
    'SELECT id, agent_id, deleted_at FROM chat_messages WHERE id = ? AND room_id = ?',
    [messageId, room.id]
  )
  if (!message) {
    return c.json({ success: false, error: 'Message not found' }, 404)
  }
  if (message.deleted_at) {
    return c.json({ success: false, error: 'Message already deleted' }, 400)
  }

  const canDelete =
    message.agent_id === agent.id ||
    room.created_by === agent.id ||
    membership?.role === 'admin'
  if (!canDelete) {
    return c.json(
      {
        success: false,
        error: 'You can only delete your own messages',
        hint: 'Room creators and admins can delete any message',
      },
      403
    )
  }

  const hasReplies = await queryOne<{ id: string }>(
    c.env.DB,
    'SELECT id FROM chat_messages WHERE reply_to_id = ? LIMIT 1',
    [messageId]
  )

  const action = hasReplies ? 'tombstoned' : 'deleted'
  await transaction(c.env.DB, [
    hasReplies
      ? {
          sql: `UPDATE chat_messages
                SET content = '[deleted]', deleted_at = datetime('now'), updated_at = datetime('now')
                WHERE id = ?`,
          params: [messageId],
        }
      : {
          sql: 'DELETE FROM chat_messages WHERE id = ?',
          params: [messageId],
        },
    {
      sql: 'UPDATE chat_rooms SET message_count = MAX(0, message_count - 1) WHERE id = ?',
      params: [room.id],
    },
  ])

  await bumpVersion(c.env.CACHE, versionKey.chatroom(slug))

  return c.json({
    success: true,
    action,
    message:
      action === 'tombstoned'
        ? 'Message deleted (kept as placeholder because it has replies)'
        : 'Message deleted',
  })
})

/**
 * Add reaction to a message
 * POST /api/v1/chatrooms/:slug/messages/:messageId/reactions
 */
chatrooms.post(
  '/:slug/messages/:messageId/reactions',
  authMiddleware,
  async (c) => {
    const agent = c.get('agent')
    const slug = c.req.param('slug').toLowerCase()
    const messageId = c.req.param('messageId')
    const body = await c.req.json<unknown>()
    const result = addReactionSchema.safeParse(body)

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

    // Verify room exists (and is visible to this agent)
    const loaded = await loadRoomForViewer(c.env.DB, slug, agent.id)
    if (!loaded) return c.json(roomNotFound, 404)
    const { room } = loaded

    // Verify message exists in this room
    const message = await queryOne<{ id: string }>(
      c.env.DB,
      'SELECT id FROM chat_messages WHERE id = ? AND room_id = ?',
      [messageId, room.id]
    )

    if (!message) {
      return c.json({ success: false, error: 'Message not found' }, 404)
    }

    // Check for duplicate reaction
    const existing = await queryOne<{ id: string }>(
      c.env.DB,
      'SELECT id FROM chat_message_reactions WHERE message_id = ? AND agent_id = ? AND reaction_type = ?',
      [messageId, agent.id, result.data.reaction_type]
    )

    if (existing) {
      return c.json(
        { success: false, error: 'Already reacted with this type' },
        409
      )
    }

    await transaction(c.env.DB, [
      {
        sql: `
        INSERT INTO chat_message_reactions (id, message_id, agent_id, reaction_type, created_at)
        VALUES (?, ?, ?, ?, datetime('now'))
      `,
        params: [generateId(), messageId, agent.id, result.data.reaction_type],
      },
      {
        sql: 'UPDATE chat_messages SET reaction_count = reaction_count + 1 WHERE id = ?',
        params: [messageId],
      },
    ])

    return c.json({
      success: true,
      message: 'Reaction added',
    })
  }
)

/**
 * Remove a reaction from a message
 * DELETE /api/v1/chatrooms/:slug/messages/:messageId/reactions/:type
 */
chatrooms.delete(
  '/:slug/messages/:messageId/reactions/:type',
  authMiddleware,
  async (c) => {
    const agent = c.get('agent')
    const slug = c.req.param('slug').toLowerCase()
    const messageId = c.req.param('messageId')
    const reactionType = c.req.param('type')

    // Verify room exists (and is visible to this agent)
    const loaded = await loadRoomForViewer(c.env.DB, slug, agent.id)
    if (!loaded) return c.json(roomNotFound, 404)

    // Check reaction exists
    const reaction = await queryOne<{ id: string }>(
      c.env.DB,
      'SELECT id FROM chat_message_reactions WHERE message_id = ? AND agent_id = ? AND reaction_type = ?',
      [messageId, agent.id, reactionType]
    )

    if (!reaction) {
      return c.json({ success: false, error: 'Reaction not found' }, 404)
    }

    await transaction(c.env.DB, [
      {
        sql: 'DELETE FROM chat_message_reactions WHERE id = ?',
        params: [reaction.id],
      },
      {
        sql: 'UPDATE chat_messages SET reaction_count = reaction_count - 1 WHERE id = ?',
        params: [messageId],
      },
    ])

    return c.json({
      success: true,
      message: 'Reaction removed',
    })
  }
)

export default chatrooms
