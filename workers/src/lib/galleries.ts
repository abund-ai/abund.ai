/**
 * Gallery preview helpers
 *
 * Used by feed-style endpoints to enrich gallery posts (`content_type === 'gallery'`)
 * with their first few preview images and total image count, so clients can render
 * inline image previews without making a follow-up `/galleries/:id` request per post.
 */

import { query } from './db'

export interface GalleryPreviewImage {
  id: string
  image_url: string
  thumbnail_url: string | null
  position: number
}

export interface GalleryPreview {
  images: GalleryPreviewImage[]
  image_count: number
}

/**
 * Number of preview images returned per gallery post.
 * Matches the inline grid the frontend renders (1 / 2 / 2x2 layout).
 */
const PREVIEW_LIMIT = 4

/**
 * Fetch gallery image previews for the given post IDs in a single batched query.
 * Returns a Map keyed by post_id. Posts that have no gallery rows are omitted.
 *
 * Callers should filter input to posts with `content_type === 'gallery'` to
 * avoid unnecessary lookups for non-gallery posts.
 */
export async function fetchGalleryPreviews(
  db: D1Database,
  postIds: string[]
): Promise<Map<string, GalleryPreview>> {
  const previews = new Map<string, GalleryPreview>()
  if (postIds.length === 0) return previews

  const placeholders = postIds.map(() => '?').join(',')
  const galleryImages = await query<{
    id: string
    post_id: string
    image_url: string
    thumbnail_url: string | null
    position: number
  }>(
    db,
    `
    SELECT id, post_id, image_url, thumbnail_url, position
    FROM gallery_images
    WHERE post_id IN (${placeholders})
    ORDER BY post_id, position ASC
    `,
    postIds
  )

  for (const postId of postIds) {
    const allForPost = galleryImages.filter((gi) => gi.post_id === postId)
    if (allForPost.length === 0) continue
    previews.set(postId, {
      images: allForPost.slice(0, PREVIEW_LIMIT).map((gi) => ({
        id: gi.id,
        image_url: gi.image_url,
        thumbnail_url: gi.thumbnail_url,
        position: gi.position,
      })),
      image_count: allForPost.length,
    })
  }

  return previews
}

/**
 * Convenience wrapper: given a list of post-shaped rows, fetch gallery
 * previews for any whose `content_type === 'gallery'` and return a Map.
 */
export async function fetchGalleryPreviewsForPosts(
  db: D1Database,
  posts: Array<{ id: string; content_type: string }>
): Promise<Map<string, GalleryPreview>> {
  const ids = posts.filter((p) => p.content_type === 'gallery').map((p) => p.id)
  return fetchGalleryPreviews(db, ids)
}

/**
 * Shape of the fields appended to a post when a preview exists.
 * Spread into the response object alongside the rest of the post fields.
 */
export function galleryPreviewFields(
  preview: GalleryPreview | undefined
):
  | {
      gallery_image_count: number
      gallery_preview_images: GalleryPreviewImage[]
    }
  | Record<string, never> {
  if (!preview) return {}
  return {
    gallery_image_count: preview.image_count,
    gallery_preview_images: preview.images,
  }
}
