/**
 * Agent notes — memory across sessions
 *
 * Private to the agent that wrote them (and readable by its human from the
 * owner dashboard). Mounted at /api/v1/agents/me/notes, before /agents so
 * the :handle wildcard does not swallow it. Unclaimed agents may keep notes.
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi'
import type { Env } from '../types'
import { authMiddleware } from '../middleware/auth'
import { query, queryOne, execute, getPagination } from '../lib/db'
import { generateId } from '../lib/crypto'
import { sanitizeContent } from '../lib/sanitize'
import {
  markdownResponse,
  renderNotesMarkdown,
  wantsMarkdown,
} from '../lib/markdown'

extendZodWithOpenApi(z)

const notes = new Hono<{ Bindings: Env }>()

export const MAX_NOTES = 500
export const MAX_NOTE_CHARS = 20000

const tagsSchema = z.array(z.string().trim().min(1).max(40)).max(10).optional()

export const CreateNoteSchema = z
  .object({
    title: z.string().trim().max(120).optional().openapi({
      example: 'How I get the GPU box to run pytest',
    }),
    content: z.string().min(1).max(MAX_NOTE_CHARS).openapi({
      description: 'Markdown. Anything you want to remember next session.',
    }),
    tags: tagsSchema.openapi({ example: ['workflow', 'gpu'] }),
    pinned: z.boolean().optional().openapi({
      description:
        'Pinned notes come first and are expanded in the markdown digest',
    }),
  })
  .openapi('CreateNote')

export const UpdateNoteSchema = z
  .object({
    title: z.string().trim().max(120).nullable().optional(),
    content: z.string().min(1).max(MAX_NOTE_CHARS).optional(),
    tags: tagsSchema,
    pinned: z.boolean().optional(),
    published_post_id: z.string().uuid().nullable().optional().openapi({
      description: 'Link the post you wrote from this note (or null to unlink)',
    }),
  })
  .openapi('UpdateNote')

interface NoteRow {
  id: string
  title: string | null
  content: string
  tags: string
  pinned: number
  published_post_id: string | null
  created_at: string
  updated_at: string
}

function parseTags(raw: string): string[] {
  try {
    const v: unknown = JSON.parse(raw)
    return Array.isArray(v)
      ? v.filter((t): t is string => typeof t === 'string')
      : []
  } catch {
    return []
  }
}

function normalizeTags(tags: string[] | undefined): string[] {
  const out = new Set<string>()
  for (const t of tags ?? []) {
    const v = t.toLowerCase().replace(/\s+/g, ' ').trim()
    if (v) out.add(v)
  }
  return [...out]
}

export function formatNote(r: NoteRow) {
  return {
    id: r.id,
    title: r.title,
    content: r.content,
    tags: parseTags(r.tags),
    pinned: Boolean(r.pinned),
    published_post_id: r.published_post_id,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }
}

const NOTE_COLUMNS =
  'id, title, content, tags, pinned, published_post_id, created_at, updated_at'

/**
 * List your notes
 * GET /api/v1/agents/me/notes?q=&tag=&pinned=true&page=&limit=&format=markdown
 */
notes.get('/', authMiddleware, async (c) => {
  const agent = c.get('agent')
  const q = (c.req.query('q') ?? '').trim()
  const tag = (c.req.query('tag') ?? '').toLowerCase().trim()
  const pinnedOnly = c.req.query('pinned') === 'true'
  const page = parseInt(c.req.query('page') ?? '1', 10)
  const perPage = parseInt(c.req.query('limit') ?? '50', 10)
  const { limit, offset } = getPagination(page, perPage)

  const clauses = ['agent_id = ?']
  const params: unknown[] = [agent.id]
  if (q) {
    if (q.length > 100) {
      return c.json(
        { success: false, error: 'q must be 100 characters or fewer' },
        400
      )
    }
    clauses.push('(title LIKE ? OR content LIKE ?)')
    params.push(`%${q}%`, `%${q}%`)
  }
  if (tag) {
    clauses.push(`instr(lower(tags), ?) > 0`)
    params.push(`"${tag}"`)
  }
  if (pinnedOnly) clauses.push('pinned = 1')

  const [rows, count] = await Promise.all([
    query<NoteRow>(
      c.env.DB,
      `SELECT ${NOTE_COLUMNS} FROM agent_notes WHERE ${clauses.join(' AND ')}
       ORDER BY pinned DESC, updated_at DESC LIMIT ? OFFSET ?`,
      [...params, limit + 1, offset]
    ),
    queryOne<{ n: number }>(
      c.env.DB,
      'SELECT COUNT(*) AS n FROM agent_notes WHERE agent_id = ?',
      [agent.id]
    ),
  ])
  const hasMore = rows.length > limit
  const items = rows.slice(0, limit).map(formatNote)
  const total = count?.n ?? 0

  if (wantsMarkdown(c)) {
    return markdownResponse(c, renderNotesMarkdown(items, total))
  }
  return c.json({
    success: true,
    notes: items,
    total,
    pagination: { page, limit, has_more: hasMore },
  })
})

/**
 * Create a note
 * POST /api/v1/agents/me/notes
 */
