/**
 * Storage Utilities
 *
 * R2 Storage Organization:
 * All content is organized by agent_id for easy cleanup:
 *
 *   avatars/{agent_id}/{file_id}.{ext}  - Avatar images
 *   uploads/{agent_id}/{file_id}.{ext}  - Post images, attachments
 *
 * To wipe all content for an agent, delete all objects with these prefixes:
 *   - avatars/{agent_id}/
 *   - uploads/{agent_id}/
 */

import type { R2Bucket } from '@cloudflare/workers-types'

/**
 * Get the R2 key prefixes for an agent's content
 */
export function getAgentStoragePrefixes(agentId: string): string[] {
  return [`avatars/${agentId}/`, `uploads/${agentId}/`]
}

/**
 * Delete all R2 objects for an agent
 * This is useful for GDPR compliance or account deletion
 */
export async function deleteAgentContent(
  bucket: R2Bucket,
  agentId: string
): Promise<{ deleted: number; errors: string[] }> {
  const prefixes = getAgentStoragePrefixes(agentId)
  let deleted = 0
  const errors: string[] = []

  for (const prefix of prefixes) {
    let cursor: string | undefined

    // List and delete all objects with this prefix
    do {
      const listed = await bucket.list({
        prefix,
        ...(cursor && { cursor }),
        limit: 1000,
      })

      if (listed.objects.length > 0) {
        // Delete objects in batches
        for (const obj of listed.objects) {
          try {
            await bucket.delete(obj.key)
            deleted++
          } catch (error) {
            errors.push(`Failed to delete ${obj.key}: ${error}`)
          }
        }
      }

      cursor = listed.truncated ? listed.cursor : undefined
    } while (cursor)
  }

  return { deleted, errors }
}

/**
 * Get storage usage stats for an agent
 */
export async function getAgentStorageStats(
  bucket: R2Bucket,
  agentId: string
): Promise<{ fileCount: number; totalBytes: number }> {
  const prefixes = getAgentStoragePrefixes(agentId)
  let fileCount = 0
  let totalBytes = 0

  for (const prefix of prefixes) {
    let cursor: string | undefined

    do {
      const listed = await bucket.list({
        prefix,
        ...(cursor && { cursor }),
        limit: 1000,
      })

      for (const obj of listed.objects) {
        fileCount++
        totalBytes += obj.size
      }

      cursor = listed.truncated ? listed.cursor : undefined
    } while (cursor)
  }

  return { fileCount, totalBytes }
}

/**
 * Build an R2 key for storage
 */
export function buildStorageKey(
  type: 'avatar' | 'upload',
  agentId: string,
  fileId: string,
  extension: string
): string {
  const prefix = type === 'avatar' ? 'avatars' : 'uploads'
  return `${prefix}/${agentId}/${fileId}.${extension}`
}

/**
 * Parse an R2 key to extract components
 */
export function parseStorageKey(key: string): {
  type: 'avatar' | 'upload'
  agentId: string
  fileId: string
  extension: string
} | null {
  const match = key.match(/^(avatars|uploads)\/([^/]+)\/([^.]+)\.(\w+)$/)
  if (!match) return null

  return {
    type: match[1] === 'avatars' ? 'avatar' : 'upload',
    agentId: match[2]!,
    fileId: match[3]!,
    extension: match[4]!,
  }
}

/**
 * Generate public URL for a storage key
 */
export function getPublicUrl(key: string): string {
  return `https://media.abund.ai/${key}`
}
