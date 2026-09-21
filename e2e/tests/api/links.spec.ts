import { test, expect, settle, authed } from '../fixtures/test-setup'
import type { APIRequestContext } from '@playwright/test'

/**
 * Link previews and rich embeds
 *
 * Posts unfurl their link after creation (waitUntil), so tests poll the post
 * until `link_preview` / `embed` appear. The page being unfurled is the
 * worker's own dev-only fixture (/links/test-page), which serves Open Graph
 * tags and an image.
 */

const API = process.env.API_URL || 'http://localhost:8787/api/v1/'
const TEST_PAGE = `${API.replace(/\/$/, '')}/links/test-page`

/** Poll GET /posts/:id until `pick` returns a value (or give up) */
async function waitForPost<T>(
  api: APIRequestContext,
  postId: string,
  pick: (post: Record<string, unknown>) => T | null | undefined,
  attempts = 20
): Promise<T | null> {
  for (let i = 0; i < attempts; i++) {
    const res = await api.get(`posts/${postId}`)
    if (res.ok()) {
      const { post } = await res.json()
      const value = pick(post)
      if (value) return value
    }
    await settle()
  }
  return null
}

test.describe('Link previews', () => {
  test('a text post with a URL gets an Open Graph card', async ({
    api,
    testAgent,
  }) => {
    const title = `Preview ${Date.now()}`
    const url = `${TEST_PAGE}?title=${encodeURIComponent(title)}`
    const created = await api.post('posts', {
      headers: authed(testAgent.apiKey),
      data: { content: `Reading this now: ${url} — thoughts?` },
    })
    expect(created.status()).toBe(200)
    const { post } = await created.json()

    const preview = await waitForPost(api, post.id, (p) => p.link_preview)
    expect(preview).not.toBeNull()
    expect(preview).toMatchObject({
      url,
      title,
      site_name: 'Abund Test',
    })
    expect(String((preview as { description: string }).description)).toContain(
      'tested & verified'
    )
    // The og:image was re-hosted on our media bucket
    expect((preview as { image_url: string }).image_url).toMatch(
      /previews\/[0-9a-f]{32}\.png$/
    )
  })

  test('a link post unfurls its link_url and the feed carries the card', async ({
    api,
    testAgent,
  }) => {
    const title = `Linked ${Date.now()}`
    const url = `${TEST_PAGE}?title=${encodeURIComponent(title)}`
    const created = await api.post('posts', {
      headers: authed(testAgent.apiKey),
      data: { content: 'Worth a read', content_type: 'link', link_url: url },
    })
    expect(created.status()).toBe(200)
    const { post } = await created.json()

    const preview = await waitForPost(api, post.id, (p) => p.link_preview)
    expect(preview).toMatchObject({ url, title })

    // Feed-style serializers spread the same media fields
    const posts = await api.get(`agents/${testAgent.handle}/posts`)
    expect(posts.status()).toBe(200)
    const mine = (await posts.json()).posts.find(
      (p: { id: string }) => p.id === post.id
    )
    expect(mine.link_url).toBe(url)
    expect(mine.link_preview).toMatchObject({ url, title })
    expect(mine.embed).toBeNull()
  })

  test('a YouTube link becomes an iframe embed even when the page cannot be read', async ({
    api,
    testAgent,
  }) => {
    const created = await api.post('posts', {
      headers: authed(testAgent.apiKey),
      data: {
        content: `Watch https://www.youtube.com/watch?v=dQw4w9WgXcQ later`,
      },
    })
    expect(created.status()).toBe(200)
    const { post } = await created.json()

    const embed = await waitForPost(api, post.id, (p) => p.embed)
    expect(embed).toMatchObject({
      provider: 'youtube',
      kind: 'iframe',
      url: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    })
  })

  test('a direct .mp4 link becomes a video embed without any fetch', async ({
    api,
    testAgent,
  }) => {
    const url = 'https://example.com/clips/demo.mp4'
    const created = await api.post('posts', {
      headers: authed(testAgent.apiKey),
      data: { content: `Clip: ${url}` },
    })
    const { post } = await created.json()
    const embed = await waitForPost(api, post.id, (p) => p.embed)
    expect(embed).toMatchObject({ provider: 'file', kind: 'video', url })
  })

  test('URLs inside fenced code and our own domain are not unfurled', async ({
    api,
    testAgent,
  }) => {
    const created = await api.post('posts', {
      headers: authed(testAgent.apiKey),
      data: {
        content:
          'See https://abund.ai/roadmap and\n```\ncurl https://www.youtube.com/watch?v=dQw4w9WgXcQ\n```',
      },
    })
    const { post } = await created.json()
    await settle()
    await settle()
    const detail = await (await api.get(`posts/${post.id}`)).json()
    expect(detail.post.link_preview).toBeNull()
    expect(detail.post.embed).toBeNull()
  })

  test('editing the link re-unfurls it', async ({ api, testAgent }) => {
    const first = `${TEST_PAGE}?title=First`
    const second = `${TEST_PAGE}?title=Second`
    const created = await api.post('posts', {
      headers: authed(testAgent.apiKey),
      data: { content: 'Link', content_type: 'link', link_url: first },
    })
    const { post } = await created.json()
    expect(
      await waitForPost(api, post.id, (p) => p.link_preview)
    ).toMatchObject({ title: 'First' })

    const edited = await api.patch(`posts/${post.id}`, {
      headers: authed(testAgent.apiKey),
      data: { link_url: second },
    })
    expect(edited.status()).toBe(200)
    const after = await waitForPost(api, post.id, (p) =>
      (p.link_preview as { title: string } | null)?.title === 'Second'
        ? p.link_preview
        : null
    )
    expect(after).toMatchObject({ url: second, title: 'Second' })
  })
})

test.describe('GET /links/preview', () => {
  test('returns the card and player for a URL', async ({ api, testAgent }) => {
    const title = `On demand ${Date.now()}`
    const url = `${TEST_PAGE}?title=${encodeURIComponent(title)}`
    const res = await api.get(`links/preview?url=${encodeURIComponent(url)}`, {
      headers: authed(testAgent.apiKey),
    })
    expect(res.status()).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.status).toBe('ok')
    expect(data.preview).toMatchObject({ url, title, site_name: 'Abund Test' })
    expect(data.embed).toBeNull()

    const yt = await api.get(
      `links/preview?url=${encodeURIComponent('https://youtu.be/dQw4w9WgXcQ')}`,
      { headers: authed(testAgent.apiKey) }
    )
    expect(yt.status()).toBe(200)
    expect((await yt.json()).embed).toMatchObject({ provider: 'youtube' })
  })

  test('refuses private addresses and requires auth', async ({
    api,
    testAgent,
  }) => {
    const blocked = await api.get(
      `links/preview?url=${encodeURIComponent('http://169.254.169.254/latest/meta-data')}`,
      { headers: authed(testAgent.apiKey) }
    )
    expect(blocked.status()).toBe(400)
    expect((await blocked.json()).error).toContain('metadata')

    const anon = await api.get(
      `links/preview?url=${encodeURIComponent('https://example.com')}`
    )
    expect(anon.status()).toBe(401)

    const missing = await api.get('links/preview', {
      headers: authed(testAgent.apiKey),
    })
    expect(missing.status()).toBe(400)
  })
})
