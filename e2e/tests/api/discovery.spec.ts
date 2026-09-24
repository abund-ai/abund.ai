import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test, expect } from '../fixtures/test-setup'

/**
 * Agent Discovery Tests
 *
 * https://abund.ai/.well-known/ai-catalog.json (AI Catalog 1.0) lists the
 * hosted MCP server's Server Card (served by the API at /mcp/server-card),
 * the A2A agent card, the skill guide and the OpenAPI spec. The two
 * .well-known files are static assets of the web app, so they are checked
 * from disk; the Server Card is checked live.
 */

// Tests run from the e2e/ directory; the static files live in the frontend package
const PUBLIC_DIR = path.resolve(process.cwd(), '../frontend/public')

function readPublicJson<T>(relative: string): T {
  return JSON.parse(readFileSync(path.join(PUBLIC_DIR, relative), 'utf8')) as T
}

const API_ORIGIN = new URL(
  process.env.API_URL || 'http://localhost:8787/api/v1/'
).origin

interface CatalogEntry {
  identifier: string
  type: string
  url?: string
  data?: unknown
}

interface ServerCard {
  $schema: string
  name: string
  version: string
  description: string
  remotes: Array<{ type: string; url: string }>
}

test.describe('MCP Server Card', () => {
  test('is served with its media type and required fields', async ({ api }) => {
    const response = await api.get(`${API_ORIGIN}/mcp/server-card`)
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toBe(
      'application/mcp-server-card+json'
    )
    expect(response.headers()['access-control-allow-origin']).toBe('*')

    const card = (await response.json()) as ServerCard
    expect(card.$schema).toBe(
      'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json'
    )
    expect(card.name).toMatch(/^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/)
    expect(card.description.length).toBeLessThanOrEqual(100)
    expect(card.remotes[0]).toMatchObject({
      type: 'streamable-http',
      url: `${API_ORIGIN}/mcp`,
    })
  })

  test('version matches the serverInfo the MCP endpoint reports', async ({
    api,
  }) => {
    const card = (await (
      await api.get(`${API_ORIGIN}/mcp/server-card`)
    ).json()) as ServerCard

    const init = await api.post(`${API_ORIGIN}/mcp`, {
      headers: { Accept: 'application/json, text/event-stream' },
      data: {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'e2e', version: '0' },
        },
      },
    })
    expect(init.status()).toBe(200)
    const body = (await init.json()) as {
      result: { serverInfo: { version: string } }
    }
    expect(card.version).toBe(body.result.serverInfo.version)
  })
})

test.describe('Static discovery documents', () => {
  test('ai-catalog.json is a valid AI Catalog that lists the cards', () => {
    const catalog = readPublicJson<{
      specVersion: string
      host: { displayName: string }
      entries: CatalogEntry[]
    }>('.well-known/ai-catalog.json')

    expect(catalog.specVersion).toBe('1.0')
    expect(catalog.host.displayName).toBeTruthy()

    const ids = new Set<string>()
    for (const entry of catalog.entries) {
      expect(entry.identifier).toMatch(/^urn:air:abund\.ai:/)
      expect(ids.has(entry.identifier), entry.identifier).toBe(false)
      ids.add(entry.identifier)
      expect(entry.type).toBeTruthy()
      // Exactly one of url / data
      expect(
        (entry.url === undefined) !== (entry.data === undefined),
        entry.identifier
      ).toBe(true)
    }

    const byType = (type: string) =>
      catalog.entries.find((e) => e.type === type)?.url
    expect(byType('application/mcp-server-card+json')).toBe(
      'https://api.abund.ai/mcp/server-card'
    )
    expect(byType('application/a2a-agent-card+json')).toBe(
      'https://abund.ai/.well-known/agent-card.json'
    )
  })

  test('agent-card.json has the A2A 1.0 required fields and the skill version', () => {
    const card = readPublicJson<Record<string, unknown>>(
      '.well-known/agent-card.json'
    )
    const skill = readPublicJson<{ version: string }>('skill.json')

    for (const field of [
      'name',
      'description',
      'supportedInterfaces',
      'version',
      'capabilities',
      'defaultInputModes',
      'defaultOutputModes',
      'skills',
    ]) {
      expect(card[field], field).toBeDefined()
    }
    expect(card.version).toBe(skill.version)

    const interfaces = card.supportedInterfaces as Array<Record<string, string>>
    expect(interfaces.length).toBeGreaterThan(0)
    for (const iface of interfaces) {
      expect(iface.url).toMatch(/^https:\/\//)
      expect(iface.protocolBinding).toBeTruthy()
      expect(iface.protocolVersion).toBeTruthy()
    }

    const skills = card.skills as Array<Record<string, unknown>>
    for (const s of skills) {
      expect(s.id).toBeTruthy()
      expect(s.name).toBeTruthy()
      expect(s.description).toBeTruthy()
      expect(Array.isArray(s.tags) && s.tags.length > 0, String(s.id)).toBe(
        true
      )
    }
  })
})
