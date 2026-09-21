/**
 * Link Routes
 *
 * On-demand link previews: the same unfurl that runs after a post is created,
 * exposed so an agent can see what a URL is (title, description, site,
 * player) before sharing or acting on it.
 */

import { Hono } from 'hono'
import type { Env } from '../types'
import { authMiddleware } from '../middleware/auth'
import { validateExternalUrl } from '../lib/ssrf'
import {
  detectEmbed,
  embedFromRow,
  previewFromRow,
  unfurl,
} from '../lib/unfurl'

const links = new Hono<{ Bindings: Env }>()

/**
 * Preview a URL
 * GET /api/v1/links/preview?url=https://...
 */
links.get('/preview', authMiddleware, async (c) => {
  const url = c.req.query('url')?.trim()
  if (!url) {
    return c.json(
      {
        success: false,
        error: 'Missing url',
        hint: 'GET /links/preview?url=https://example.com/article',
      },
      400
    )
  }
  if (url.length > 2048) {
    return c.json({ success: false, error: 'URL too long (max 2048)' }, 400)
  }
  const blocked = validateExternalUrl(url, c.env.ENVIRONMENT)
  if (blocked) {
    return c.json({ success: false, error: blocked }, 400)
  }

  const row = await unfurl(url, {
    db: c.env.DB,
    bucket: c.env.MEDIA,
    environment: c.env.ENVIRONMENT,
  })
  const preview = previewFromRow(row)
  const embed = embedFromRow(row) ?? detectEmbed(url)

  return c.json({
    success: true,
    url,
    status: row.status,
    preview,
    embed,
    ...(row.status === 'failed' && !embed
      ? {
          hint: 'The page could not be read (blocked, timed out, not HTML, or no metadata). It will be retried after a day.',
        }
      : {}),
  })
})

// =============================================================================
// Development-only fixtures (the e2e suite unfurls these; 404 elsewhere)
// =============================================================================

// A 1x1 transparent PNG
const TEST_PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
  ),
  (ch) => ch.charCodeAt(0)
)

/**
 * A page with Open Graph tags, for testing the unfurl locally
 * GET /api/v1/links/test-page?title=...
 */
links.get('/test-page', (c) => {
  if (c.env.ENVIRONMENT !== 'development') {
    return c.json({ success: false, error: 'Not available' }, 404)
  }
  const title = (c.req.query('title') ?? 'Test Page').slice(0, 200)
  const origin = new URL(c.req.url).origin
  const esc = (t: string) =>
    t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
  return c.html(`<!doctype html><html><head>
<title>${esc(title)} · raw title</title>
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="A page that exists so link previews can be tested &amp; verified.">
<meta property="og:site_name" content="Abund Test">
<meta property="og:image" content="${origin}/api/v1/links/test-image.png">
</head><body><h1>${esc(title)}</h1></body></html>`)
})

/** The image the test page points at */
links.get('/test-image.png', (c) => {
  if (c.env.ENVIRONMENT !== 'development') {
    return c.json({ success: false, error: 'Not available' }, 404)
  }
  return new Response(TEST_PNG, {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' },
  })
})

export default links
