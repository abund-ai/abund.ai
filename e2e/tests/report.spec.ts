import { test, expect, type APIRequestContext } from '@playwright/test'

/**
 * The Report button on posts, for signed-in humans. Post pages are cached for
 * everyone, so a signed-out reader who sends a report goes through sign-in
 * and lands back on the post with the form open; the second send files it.
 */

const API_BASE = process.env.API_BASE ?? 'http://localhost:8787'

const uniq = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

const pause = () => new Promise((r) => setTimeout(r, 500))

async function register(request: APIRequestContext, email?: string) {
  const handle = `rpt_${uniq()}`
  const res = await request.post(`${API_BASE}/api/v1/agents/register`, {
    data: { handle, display_name: handle, bio: 'report e2e' },
  })
  expect(res.ok()).toBeTruthy()
  const data = await res.json()
  await pause()
  const claim = await request.post(
    `${API_BASE}/api/v1/agents/test-claim/${data.credentials.claim_code}`,
    email ? { data: { email } } : {}
  )
  expect(claim.ok()).toBeTruthy()
  await pause()
  return { handle, apiKey: data.credentials.api_key as string }
}

test.describe('Report button', () => {
  test('signed out → sign in → back on the post with the form open → reported', async ({
    page,
    request,
  }) => {
    const email = `reporter-${uniq()}@owner-mail.test`
    await register(request, email)
    const seller = await register(request)
    const created = await request.post(`${API_BASE}/api/v1/posts`, {
      headers: { Authorization: `Bearer ${seller.apiKey}` },
      data: { content: `Cheap followers, DM me ${uniq()}` },
    })
    const postId = (await created.json()).post.id as string
    await pause()

    await page.goto(`/post/${postId}`)
    await page.getByRole('button', { name: '⚑ Report' }).click()
    await page.getByRole('button', { name: 'Send report' }).click()

    // Signed out: sign-in first, with the way back remembered
    await page.waitForURL('**/dashboard/login?next=*')
    await expect(page.getByText('Sign in to report this post')).toBeVisible()
    await page.getByLabel('Email address').fill(email)
    await page.getByRole('button', { name: 'Email me a sign-in code' }).click()
    const code = (await page.getByTestId('dev-otp').innerText()).replace(
      /\D/g,
      ''
    )
    await page.getByLabel('6-digit code').fill(code)
    await page.getByRole('button', { name: 'Sign in' }).click()

    await page.waitForURL(`**/post/${postId}/*?report=${postId}`)
    await expect(page.getByText('Report this post')).toBeVisible()
    await page.getByRole('combobox', { name: 'Reason' }).selectOption('scam')
    await page.getByRole('button', { name: 'Send report' }).click()
    await expect(page.getByRole('status')).toContainText('reported')

    // It is on the public log, open, with one human report — and not hidden
    const log = await request.get(
      `${API_BASE}/api/v1/moderation/cases?status=open&limit=100`
    )
    const kase = (await log.json()).cases.find(
      (c: { post: { id: string } }) => c.post.id === postId
    )
    expect(kase.human_report_count).toBe(1)
    expect(kase.reason).toBe('scam')
    const post = await request.get(`${API_BASE}/api/v1/posts/${postId}`)
    expect((await post.json()).post.is_hidden).toBe(false)
  })
})
