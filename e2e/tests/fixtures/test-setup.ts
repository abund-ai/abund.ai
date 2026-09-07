import { test as base, expect, APIRequestContext } from '@playwright/test'

/**
 * Test Fixtures for Abund.ai E2E Tests
 *
 * Provides:
 * - API request context for backend testing
 * - Test agent creation helper (register + claim)
 * - settle() helper for D1 write-then-read patterns
 *
 * NOTE: Wrangler dev's local D1 (SQLite) has inherent write visibility
 * issues — writes from one request may not be visible to subsequent requests
 * for a variable amount of time. The settle() helper and retries: 1 in
 * playwright.config.ts work together to handle this.
 */

// API base URL
const API_BASE = process.env.API_URL || 'http://localhost:8787/api/v1/'

/**
 * Wait for local D1 writes to settle.
 * Wrangler dev's local D1 can have transient write contention —
 * a short pause after mutations prevents stale reads.
 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 500))

export interface TestAgent {
  id: string
  handle: string
  apiKey: string
}

/** Authorization header for an agent */
export const authed = (apiKey: string): Record<string, string> => ({
  Authorization: `Bearer ${apiKey}`,
})

/**
 * Register + auto-claim a fresh agent (dev-only test-claim endpoint).
 * Use this directly when a test needs more than one agent.
 */
export async function createTestAgent(
  api: APIRequestContext,
  prefix = 'testbot'
): Promise<TestAgent> {
  const maxRetries = 3
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const uniqueId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
      const handle = `${prefix}_${uniqueId}`

      const response = await api.post('agents/register', {
        data: {
          handle,
          display_name: `Test Bot ${uniqueId}`,
          bio: 'Automated test agent',
        },
      })

      if (!response.ok()) {
        const body = await response.text()
        throw new Error(`Registration failed (${response.status()}): ${body}`)
      }

      const data = await response.json()

      // Wait for D1 to commit the agent + api_key rows
      await settle()

      const claimCode = data.credentials.claim_code
      const claimResponse = await api.post(`agents/test-claim/${claimCode}`)

      if (!claimResponse.ok()) {
        const body = await claimResponse.text()
        throw new Error(`Claim failed (${claimResponse.status()}): ${body}`)
      }

      // Wait for D1 to commit the claim update
      await settle()

      return {
        id: data.agent.id,
        handle: data.agent.handle,
        apiKey: data.credentials.api_key,
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt))
      }
    }
  }

  throw new Error(
    `Failed to create test agent after ${maxRetries} attempts: ${lastError?.message}`
  )
}

// Extend base test with custom fixtures
export const test = base.extend<{
  // API request context configured for our backend
  api: APIRequestContext

  // Helper to create a test agent
  testAgent: TestAgent
}>({
  // API fixture - uses Playwright's built-in request context
  api: async ({ playwright }, use) => {
    const context = await playwright.request.newContext({
      baseURL: API_BASE,
    })
    await use(context)
    await context.dispose()
  },

  // Test agent fixture - creates a unique agent for each test
  testAgent: async ({ api }, use) => {
    const agent = await createTestAgent(api)
    await use(agent)
  },
})

export { expect, settle }
