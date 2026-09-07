/**
 * OpenAPI <-> Hono route parity check
 *
 * Every route the worker actually serves must be documented in the OpenAPI
 * registry (and therefore visible to the MCP server, which is generated from
 * it), and every documented route must exist. Dev-only and system routes are
 * allowlisted below.
 *
 * Run: pnpm --filter @abund/workers test:parity
 */

import app from '../src/index'
import { generateOpenAPIDocument } from '../src/openapi/registry'

// Routes that intentionally stay out of the public spec
const ALLOWLIST = new Set([
  'GET /',
  'GET /api/v1/openapi.json',
  'GET /api/v1/openapi.yaml',
  'GET /api/v1/docs',
  'GET /api/v1/media/serve/*',
  'POST /api/v1/agents/test-claim/{code}',
  'POST /api/v1/agents/test-set-bypass',
  // MCP transport endpoint (JSON-RPC, not a REST operation)
  'POST /mcp',
  'GET /mcp',
  'DELETE /mcp',
])

function normalize(path: string): string {
  return path.replace(/:(\w+)/g, '{$1}')
}

const implemented = new Set<string>()
for (const route of app.routes) {
  if (route.method === 'ALL') continue // middleware
  implemented.add(`${route.method} ${normalize(route.path)}`)
}

const doc = generateOpenAPIDocument()
const documented = new Set<string>()
const problems: string[] = []
const operationIds = new Map<string, string>()

for (const [path, item] of Object.entries(doc.paths ?? {})) {
  for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
    const op = (item as Record<string, unknown>)[method] as
      | { operationId?: string; 'x-internal'?: boolean }
      | undefined
    if (!op) continue
    const key = `${method.toUpperCase()} ${path}`
    documented.add(key)
    if (!op.operationId) {
      problems.push(`missing operationId: ${key}`)
    } else if (operationIds.has(op.operationId)) {
      problems.push(
        `duplicate operationId "${op.operationId}": ${key} and ${operationIds.get(op.operationId)}`
      )
    } else {
      operationIds.set(op.operationId, key)
    }
  }
}

for (const key of implemented) {
  if (ALLOWLIST.has(key)) continue
  if (!documented.has(key))
    problems.push(`implemented but not in OpenAPI: ${key}`)
}
for (const key of documented) {
  if (!implemented.has(key))
    problems.push(`in OpenAPI but not implemented: ${key}`)
}

if (problems.length > 0) {
  console.error(`OpenAPI parity check failed (${problems.length} problem(s)):`)
  for (const p of problems.sort()) console.error(`  - ${p}`)
  process.exit(1)
}

console.log(
  `OpenAPI parity OK: ${documented.size} documented operations match ${implemented.size - [...implemented].filter((k) => ALLOWLIST.has(k)).length} implemented routes`
)
