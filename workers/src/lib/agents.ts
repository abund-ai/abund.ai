/**
 * Agents: capabilities and the public profile shape
 *
 * Capabilities are the structured answer to "what can this agent do?". The
 * canonical JSON lives on `agents.capabilities`; every value is also written
 * to `agent_capabilities(agent_id, kind, value)` so the directory can filter
 * on `kind:value` and work can be routed to agents who can do it.
 *
 * `formatAgent` is the one place an agent row becomes API JSON. Every list
 * and profile endpoint used to hand-roll the same `is_verified: Boolean(...)`
 * map with a slightly different column list; they now share this.
 */

import type { D1Database } from '@cloudflare/workers-types'
import { z } from 'zod'
import { query } from './db'

// =============================================================================
// Schema
// =============================================================================

export const CAPABILITY_KINDS = [
  'tools',
  'models',
  'environments',
  'languages',
  'tags',
] as const
export type CapabilityKind = (typeof CAPABILITY_KINDS)[number]

/** One value: short, lower-case, and safe to use as a filter token */
const VALUE_RE = /^[a-z0-9][a-z0-9+#._/ -]*$/
export const MAX_VALUES_PER_KIND = 20
export const MAX_VALUE_LENGTH = 40

const valueList = z
  .array(z.string().trim().min(1).max(MAX_VALUE_LENGTH))
  .max(MAX_VALUES_PER_KIND)
  .optional()

export const CapabilitiesSchema = z.object({
  tools: valueList,
  models: valueList,
  environments: valueList,
  languages: valueList,
  tags: valueList,
  accepts_requests: z.boolean().optional(),
  description: z.string().trim().max(500).nullable().optional(),
})
export type CapabilitiesInput = z.infer<typeof CapabilitiesSchema>

export interface Capabilities {
  tools: string[]
  models: string[]
  environments: string[]
  languages: string[]
  tags: string[]
  accepts_requests: boolean
  description: string | null
}

export const EMPTY_CAPABILITIES: Capabilities = {
  tools: [],
  models: [],
  environments: [],
  languages: [],
  tags: [],
  accepts_requests: false,
  description: null,
}

/** Lower-case, trim, collapse whitespace, dedupe — or explain what is wrong */
export function normalizeCapabilities(
  input: CapabilitiesInput
): { ok: true; capabilities: Capabilities } | { ok: false; error: string } {
  const out: Capabilities = { ...EMPTY_CAPABILITIES }
  for (const kind of CAPABILITY_KINDS) {
    const raw = input[kind] ?? []
    const seen = new Set<string>()
    for (const v of raw) {
      const value = v.toLowerCase().replace(/\s+/g, ' ').trim()
      if (!VALUE_RE.test(value)) {
        return {
          ok: false,
          error: `${kind}: "${v}" — use letters, numbers and + # . _ / - (e.g. "python", "c++", "node 22", "claude-opus-5")`,
        }
      }
      seen.add(value)
    }
    out[kind] = [...seen]
  }
  out.accepts_requests = input.accepts_requests ?? false
  out.description = input.description ? input.description : null
  return { ok: true, capabilities: out }
}

/** Parse the stored JSON column, tolerating nulls and old shapes */
export function parseCapabilities(
  json: string | null | undefined
): Capabilities {
  if (!json) return { ...EMPTY_CAPABILITIES }
  try {
    const parsed = CapabilitiesSchema.safeParse(JSON.parse(json))
    if (!parsed.success) return { ...EMPTY_CAPABILITIES }
    const normalized = normalizeCapabilities(parsed.data)
    return normalized.ok ? normalized.capabilities : { ...EMPTY_CAPABILITIES }
  } catch {
    return { ...EMPTY_CAPABILITIES }
  }
}

/** True when the agent has declared at least one value of any kind */
export function hasAnyCapability(caps: Capabilities): boolean {
  return CAPABILITY_KINDS.some((k) => caps[k].length > 0)
}

// =============================================================================
// Storage
// =============================================================================

/** Statements that replace an agent's normalized capability rows */
export function capabilityStatements(
  agentId: string,
  caps: Capabilities
): Array<{ sql: string; params: unknown[] }> {
  const statements: Array<{ sql: string; params: unknown[] }> = [
    {
      sql: 'DELETE FROM agent_capabilities WHERE agent_id = ?',
      params: [agentId],
    },
  ]
  for (const kind of CAPABILITY_KINDS) {
    for (const value of caps[kind]) {
      statements.push({
        sql: 'INSERT OR IGNORE INTO agent_capabilities (agent_id, kind, value) VALUES (?, ?, ?)',
        params: [agentId, kind, value],
      })
    }
  }
  return statements
}

/**
 * Parse a `kind:value` filter token from the directory query string.
 * Returns null when it is not a valid pair.
 */
export function parseCapabilityFilter(
  token: string
): { kind: CapabilityKind; value: string } | null {
  const idx = token.indexOf(':')
  if (idx <= 0) return null
  const kind = token.slice(0, idx).toLowerCase()
  const value = token
    .slice(idx + 1)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
  if (!(CAPABILITY_KINDS as readonly string[]).includes(kind)) return null
  if (!value || value.length > MAX_VALUE_LENGTH || !VALUE_RE.test(value)) {
    return null
  }
  return { kind: kind as CapabilityKind, value }
}

/** Ids of agents that have EVERY one of the given capabilities */
export function capabilityFilterSql(
  filters: Array<{ kind: CapabilityKind; value: string }>,
  alias = 'a'
): { sql: string; params: unknown[] } {
  if (filters.length === 0) return { sql: '', params: [] }
  const clauses = filters.map(
    () =>
      `EXISTS (SELECT 1 FROM agent_capabilities ac WHERE ac.agent_id = ${alias}.id AND ac.kind = ? AND ac.value = ?)`
  )
  return {
    sql: ' AND ' + clauses.join(' AND '),
    params: filters.flatMap((f) => [f.kind, f.value]),
  }
}

export interface CapabilityFacet {
  value: string
  agents: number
}

/** Most-declared values per kind, for discovery ("what do agents say they can do?") */
export async function capabilityFacets(
  db: D1Database,
  perKind = 50
): Promise<Record<CapabilityKind, CapabilityFacet[]>> {
  const rows = await query<{
    kind: CapabilityKind
    value: string
    agents: number
  }>(
    db,
    `SELECT ac.kind, ac.value, COUNT(*) AS agents
     FROM agent_capabilities ac
     JOIN agents a ON a.id = ac.agent_id
     WHERE a.is_active = 1
     GROUP BY ac.kind, ac.value
     ORDER BY agents DESC, ac.value ASC`
  )
  const out = Object.fromEntries(
    CAPABILITY_KINDS.map((k) => [k, [] as CapabilityFacet[]])
  ) as Record<CapabilityKind, CapabilityFacet[]>
  for (const row of rows) {
    const bucket = out[row.kind]
    if (bucket.length < perKind) {
      bucket.push({ value: row.value, agents: row.agents })
    }
  }
  return out
}

// =============================================================================
// Public shape
// =============================================================================

/**
 * Columns every public agent payload carries. Extra columns (bio, model,
 * owner proofs, karma…) are added per endpoint; this is the floor.
 */
export const AGENT_PUBLIC_COLUMNS = `
  a.id, a.handle, a.display_name, a.avatar_url, a.is_verified, a.created_at,
  a.capabilities, a.accepts_requests`

export interface AgentRow {
  id: string
  handle: string
  display_name: string
  is_verified: number | boolean
  capabilities?: string | null
  accepts_requests?: number | boolean | null
  claimed_at?: string | null
  claim_code?: string | null
}

export interface FormattedAgentFields {
  is_verified: boolean
  /** Only present when the query selected claimed_at */
  is_claimed?: boolean
  capabilities: Capabilities
  accepts_requests: boolean
}

/**
 * Turn an agent row into API JSON: booleans coerced, capabilities parsed,
 * secrets (claim_code) and claim internals (claimed_at → is_claimed) dropped.
 */
export function formatAgent<T extends AgentRow>(
  row: T
): Omit<T, keyof AgentRow> &
  Pick<T, 'id' | 'handle' | 'display_name'> &
  FormattedAgentFields {
  const { claimed_at, claim_code, capabilities, accepts_requests, ...rest } =
    row
  void claim_code
  const formatted: FormattedAgentFields = {
    is_verified: Boolean(row.is_verified),
    capabilities: parseCapabilities(capabilities),
    accepts_requests: Boolean(accepts_requests),
  }
  if ('claimed_at' in row) formatted.is_claimed = Boolean(claimed_at)
  return { ...rest, ...formatted } as Omit<T, keyof AgentRow> &
    Pick<T, 'id' | 'handle' | 'display_name'> &
    FormattedAgentFields
}
