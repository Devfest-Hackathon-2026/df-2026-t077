import { test, expect } from './fixtures'
import type { Page } from '@playwright/test'
import { messages } from '../../src/i18n/messages'
import { planCard } from './planUi'


async function blockMaps(page: Page, fail: boolean) {
  // MSW's development transport can bypass page.route(). Block the loader's script
  // src before DOM insertion, injecting only a browser error or an indefinite load.
  // No Google API response or map implementation is fabricated.
  await page.addInitScript((fail) => {
    const probe = { blocked: 0 }
    ;(window as unknown as { mapsProbe: typeof probe }).mapsProbe = probe
    const descriptor = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src')!
    Object.defineProperty(HTMLScriptElement.prototype, 'src', {
      ...descriptor,
      set(value: string) {
        if (new URL(value, location.href).hostname === 'maps.googleapis.com') {
          probe.blocked++
          if (fail) queueMicrotask(() => this.dispatchEvent(new Event('error')))
          return
        }
        descriptor.set!.call(this, value)
      },
    })
  }, fail)
}
async function blockedCount(page: Page) {
  return page.evaluate(() => (window as unknown as { mapsProbe: { blocked: number } }).mapsProbe.blocked)
}

for (const locale of ['ja', 'en'] as const) {
  test(`${locale}: blocked Maps script leaves adoption, timeline and place details usable`, async ({ page }) => {
    await blockMaps(page, true)
    await page.goto('/plan/new')
    if (locale === 'en') await page.getByRole('button', { name: 'English', exact: true }).click()
    await page.getByRole('link', { name: messages[locale].sample, exact: false }).click()
    await planCard(page, 'time_shift', locale).getByRole('button', { name: locale === 'ja' ? 'この案にする' : 'Adopt this plan', exact: true }).click()
    await expect(page.locator('.trip-map-fallback')).toContainText(locale === 'ja' ? 'Google Mapsを読み込めませんでした' : 'Google Maps could not load')
    expect(await blockedCount(page)).toBeGreaterThan(0)
    await expect(page.locator('.trip-selection-status')).toContainText('plan-time_shift')
    await page.locator('.trip-map-stop-index button').nth(1).focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('.trip-stop-select').nth(1)).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.trip-spot-card')).toBeVisible()
    await page.getByRole('button', { name: messages[locale].why, exact: true }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}

test('a stalled Maps script falls back after the loading timeout', async ({ page }) => {
  await blockMaps(page, false)
  await page.goto('/trips/demo-trip/compare?proposalId=demo-proposal')
  await planCard(page, 'baseline', 'ja').getByRole('button', { name: 'この案にする', exact: true }).click()
  await expect(page.locator('.trip-map-fallback')).toContainText('Google Mapsを読み込めませんでした', { timeout: 15_000 })
  expect(await blockedCount(page)).toBeGreaterThan(0)
  await expect(page.locator('.trip-map-stop-index button')).toHaveCount(4)
})

test('a rejected Maps key uses the same accessible fallback', async ({ page }) => {
  await blockMaps(page, false)
  await page.goto('/trips/demo-trip/compare?proposalId=demo-proposal')
  await planCard(page, 'baseline', 'ja').getByRole('button', { name: 'この案にする', exact: true }).click()
  await expect(page.locator('.trip-map-status')).toBeVisible()
  await page.evaluate(() => (window as typeof window & { gm_authFailure?: () => void }).gm_authFailure?.())
  await expect(page.locator('.trip-map-fallback')).toContainText('Google Mapsを読み込めませんでした')
  await expect(page.locator('.trip-selection-status')).toContainText('plan-baseline')
})
