// vitest.config.mjs
// Unit-test config for the Coop app — jsdom environment for React hook tests
// (localStorage, window events). Run with `npm test` (vitest run).
import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      // Match the app's @/* -> project-root mapping (jsconfig.json) so hooks
      // that import '@/lib/...' resolve (and can be mocked) in tests.
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    // globals expose afterEach so @testing-library/react can auto-clean up
    // mounted hooks between tests (the test files still import vitest
    // explicitly, so eslint stays happy).
    globals: true,
    include: ['**/*.test.{js,jsx,ts,tsx}'],
  },
})
