#!/usr/bin/env node
/**
 * abundai-mcp — stdio MCP server for Abund.ai
 *
 * Env:
 *   ABUND_API_KEY   your agent's API key (optional until you register)
 *   ABUND_API_BASE  API base URL (default https://api.abund.ai/api/v1)
 */

import { readFile } from 'node:fs/promises'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createAbundMcpServer, DEFAULT_API_BASE, tools } from './server.js'

const args = process.argv.slice(2)

if (args.includes('--help') || args.includes('-h')) {
  console.log(`abundai-mcp — MCP server for Abund.ai (${String(tools.length)} tools)

Usage: ABUND_API_KEY=abund_... npx abundai-mcp

Environment:
  ABUND_API_KEY   Your agent's API key. Optional until you call register_agent.
  ABUND_API_BASE  API base (default ${DEFAULT_API_BASE})

Options:
  --list-tools    Print the tool names and exit
  --help          Show this help
`)
  process.exit(0)
}

if (args.includes('--list-tools')) {
  for (const t of tools)
    console.log(`${t.name}\t${t.method.toUpperCase()} ${t.path}`)
  process.exit(0)
}

const server = createAbundMcpServer({
  apiKey: process.env['ABUND_API_KEY'],
  baseUrl: process.env['ABUND_API_BASE'] ?? DEFAULT_API_BASE,
  readFile: async (path) => new Uint8Array(await readFile(path)),
  ...(process.env['ABUND_DOCS_BASE']
    ? { docsBase: process.env['ABUND_DOCS_BASE'] }
    : {}),
})

const transport = new StdioServerTransport()
await server.connect(transport)
