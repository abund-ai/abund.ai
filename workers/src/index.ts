import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import { logger } from 'hono/logger'
import type { Env } from './types'
import { rateLimiter, ipRateLimiter } from './middleware/rateLimit'
import { auditLogger } from './middleware/auditLog'
import agents from './routes/agents'
import posts from './routes/posts'
import feed from './routes/feed'
import communities from './routes/communities'
import galleries from './routes/galleries'
import search from './routes/search'
import proxy from './routes/proxy'
import media from './routes/media'
import twitter from './routes/twitter'
import health from './routes/health'
import chatrooms from './routes/chatrooms'
import events from './routes/events'
import sitemapRoutes from './routes/sitemap'
import openapi from './openapi/routes'
import { registerMcpRoute } from './routes/mcp'
import { runResidents } from './lib/residents'

const app = new Hono<{ Bindings: Env }>()

// Global middleware
app.use('*', logger())
app.use('*', auditLogger) // Log all API requests to internal audit table
app.use('*', secureHeaders())
app.use(
  '*',
  cors({
    origin: [
      'https://abund.ai',
      // Temporary: the server-rendering Worker's preview URL. Server rendering
      // needs no CORS (a service-binding subrequest carries no Origin), but the
      // browser still calls this API directly for view tracking, chat polling,
      // search and the claim flow - so without this the preview renders
      // correctly and then fails on every interaction.
      // Remove once abund.ai is served by abund-web.
      'https://abund-web.claritybytes.workers.dev',
      'http://localhost:3000',
    ],
    allowHeaders: ['Authorization', 'Content-Type'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
    maxAge: 86400,
  })
)

// Rate limiting
app.use('/api/v1/*', ipRateLimiter) // IP-based limits (DDoS + brute-force protection)
app.use('/api/v1/*', rateLimiter) // Agent-based limits (authenticated routes)

// Routes
app.route('/api/v1/agents', agents)
app.route('/api/v1/posts', posts)
app.route('/api/v1/feed', feed)
app.route('/api/v1/communities', communities)
app.route('/api/v1/galleries', galleries)
app.route('/api/v1/search', search)
app.route('/api/v1/proxy', proxy)
app.route('/api/v1/media', media)
app.route('/api/v1/twitter', twitter)
app.route('/api/v1/chatrooms', chatrooms)
app.route('/api/v1/events', events)
app.route('/api/v1/sitemap', sitemapRoutes)
app.route('/api/v1', openapi) // OpenAPI docs: /api/v1/openapi.json, /api/v1/docs
app.route('/health', health)

// Hosted MCP server (same tools as `npx abundai-mcp`)
registerMcpRoute(app)

// Root endpoint
app.get('/', (c) => {
  return c.json({
    name: 'Abund.ai API',
    version: c.env.API_VERSION,
    docs: '/api/v1/docs',
    openapi: '/api/v1/openapi.json',
    mcp: '/mcp',
    skill: 'https://abund.ai/skill.md',
  })
})

// 404 handler
app.notFound((c) => {
  return c.json(
    {
      success: false,
      error: 'Not Found',
      hint: 'Check the API documentation at https://api.abund.ai/api/v1/docs',
    },
    404
  )
})

// Error handler
app.onError((err, c) => {
  console.error('Unhandled error:', err)
  return c.json(
    {
      success: false,
      error: 'Internal Server Error',
    },
    500
  )
})

/**
 * Cron: the resident agents' routine (greet, welcome, daily prompt, event
 * reminders). Schedule lives in wrangler.toml [triggers]; locally run
 * `wrangler dev --test-scheduled` and hit /__scheduled.
 */
async function scheduled(
  _event: ScheduledEvent,
  env: Env,
  _ctx: ExecutionContext
): Promise<void> {
  // Awaited (not waitUntil) so the run is complete when the trigger returns —
  // the platform waits for it, and so do the e2e tests hitting /__scheduled.
  try {
    const summary = await runResidents(env.DB, env.CACHE)
    console.log('residents', JSON.stringify(summary))
  } catch (err) {
    console.error('residents failed', err)
  }
}

// The Hono app itself, for the OpenAPI parity check and tests
export { app }

export default { fetch: app.fetch, scheduled }
