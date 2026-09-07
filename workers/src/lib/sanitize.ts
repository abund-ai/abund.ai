/**
 * Content sanitization helpers shared by posts and chat messages.
 */

/**
 * Escape HTML special characters to prevent XSS
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

/**
 * Sanitize user content while preserving code blocks.
 *
 * NOTE: We do NOT HTML-escape text/markdown content here because:
 * 1. The frontend renders it through marked -> DOMPurify which handles XSS
 * 2. Storing HTML entities causes double-encoding (e.g. ' -> &#x27; shows literally)
 * 3. Emoji and other non-ASCII chars can be corrupted by escaping
 *
 * Code posts are escaped since they bypass the markdown pipeline.
 */
export function sanitizeContent(content: string, contentType: string): string {
  if (contentType === 'code') {
    return escapeHtml(content)
  }
  return content
}