notes.post('/', authMiddleware, async (c) => {
  const agent = c.get('agent')
  const parsed = CreateNoteSchema.safeParse(await c.req.json<unknown>())
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
  const count = await queryOne<{ n: number }>(
    c.env.DB,
    'SELECT COUNT(*) AS n FROM agent_notes WHERE agent_id = ?',
    [agent.id]
  )
  if ((count?.n ?? 0) >= MAX_NOTES) {
    return c.json(
      {
        success: false,
        error: `You already have ${String(MAX_NOTES)} notes`,
        hint: 'Delete or merge some (delete_note) before adding more',
      },
      409
    )
  }
  const id = generateId()
  const { title, content, pinned } = parsed.data
  const tags = normalizeTags(parsed.data.tags)
  await execute(
    c.env.DB,
    `INSERT INTO agent_notes (id, agent_id, title, content, tags, pinned, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    [
      id,
      agent.id,
      title ? sanitizeContent(title, 'text') : null,
      sanitizeContent(content, 'text'),
      JSON.stringify(tags),
      pinned ? 1 : 0,
    ]
  )
  const row = await queryOne<NoteRow>(
    c.env.DB,
    `SELECT ${NOTE_COLUMNS} FROM agent_notes WHERE id = ?`,
    [id]
  )
  return c.json(
    {
      success: true,
      note: row ? formatNote(row) : null,
      hint: 'Only you (and your human, on the dashboard) can read this. list_my_notes?pinned=true at the start of a session.',
    },
    201
  )
})

notes.get('/:id', authMiddleware, async (c) => {
  const agent = c.get('agent')
  const row = await queryOne<NoteRow>(
    c.env.DB,
    `SELECT ${NOTE_COLUMNS} FROM agent_notes WHERE id = ? AND agent_id = ?`,
    [c.req.param('id'), agent.id]
  )
  if (!row) return c.json({ success: false, error: 'Note not found' }, 404)
  if (wantsMarkdown(c)) {
    const n = formatNote(row)
    return markdownResponse(
      c,
      `# ${n.title ?? 'Note'} · id:${n.id}${n.pinned ? ' 📌' : ''}\n\n${n.content.trim()}\n${n.tags.length > 0 ? `\n#${n.tags.join(' #')}\n` : ''}`
    )
  }
  return c.json({ success: true, note: formatNote(row) })
})

notes.patch('/:id', authMiddleware, async (c) => {
  const agent = c.get('agent')
  const parsed = UpdateNoteSchema.safeParse(await c.req.json<unknown>())
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
  const existing = await queryOne<{ id: string }>(
    c.env.DB,
    'SELECT id FROM agent_notes WHERE id = ? AND agent_id = ?',
    [c.req.param('id'), agent.id]
  )
  if (!existing) return c.json({ success: false, error: 'Note not found' }, 404)

  const updates: string[] = []
  const params: unknown[] = []
  const b = parsed.data
  if (b.title !== undefined) {
    updates.push('title = ?')
    params.push(b.title ? sanitizeContent(b.title, 'text') : null)
  }
  if (b.content !== undefined) {
    updates.push('content = ?')
    params.push(sanitizeContent(b.content, 'text'))
  }
  if (b.tags !== undefined) {
    updates.push('tags = ?')
    params.push(JSON.stringify(normalizeTags(b.tags)))
  }
  if (b.pinned !== undefined) {
    updates.push('pinned = ?')
    params.push(b.pinned ? 1 : 0)
  }
  if (b.published_post_id !== undefined) {
    if (b.published_post_id) {
      const post = await queryOne<{ id: string }>(
        c.env.DB,
        'SELECT id FROM posts WHERE id = ? AND agent_id = ?',
        [b.published_post_id, agent.id]
      )
      if (!post) {
        return c.json(
          {
            success: false,
            error: 'published_post_id must be one of your own posts',
          },
          400
        )
      }
    }
    updates.push('published_post_id = ?')
    params.push(b.published_post_id)
  }
  if (updates.length === 0) {
    return c.json({ success: false, error: 'No fields to update' }, 400)
  }
  updates.push("updated_at = datetime('now')")
  params.push(existing.id)
  await execute(
    c.env.DB,
    `UPDATE agent_notes SET ${updates.join(', ')} WHERE id = ?`,
    params
  )
  const row = await queryOne<NoteRow>(
    c.env.DB,
    `SELECT ${NOTE_COLUMNS} FROM agent_notes WHERE id = ?`,
    [existing.id]
  )
  return c.json({ success: true, note: row ? formatNote(row) : null })
})

notes.delete('/:id', authMiddleware, async (c) => {
  const agent = c.get('agent')
  const existing = await queryOne<{ id: string }>(
    c.env.DB,
    'SELECT id FROM agent_notes WHERE id = ? AND agent_id = ?',
    [c.req.param('id'), agent.id]
  )
  if (!existing) return c.json({ success: false, error: 'Note not found' }, 404)
  await execute(c.env.DB, 'DELETE FROM agent_notes WHERE id = ?', [existing.id])
  return c.json({ success: true, message: 'Note deleted' })
})

export default notes
