/**
 * Spawns the built CLI over stdio and talks to it with the official client.
 * Network calls only run when API_URL points at a live API (CI e2e job).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const here = dirname(fileURLToPath(import.meta.url))
const cli = join(here, '..', 'dist', 'cli.js')
const apiUrl = process.env['API_URL']

async function connect(env = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cli],
    env: { ...process.env, ...env },
  })
  const client = new Client({ name: 'abundai-mcp-smoke', version: '0.0.0' })
  await client.connect(transport)
  return client
}

test('stdio server lists tools, resources and prompts', async () => {
  const client = await connect()
  try {
    const { tools } = await client.listTools()
    assert.ok(tools.length >= 80, `got ${tools.length} tools`)
    assert.ok(tools.every((t) => t.inputSchema.type === 'object'))
    const { resources } = await client.listResources()
    assert.deepEqual(
      resources.map((r) => r.uri).sort(),
      ['abund://heartbeat.md', 'abund://skill.md']
    )
    const { prompts } = await client.listPrompts()
    assert.equal(prompts[0]?.name, 'heartbeat')
    const prompt = await client.getPrompt({ name: 'heartbeat' })
    assert.ok(prompt.messages.length === 1)
  } finally {
    await client.close()
  }
})

test('auth-required tool without a key returns a helpful error, not a crash', async () => {
  const client = await connect({ ABUND_API_KEY: '' })
  try {
    const result = await client.callTool({ name: 'get_my_status', arguments: {} })
    assert.equal(result.isError, true)
    const text = result.content[0]?.text ?? ''
    assert.match(text, /No API key configured/)
  } finally {
    await client.close()
  }
})

test('calls the live API when API_URL is set', { skip: !apiUrl }, async () => {
  const client = await connect({ ABUND_API_BASE: apiUrl })
  try {
    const health = await client.callTool({ name: 'health', arguments: {} })
    assert.equal(health.isError, false)
    const feed = await client.callTool({ name: 'get_global_feed', arguments: { limit: '1' } })
    assert.equal(feed.isError, false)
    const structured = feed.structuredContent
    assert.equal(structured.success, true)
    assert.ok(Array.isArray(structured.posts))

    // Auth error from the API is surfaced verbatim (hint included)
    const bad = await connect({ ABUND_API_BASE: apiUrl, ABUND_API_KEY: 'abund_000000000000000000000000000000ff' })
    try {
      const me = await bad.callTool({ name: 'get_my_profile', arguments: {} })
      assert.equal(me.isError, true)
      const text = me.content[0]?.text ?? ''
      assert.match(text, /HTTP 401/)
    } finally {
      await bad.close()
    }
  } finally {
    await client.close()
  }
})
