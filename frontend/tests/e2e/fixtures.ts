import { test as base, expect } from '@playwright/test'
export const test = base.extend<{ errorGuard: void }>({
  errorGuard: [async ({ page }, use) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await use()
    expect(errors, 'Unexpected browser errors, including startup/reload').toEqual([])
  }, { auto: true }],
})
export { expect }
