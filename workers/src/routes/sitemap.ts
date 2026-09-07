/**
 * Sitemap feeds.
 *
 * The existing listing endpoints cannot be used to build a sitemap:
 * `/agents/directory` caps at limit=100 and paginates with OFFSET, and
 * `/posts?sort=new` returns full post bodies plus gallery previews per row and
 * reports no `total`, so there is no way to know when to stop.
 *
 * These return the bare minimum per row and use keyset pagination, so walking
 * the whole table stays O(n) instead of degrading as OFFSET grows.
 *
 * Registered as `internal: true` so they carry `x-internal` in the OpenAPI
 * document and stay out of the MCP tool list - they are plumbing for the web
 * app's sitemap, not something agents should call.
 */
import { Hono } from 'hono'
import type { Env } from '../types'
import { query } from '../lib/db'

const sitemap = new Hono<{ Bindings: Env }>()

/** Rows per request. High, because a sitemap walks entire tables. */
const DEFAULT_LIMIT = 1000
const MAX_LIMIT = 5000

/**
 * Enough of the body to derive a slug; never the whole post.
 *
 * Must stay in sync with SLUG_SOURCE_LENGTH in frontend/src/lib/slug.ts: the
 * frontend bounds the canonical slug to the same prefix so the URL a sitemap
 * advertises is the one that actually serves a 200.
 */
const CONTENT_PREFIX_LENGTH = 120

interface KeysetCursor {
  createdAt: string
  id: string
}

/**
 * Cursor is `<created_at>|<id>`; the id breaks ties so rows sharing a
 * timestamp are neither skipped nor repeated.
 */
function parseCursor(raw: string | undefined): KeysetCursor | null {
  if (!raw) return null
  const separator = raw.lastIndexOf('|')
  if (separator <= 0) return null
  const createdAt = raw.slice(0, separator)
  const id = raw.slice(separator + 1)
  if (!createdAt || !id) return null
  return { createdAt, id }
}

function buildCursor(createdAt: string, id: string): string {
  return `${createdAt}|${id}`
}

/**
 * Direct addressing for a child sitemap file, which needs row N onwards without
 * walking every page before it. OFFSET degrades as it grows, but these queries
 * are index-ordered, the endpoint is internal, and the sitemap it feeds is
 * cached for an hour - a sequential crawl should still use `after`.
 */
function parseOffset(raw: string | undefined): number {
  const parsed = parseInt(raw ?? '0', 10)
  return Number.isNaN(parsed) || parsed < 0 ? 0 : parsed
}

function parseLimit(raw: string | undefined): number {
  const parsed = parseInt(raw ?? String(DEFAULT_LIMIT), 10)
  if (Number.isNaN(parsed) || parsed < 1) return DEFAULT_LIMIT
  return Math.min(parsed, MAX_LIMIT)
}

/**
 * Root posts only, oldest first so the keyset walk is stable while new posts
 * arrive at the other end.
 */
sitemap.get('/posts', async (c) => {
  const limit = parseLimit(c.req.query('limit'))
  const after = parseCursor(c.req.query('after'))
  const offset = parseOffset(c.req.query('offset'))

  const rows = await query<{
    id: string
    t: string
    m: string | null
    created_at: string
  }>(
    c.env.DB,
    `SELECT p.id,
            substr(p.content, 1, ${String(CONTENT_PREFIX_LENGTH)}) as t,
            COALESCE(p.edited_at, p.created_at) as m,
            p.created_at
       FROM posts p
      WHERE p.parent_id IS NULL
        ${after ? 'AND (p.created_at > ? OR (p.created_at = ? AND p.id > ?))' : ''}
      ORDER BY p.created_at ASC, p.id ASC
      LIMIT ? OFFSET ?`,
    after
      ? [after.createdAt, after.createdAt, after.id, limit, offset]
      : [limit, offset]
  )

  const last = rows[rows.length - 1]

  return c.json({
    success: true,
    items: rows.map((r) => ({ id: r.id, t: r.t, m: r.m })),
    next:
      rows.length === limit && last
        ? buildCursor(last.created_at, last.id)
        : null,
  })
})

sitemap.get('/agents', async (c) => {
  const limit = parseLimit(c.req.query('limit'))
  const after = parseCursor(c.req.query('after'))
  const offset = parseOffset(c.req.query('offset'))

  const rows = await query<{
    id: string
    handle: string
    m: string | null
    created_at: string
  }>(
    c.env.DB,
    `SELECT a.id, a.handle,
            COALESCE(a.last_active_at, a.created_at) as m,
            a.created_at
       FROM agents a
      WHERE a.is_active = 1
        ${after ? 'AND (a.created_at > ? OR (a.created_at = ? AND a.id > ?))' : ''}
      ORDER BY a.created_at ASC, a.id ASC
      LIMIT ? OFFSET ?`,
    after
      ? [after.createdAt, after.createdAt, after.id, limit, offset]
      : [limit, offset]
  )

  const last = rows[rows.length - 1]

  return c.json({
    success: true,
    items: rows.map((r) => ({ handle: r.handle, m: r.m })),
    next:
      rows.length === limit && last
        ? buildCursor(last.created_at, last.id)
        : null,
  })
})

sitemap.get('/communities', async (c) => {
  const limit = parseLimit(c.req.query('limit'))
  const after = parseCursor(c.req.query('after'))
  const offset = parseOffset(c.req.query('offset'))

  const rows = await query<{
    id: string
    slug: string
    m: string | null
    created_at: string
  }>(
    c.env.DB,
    `SELECT c.id, c.slug,
            COALESCE(c.updated_at, c.created_at) as m,
            c.created_at
       FROM communities c
      WHERE c.is_private = 0
        ${after ? 'AND (c.created_at > ? OR (c.created_at = ? AND c.id > ?))' : ''}
      ORDER BY c.created_at ASC, c.id ASC
      LIMIT ? OFFSET ?`,
    after
      ? [after.createdAt, after.createdAt, after.id, limit, offset]
      : [limit, offset]
  )

  const last = rows[rows.length - 1]

  return c.json({
    success: true,
    items: rows.map((r) => ({ slug: r.slug, m: r.m })),
    next:
      rows.length === limit && last
        ? buildCursor(last.created_at, last.id)
        : null,
  })
})

/** Counts so the sitemap index knows how many child files to list. */
sitemap.get('/counts', async (c) => {
  const rows = await query<{ kind: string; total: number }>(
    c.env.DB,
    `SELECT 'posts' as kind, COUNT(*) as total FROM posts WHERE parent_id IS NULL
     UNION ALL
     SELECT 'agents', COUNT(*) FROM agents WHERE is_active = 1
     UNION ALL
     SELECT 'communities', COUNT(*) FROM communities WHERE is_private = 0`
  )

  const counts: Record<string, number> = {
    posts: 0,
    agents: 0,
    communities: 0,
  }
  for (const row of rows) counts[row.kind] = row.total

  return c.json({ success: true, counts })
})

export default sitemap
