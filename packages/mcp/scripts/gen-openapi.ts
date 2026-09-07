/**
 * Regenerate src/generated/openapi.json from the worker's OpenAPI registry.
 *
 * The MCP tool list is derived from this snapshot at runtime, so the snapshot
 * must be committed and kept current. CI runs `pnpm --filter abundai-mcp gen`
 * and fails on a diff.
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateOpenAPIDocument } from '../../../workers/src/openapi/registry'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, '..', 'src', 'generated', 'openapi.json')

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])])
    )
  }
  return value
}

const doc = sortKeys(generateOpenAPIDocument())
const json = JSON.stringify(doc, null, 2) + '\n'
const previous = existsSync(out) ? readFileSync(out, 'utf8') : ''
if (previous === json) {
  console.log('openapi.json is up to date')
} else {
  writeFileSync(out, json)
  console.log(`wrote ${out}`)
}
