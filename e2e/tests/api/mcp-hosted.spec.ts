import { test, expect } from '../fixtures/test-setup'
import type { APIRequestContext } from '@playwright/test'

/**
 * Hosted MCP tool calls
 *
 * POST /mcp runs tools by re-entering the worker (lib/reenter.ts), which
 * forwards the caller's CF-Connecting-IP so IP rate limits stay per client.
 * Limits are off in development, so these tests cover the re-entry itself:
 * tools reach the API, with and without the caller's key.
 */

const API_ORIGIN = new URL(
  process.env.API_URL || 'http://localhost:8787/api/v1/'
).origin

interface ToolResult {
  isError?: boolean
  content: Array<{ type: string; text: string }>
  structuredContent?: Record<string, unknown>
}

async function mcp<T>(
  api: APIRequestContext,
  method: string,
  params: unknown,
  apiKey?: string
): Promise<T> {
  const res = await api.post(`${API_ORIGIN}/mcp`, {
    headers: {
      Accept: 'application/json, text/event-stream',
      'CF-Connecting-IP': '203.0.113.7',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    data: { jsonrpc: '2.0', id: 1, method, params },
  })
  expect(res.status()).toBe(200)
  const body = (await res.json()) as { result: T }
  return body.result
}

test.describe('Hosted MCP', () => {
  test('lists tools and runs them through the API as the caller', async ({
    api,
  }) => {
    const list = await mcp<{ tools: Array<{ name: string }> }>(
      api,
      'tools/list',
      {}
    )
    expect(list.tools.map((t) => t.name)).toContain('register_agent')

    // No key: registration works, key-only tools explain what is missing
    const handle = `mcp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    const registered = await mcp<ToolResult>(api, 'tools/call', {
      name: 'register_agent',
      arguments: { handle, display_name: 'Hosted MCP test' },
    })
    expect(registered.isError).toBeFalsy()
    const credentials = registered.structuredContent?.credentials as {
      api_key: string
      claim_code: string
    }
    const apiKey = credentials.api_key
    expect(apiKey).toMatch(/^abund_/)

    const noKey = await mcp<ToolResult>(api, 'tools/call', {
      name: 'get_my_status',
      arguments: {},
    })
    expect(noKey.isError).toBe(true)
    expect(noKey.content[0]?.text).toContain('No API key')

    // With the key: the call reaches the API as this agent
    const status = await mcp<ToolResult>(
      api,
      'tools/call',
      { name: 'get_my_status', arguments: { compact: true } },
      apiKey
    )
    expect(status.isError).toBeFalsy()
    // …as the agent just registered: still unclaimed, with its own claim URL
    expect(status.structuredContent?.status).toBe('pending_claim')
    expect(status.structuredContent?.claim_url).toContain(
      credentials.claim_code
    )
  })
})
