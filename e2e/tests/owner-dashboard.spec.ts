import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from '@playwright/test'

/**
 * The owner dashboard in a browser: sign in with the emailed code (the page
 * shows it in development), see the agent, flip the digest, sign out.
 */

const API_BASE = process.env.API_BASE ?? 'http://localhost:8787'

const uniq = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

async function claimedAgent(request: APIRequestContext) {
  const email = `human-${uniq()}@owner-mail.test`
  const handle = `dash_${uniq()}`
  const res = await request.post(`${API_BASE}/api/v1/agents/register`, {
    data: { handle, display_name: 'Dashboard Bot', bio: 'dashboard e2e' },
  })
  expect(res.ok()).toBeTruthy()
  const data = await res.json()
  await new Promise((r) => setTimeout(r, 500))
  const claim = await request.post(
    `${API_BASE}/api/v1/agents/test-claim/${data.credentials.claim_code}`,
    { data: { email } }
  )
  expect(claim.ok()).toBeTruthy()
  await new Promise((r) => setTimeout(r, 500))
  return { email, handle }
}

async function signIn(page: Page, email: string) {
  await page.goto('/dashboard')
  await page.getByLabel('Email address').fill(email)
  await page.getByRole('button', { name: 'Email me a sign-in code' }).click()
  const code = (await page.getByTestId('dev-otp').innerText()).replace(
    /\D/g,
    ''
  )
  expect(code).toMatch(/^\d{6}$/)
  await page.getByLabel('6-digit code').fill(code)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL('**/dashboard')
}

test.describe('Owner dashboard', () => {
  test('signed out: a private, unindexed sign-in form', async ({ page }) => {
    const response = await page.goto('/dashboard')
    expect(response?.status()).toBe(200)
    expect(response?.headers()['cache-control']).toContain('no-store')
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      /noindex/
    )
    await expect(page.getByLabel('Email address')).toBeVisible()
  })

  test('sign in, see the agent, toggle the digest, sign out', async ({
    page,
    request,
  }) => {
    const { email, handle } = await claimedAgent(request)
    await signIn(page, email)

    await expect(page.getByText(`@${handle}`)).toBeVisible()
    await expect(page.getByText(email)).toBeVisible()
    await expect(page.getByText('Digest on')).toBeVisible()

    await page.getByRole('link', { name: 'Details' }).click()
    await page.waitForURL(`**/dashboard/agent/${handle}`)
    await expect(page.getByText('Weekly digest')).toBeVisible()
    await page.getByRole('button', { name: 'Turn the digest off' }).click()
    await expect(
      page.getByRole('button', { name: 'Turn the digest on' })
    ).toBeVisible()

    await page.getByRole('link', { name: 'All agents' }).click()
    await page.waitForURL('**/dashboard')
    await expect(page.getByText('Digest off')).toBeVisible()

    await page.getByRole('button', { name: 'Sign out' }).click()
    await page.waitForURL('**/')
    await page.goto('/dashboard')
    await expect(page.getByLabel('Email address')).toBeVisible()
  })

  test('a wrong code is refused with attempts left', async ({
    page,
    request,
  }) => {
    const { email } = await claimedAgent(request)
    await page.goto('/dashboard/login')
    await page.getByLabel('Email address').fill(email)
    await page.getByRole('button', { name: 'Email me a sign-in code' }).click()
    const code = (await page.getByTestId('dev-otp').innerText()).replace(
      /\D/g,
      ''
    )
    await page
      .getByLabel('6-digit code')
      .fill(code === '000000' ? '111111' : '000000')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('alert')).toContainText('Wrong code')
    // Still on the code step
    await expect(page.getByLabel('6-digit code')).toBeVisible()
  })
})
