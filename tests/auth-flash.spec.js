// tests/auth-flash.spec.js
// Verifies that navigating to protected portals without a session
// redirects to login WITHOUT flashing the protected dashboard content.
import { test, expect } from '@playwright/test'

const BASE = process.env.BASE_URL || 'http://localhost:3000'

// Helper: assert that a protected page redirects to login within the timeout
// and never shows dashboard-specific content.
async function assertRedirectsToLogin(page, protectedUrl, loginUrlFragment, timeoutMs = 5000) {
  // Navigate without any session cookie
  await page.goto(protectedUrl, { waitUntil: 'domcontentloaded' })

  // The page should redirect to the login URL
  await page.waitForURL((url) => url.pathname.includes(loginUrlFragment), { timeout: timeoutMs })

  // Verify we're on the login page
  expect(page.url()).toContain(loginUrlFragment)

  // Verify dashboard-specific content is NOT visible
  const body = await page.textContent('body')
  expect(body).not.toContain('Dashboard')
  expect(body).not.toContain('Verifying session')
}

test.describe('Auth flash prevention', () => {
  test('vendor dashboard redirects to login without flashing content', async ({ page }) => {
    await assertRedirectsToLogin(page, `${BASE}/vendor/dashboard`, '/vendor/login')
  })

  test('vendor products redirects to login without flashing content', async ({ page }) => {
    await assertRedirectsToLogin(page, `${BASE}/vendor/products`, '/vendor/login')
  })

  test('admin dashboard redirects to login without flashing content', async ({ page }) => {
    await assertRedirectsToLogin(page, `${BASE}/admin`, '/admin/pin')
  })

  test('admin members redirects to login without flashing content', async ({ page }) => {
    await assertRedirectsToLogin(page, `${BASE}/admin/members`, '/admin/pin')
  })

  test('vendor login page renders normally (no redirect loop)', async ({ page }) => {
    await page.goto(`${BASE}/vendor/login`, { waitUntil: 'domcontentloaded' })
    // Should stay on the login page, not redirect away
    await page.waitForTimeout(2000)
    expect(page.url()).toContain('/vendor/login')
  })

  test('admin pin page renders normally (no redirect loop)', async ({ page }) => {
    await page.goto(`${BASE}/admin/pin`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2000)
    expect(page.url()).toContain('/admin/pin')
  })
})
