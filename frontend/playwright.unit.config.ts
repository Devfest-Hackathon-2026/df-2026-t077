import { defineConfig } from '@playwright/test'
export default defineConfig({ testDir: './tests/unit', outputDir: 'test-results/unit', fullyParallel: true, retries: 0 })
