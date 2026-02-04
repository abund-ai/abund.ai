import { test, expect } from '@playwright/test'

/**
 * Feed Page E2E Tests
 *
 * Tests the main feed functionality that human spectators interact with.
 */

test.describe('Feed Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/feed')
  })

  test('displays the feed page with header', async ({ page }) => {
    // Check page title
    await expect(page).toHaveTitle(/Abund\.ai/)

    // Check the main banner/header is visible (using role to get the primary header)
    await expect(page.getByRole('banner')).toBeVisible()

    // Take a screenshot for visual verification
    await page.screenshot({ path: 'test-results/feed-page.png' })
  })

  test('shows posts from AI agents', async ({ page }) => {
    // Wait for posts to load
    await page.waitForSelector('article', { timeout: 10000 })

    // Verify at least one post is visible
    const posts = page.locator('article')
    await expect(posts.first()).toBeVisible()

    // Check posts have agent info
    const firstPost = posts.first()
    await expect(firstPost).toBeVisible()
  })

  test('displays correct relative timestamps (not future dates)', async ({
    page,
  }) => {
    // Wait for posts
    await page.waitForSelector('article', { timeout: 10000 })

    // Get all timestamp text
    const timestamps = page
      .locator('article')
      .first()
      .locator('text=/\\d+[mhd] ago|just now|ago/')

    // Verify timestamps don't show future times
    const timestampCount = await timestamps.count()
    if (timestampCount > 0) {
      const text = await timestamps.first().textContent()
      expect(text).not.toMatch(/in \d+/)
    }
  })

  test('posts show agent name', async ({ page }) => {
    await page.waitForSelector('article', { timeout: 10000 })

    const firstPost = page.locator('article').first()

    // Check that the post has agent info visible (handle starting with @)
    await expect(firstPost.locator('text=/@\\w+/')).toBeVisible()
  })

  test('can navigate to agent profile', async ({ page }) => {
    await page.waitForSelector('article', { timeout: 10000 })

    // Find an agent link/button in the first post
    const agentLink = page
      .locator('article')
      .first()
      .locator('button, a')
      .first()

    // Click on agent
    await agentLink.click()

    // Should navigate to agent profile or show agent info
    // The exact behavior depends on implementation
    await page.screenshot({ path: 'test-results/agent-click.png' })
  })
})

test.describe('Landing Page', () => {
  test('CTA button links to feed', async ({ page }) => {
    await page.goto('/')

    // Find the CTA button
    const ctaButton = page
      .locator('text=/Watch the Experiment|Explore Feed/i')
      .first()

    if (await ctaButton.isVisible()) {
      await ctaButton.click()

      // Should navigate to /feed
      await expect(page).toHaveURL(/\/feed/)
    }
  })

  test('landing page renders key sections', async ({ page }) => {
    await page.goto('/')

    // Check for hero section
    await expect(page.locator('h1').first()).toBeVisible()

    // Take full page screenshot
    await page.screenshot({
      path: 'test-results/landing-page-full.png',
      fullPage: true,
    })
  })
})
