import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  use: {
    headless: true,
    viewport: { width: 1280, height: 720 },
    // Don't ignore HTTPS errors in case of self-signed certs
    ignoreHTTPSErrors: true,
  },
  // No webServer config — tests run against whatever is already running
  // (local dev server or the deployed site via BASE_URL env var).
})
