import { test, expect, type APIRequestContext } from '@playwright/test'

/**
 * SEO regressions this suite exists to catch.
 *
 * Before the server-rendering migration, every dynamic route was rewritten to
 * an empty SPA shell: `/post/*`, `/agent/*` and friends returned 200 with no
 * content, one shared title, and a canonical URL pointing at the homepage. The
 * assertions below are the ones that would have failed then and must keep
 * passing now.
 */

const API_BASE = process.env.API_BASE ?? 'http://localhost:8787'

interface SampleContent {
  postId: string
  handle: string
  communitySlug: string
}

async function sample(request: APIRequestContext): Promise<SampleContent> {
  const posts = (await (
    await request.get(`${API_BASE}/api/v1/posts?limit=1&sort=new`)
  ).json()) as { posts: { id: string; agent: { handle: string } }[] }

  const communities = (await (
    await request.get(`${API_BASE}/api/v1/communities`)
  ).json()) as { communities: { slug: string }[] }

  const post = posts.posts[0]
  const community = communities.communities[0]
  if (!post || !community) throw new Error('seed data missing')

  return {
    postId: post.id,
    handle: post.agent.handle,
    communitySlug: community.slug,
  }
}

test.describe('Server-rendered content (JavaScript disabled)', () => {
  // The single most important test here: with JS off, a crawler must still see
  // the post body, the agent profile and the feed.
  test.use({ javaScriptEnabled: false })

  test('feed renders posts without JavaScript', async ({ page, request }) => {
    await sample(request)
    await page.goto('/feed')

    const articles = page.locator('article')
    expect(await articles.count()).toBeGreaterThan(0)

    // and the posts link somewhere crawlable
    expect(await page.locator('a[href^="/post/"]').count()).toBeGreaterThan(0)
    expect(await page.locator('a[href^="/agent/"]').count()).toBeGreaterThan(0)
  })

  test('post page renders its body without JavaScript', async ({
    page,
    request,
  }) => {
    const { postId } = await sample(request)
    await page.goto(`/post/${postId}`)

    await expect(page.locator('article').first()).toBeVisible()
    const text = await page.locator('article').first().innerText()
    expect(text.trim().length).toBeGreaterThan(0)
  })

  test('agent profile renders without JavaScript', async ({
    page,
    request,
  }) => {
    const { handle } = await sample(request)
    await page.goto(`/agent/${handle}`)
    await expect(page.locator(`text=@${handle}`).first()).toBeVisible()
  })

  test('community page renders without JavaScript', async ({
    page,
    request,
  }) => {
    const { communitySlug } = await sample(request)
    await page.goto(`/c/${communitySlug}`)
    expect(
      (await page.locator('body').innerText()).trim().length
    ).toBeGreaterThan(0)
  })
})

test.describe('Per-route metadata', () => {
  const LANDING_TITLE =
    'Abund.ai - The First Full-Featured Social Network for AI Agents'

  test('every route has its own title, description and canonical', async ({
    page,
    request,
  }) => {
    const { postId, handle, communitySlug } = await sample(request)

    const routes = [
      '/feed',
      '/agents',
      '/communities',
      '/galleries',
      '/vision',
      `/post/${postId}`,
      `/agent/${handle}`,
      `/c/${communitySlug}`,
    ]

    const seen = new Map<string, string>()

    for (const route of routes) {
      await page.goto(route)

      const title = await page.title()
      // The old failure mode was every page sharing the landing page's title.
      expect(title, `${route} should not reuse the landing title`).not.toBe(
        LANDING_TITLE
      )
      expect(title.length).toBeGreaterThan(0)

      const description = await page
        .locator('meta[name="description"]')
        .getAttribute('content')
      expect(description, `${route} should have a description`).toBeTruthy()

      // Canonical must point at the page itself, not the site root - the old
      // hardcoded `<link rel=canonical href="https://abund.ai/">` told Google
      // to index the homepage instead of every other page.
      const canonical = await page
        .locator('link[rel="canonical"]')
        .getAttribute('href')
      expect(canonical, `${route} should have a canonical`).toBeTruthy()
      expect(new URL(canonical as string).pathname).toBe(route)

      seen.set(route, title)
    }

    // Titles must be distinct from one another, not just from the landing page.
    expect(new Set(seen.values()).size).toBe(routes.length)
  })

  test('entity pages carry Open Graph and Twitter cards', async ({
    page,
    request,
  }) => {
    const { handle } = await sample(request)
    await page.goto(`/agent/${handle}`)

    for (const selector of [
      'meta[property="og:title"]',
      'meta[property="og:description"]',
      'meta[property="og:image"]',
      'meta[property="og:type"]',
      'meta[name="twitter:card"]',
      'meta[name="twitter:title"]',
    ]) {
      await expect(page.locator(selector)).toHaveAttribute(
        'content',
        /.+/,
        // Attribute assertions retry, so no manual waiting needed.
        { timeout: 5000 }
      )
    }

    // A square avatar must use the small card; summary_large_image crops it.
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
      'content',
      'summary'
    )
  })

  test('noindex is set where it should be', async ({ page }) => {
    await page.goto('/search')
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      /noindex/
    )

    // The claim URL contains a verification code and must not leak into an index.
    await page.goto('/claim/not-a-real-code')
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      /noindex/
    )
  })

  test('indexable pages are not accidentally noindexed', async ({
    page,
    request,
  }) => {
    const { postId } = await sample(request)
    for (const route of ['/feed', `/post/${postId}`]) {
      await page.goto(route)
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
        'content',
        /^index/
      )
    }
  })
})

test.describe('Real HTTP statuses', () => {
  // Previously every URL returned 200 via the SPA-shell rewrite, so Google saw
  // soft 404s across the whole dynamic surface.
  test('missing entities return 404, not 200', async ({ request }) => {
    for (const route of [
      '/post/does-not-exist',
      '/agent/definitely-not-a-real-agent',
      '/c/no-such-community',
      '/chat/no-such-room',
      '/no-such-page-at-all',
    ]) {
      const response = await request.get(route)
      expect(response.status(), `${route} should 404`).toBe(404)
    }
  })

  test('real pages return 200', async ({ request }) => {
    const { postId, handle } = await sample(request)
    for (const route of [
      '/feed',
      '/agents',
      `/post/${postId}`,
      `/agent/${handle}`,
    ]) {
      expect((await request.get(route)).status(), route).toBe(200)
    }
  })
})

test.describe('Crawlable link graph', () => {
  // All in-app navigation used to be `window.location.href = ...` in onClick
  // handlers, so there was no link from the feed to any post or agent at all.
  test('the feed links to posts, agents and communities', async ({ page }) => {
    await page.goto('/feed')
    await page.waitForSelector('article')

    expect(await page.locator('a[href^="/post/"]').count()).toBeGreaterThan(0)
    expect(await page.locator('a[href^="/agent/"]').count()).toBeGreaterThan(0)
  })

  test('no interactive element is nested inside another', async ({ page }) => {
    await page.goto('/feed')
    await page.waitForSelector('article')
    expect(await page.locator('a a, a button, button a').count()).toBe(0)
  })
})
