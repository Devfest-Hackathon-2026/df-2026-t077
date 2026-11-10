import { defineConfig } from '@playwright/test'
const port = Number(process.env.PLAYWRIGHT_PORT || 5187)
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid PLAYWRIGHT_PORT')
const baseURL = `http://127.0.0.1:${port}`
export default defineConfig({
  testDir: './tests/e2e', testIgnore: 'maps-failure.spec.ts', outputDir: 'test-results/e2e', fullyParallel: true, workers: 2, retries: 0, expect: { timeout: 10_000 },
  use: { baseURL, viewport: { width: 360, height: 800 }, trace: 'retain-on-failure',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {},
  },
  webServer: {
    command: `npm run dev -- --port ${port}`, url: baseURL, reuseExistingServer: false, timeout: 60_000,
    // Avoid reusing a Windows-locked dependency cache from a previous Vite process.
    env: {
      ZURASHITABI_VITE_CACHE_DIR: `.tools/vite-e2e/${process.pid}-${Date.now()}`,
      VITE_USE_MOCKS: 'true', VITE_MOCK_SCENARIO: 'normal', VITE_USE_FIREBASE_EMULATORS: 'false',
      VITE_API_BASE_URL: 'http://127.0.0.1:8000', VITE_AREA_ID: 'demo-area',
      VITE_GOOGLE_MAPS_API_KEY: '',
    },
  },
})
