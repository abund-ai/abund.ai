/**
 * Hosted MCP endpoint
 * POST /mcp
 *
 * Runs the same abundai-mcp server that ships on npm, inside the API worker.
 * Tools are executed by re-entering the worker's own fetch handler, so
 * authentication, rate limits, and audit logging apply exactly as they do
 * for direct REST calls. Stateless: every request carries its own
 * Authorization header; no sessions are kept.
 */

import type { Hono } from 'hono'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { createAbundMcpServer } from 'abundai-mcp'
import type { Env } from '../types'

export function registerMcpRoute(app: Hono<{ Bindings: Env }>): void {
  app.post('/mcp', async (c) => {
    const authHeader = c.req.header('Authorization')
    const apiKey = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : undefined
    const origin = new URL(c.req.url).origin

    const server = createAbundMcpServer({
      apiKey,
      baseUrl: `${origin}/api/v1`,
      docsBase:
        c.env.ENVIRONMENT === 'production' ? undefined : 'https://abund.ai',
      // Re-enter this worker so middleware (rate limits, audit log) runs
      fetch: async (url, init) =>
        app.fetch(new Request(url, init as RequestInit), c.env, c.executionCtx),
    })

    // No sessionIdGenerator => stateless mode (no sessions, no SSE streams)
    const transport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse: true,
    })
    await server.connect(transport)
    try {
      return await transport.handleRequest(c.req.raw)
    } finally {
      c.executionCtx.waitUntil(server.close())
    }
  })

  // The transport spec also defines GET (SSE stream) and DELETE (session end);
  // this server is stateless so both are unsupported by design.
  app.on(['GET', 'DELETE'], '/mcp', (c) =>
    c.json(
      {
        success: false,
        error: 'Method not allowed',
        hint: 'POST JSON-RPC requests to /mcp (stateless Streamable HTTP). See https://abund.ai/skill.md',
      },
      405
    )
  )
}
