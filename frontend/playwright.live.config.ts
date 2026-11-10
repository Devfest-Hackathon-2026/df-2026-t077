import { defineConfig } from '@playwright/test'

const curated = process.env.LOCAL_FLOW_DATA_MODE === 'curated'

// Explicitly separate real local HTTP/Auth/Firestore checks from MSW fixed-sample tests.
export default defineConfig({
  testDir: './tests/live', testMatch: curated ? 'curated-flow.spec.ts' : 'api-flow.spec.ts', workers: 1, retries: 0, timeout: 45_000, expect: { timeout: 15_000 },
  outputDir: curated ? 'test-results/curated' : 'test-results/live',
  use: { baseURL: 'http://127.0.0.1:5188', viewport: { width: 360, height: 800 }, timezoneId: 'America/New_York',
    trace: 'retain-on-failure', launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {},
  },
  webServer: [
    { command: 'node ../scripts/live-api-server.mjs', url: 'http://127.0.0.1:8008/health', reuseExistingServer: false, timeout: 60_000 },
    { command: 'npm run dev -- --port 5188', url: 'http://127.0.0.1:5188', reuseExistingServer: false, timeout: 60_000,
      env: { ZURASHITABI_VITE_CACHE_DIR: `.tools/vite-live/${process.pid}-${Date.now()}`, VITE_USE_MOCKS: 'false', VITE_USE_FIREBASE_EMULATORS: 'true', VITE_GOOGLE_MAPS_API_KEY: '', VITE_AREA_ID: curated ? 'nagoya-central' : 'demo-area', VITE_API_BASE_URL: 'http://127.0.0.1:8008', VITE_FIREBASE_PROJECT_ID: 'demo-zurashitabi', VITE_FIREBASE_API_KEY: 'local-emulator-only', VITE_FIREBASE_AUTH_DOMAIN: 'demo-zurashitabi.firebaseapp.com' },
    },
  ],
})
