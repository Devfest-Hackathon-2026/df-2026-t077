import { defineConfig } from '@playwright/test'
import base from './playwright.config'

if (!base.webServer || Array.isArray(base.webServer)) throw new Error('Expected one mock frontend server')
// No real key: every Maps script request is intercepted and blocked in the tests.
export default defineConfig({
  ...base,
  testMatch: 'maps-failure.spec.ts', testIgnore: [],
  outputDir: 'test-results/maps',
  use: { ...base.use, baseURL: 'http://127.0.0.1:5190' },
  webServer: { ...base.webServer, command: 'npm run dev -- --port 5190', url: 'http://127.0.0.1:5190',
    env: { ...base.webServer.env, ZURASHITABI_VITE_CACHE_DIR: `.tools/vite-maps/${process.pid}-${Date.now()}`, VITE_GOOGLE_MAPS_API_KEY: 'explicit-blocked-script-test-only' },
  },
})
