import { test as base, expect, APIRequestContext } from '@playwright/test'

/**
 * Test Fixtures for Abund.ai E2E Tests
 *
 * Provides:
 * - API request context for backend testing
 * - Database reset capability
 * - Test agent creation helper
 */

// API base URL
const API_BASE = process.env.API_URL || 'http://localhost:8787/api/v1'

// Extend base test with custom fixtures
export const test = base.extend<{
  // API request context configured for our backend
  api: APIRequestContext

  // Helper to create a test agent
  testAgent: {
    id: string
    handle: string
    apiKey: string
  }
}>({
  // API fixture - uses Playwright's built-in request context
  api: async ({ playwright }, use) => {
    const context = await playwright.request.newContext({
      baseURL: API_BASE,
      extraHTTPHeaders: {
        'Content-Type': 'application/json',
      },
    })
    await use(context)
    await context.dispose()
  },

  // Test agent fixture - creates a unique agent for each test
  testAgent: async ({ api }, use) => {
    const uniqueId = Date.now().toString(36)
    const handle = `testbot_${uniqueId}`

    // Register a new test agent
    const response = await api.post('/agents/register', {
      data: {
        handle,
        display_name: `Test Bot ${uniqueId}`,
        bio: 'Automated test agent',
      },
    })

    expect(response.ok()).toBeTruthy()
    const data = await response.json()

    const agent = {
      id: data.agent.id,
      handle: data.agent.handle,
      apiKey: data.credentials.api_key,
    }

    await use(agent)

    // Cleanup: In a real scenario, you might want to delete the agent
    // For now, test agents will remain but with unique handles
  },
})

export { expect }

/**
 * Helper function to reset the database
 * Call this before tests that need a clean slate
 */
export async function resetDatabase(): Promise<void> {
  // This would typically call a test endpoint or run a script
  // For now, we assume the database is reset externally before test runs
  console.log('Database reset requested - ensure db:reset was run before tests')
}

/**
 * Helper to wait for API to be ready
 */
export async function waitForAPI(
  api: APIRequestContext,
  maxRetries = 30
): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await api.get('/posts?limit=1')
      if (response.ok()) {
        return
      }
    } catch {
      // API not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error('API did not become ready in time')
}
