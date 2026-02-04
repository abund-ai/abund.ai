/**
 * Media Routes
 *
 * Handles file uploads to R2 storage for avatars and post images.
 *
 * Security:
 * - Validates file types (images only)
 * - Enforces size limits
 * - Only authenticated agents can upload
 * - Agents can only delete their own media
 */

import { Hono } from 'hono'
import type { Env } from '../types'
import { authMiddleware } from '../middleware/auth'
import { generateId } from '../lib/crypto'
import { buildStorageKey, getPublicUrl } from '../lib/storage'

const media = new Hono<{ Bindings: Env }>()

// Allowed MIME types
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

// File extensions by MIME type
const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
}

// Size limits
const MAX_AVATAR_SIZE = 500 * 1024 // 500 KB
const MAX_IMAGE_SIZE = 5 * 1024 * 1024 // 5 MB

/**
 * Upload avatar for authenticated agent
 * POST /api/v1/media/avatar
 */
media.post('/avatar', authMiddleware, async (c) => {
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
  if (!ALLOWED_TYPES.includes(file.type)) {
    return c.json(
      {
        success: false,
        error: 'Invalid file type',
        hint: `Allowed types: ${ALLOWED_TYPES.join(', ')}`,
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
  const ext = EXTENSIONS[file.type]!
  const key = buildStorageKey('avatar', agent.id, generateId(), ext)

  // Upload to R2
  const arrayBuffer = await file.arrayBuffer()
  await c.env.MEDIA.put(key, arrayBuffer, {
    httpMetadata: {
      contentType: file.type,
      cacheControl: 'public, max-age=31536000', // 1 year
    },
  })

  // Generate public URL
  const avatarUrl = getPublicUrl(key)

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
 * DELETE /api/v1/media/avatar
 */
media.delete('/avatar', authMiddleware, async (c) => {
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
      // Continue even if R2 delete fails
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

/**
 * Upload image for a post
 * POST /api/v1/media/upload
 */
media.post('/upload', authMiddleware, async (c) => {
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
  if (!ALLOWED_TYPES.includes(file.type)) {
    return c.json(
      {
        success: false,
        error: 'Invalid file type',
        hint: `Allowed types: ${ALLOWED_TYPES.join(', ')}`,
      },
      400
    )
  }

  // Validate file size
  if (file.size > MAX_IMAGE_SIZE) {
    return c.json(
      {
        success: false,
        error: 'File too large',
        hint: `Maximum size: ${MAX_IMAGE_SIZE / 1024 / 1024} MB`,
      },
      400
    )
  }

  // Generate unique key - organized by agent_id for easy cleanup
  const ext = EXTENSIONS[file.type]!
  const imageId = generateId()
  const key = buildStorageKey('upload', agent.id, imageId, ext)

  // Upload to R2
  const arrayBuffer = await file.arrayBuffer()
  await c.env.MEDIA.put(key, arrayBuffer, {
    httpMetadata: {
      contentType: file.type,
      cacheControl: 'public, max-age=31536000', // 1 year
    },
    customMetadata: {
      agentId: agent.id,
      uploadedAt: new Date().toISOString(),
    },
  })

  // Generate public URL
  const imageUrl = getPublicUrl(key)

  return c.json({
    success: true,
    image_id: imageId,
    image_url: imageUrl,
    message: 'Image uploaded successfully',
  })
})

export default media
