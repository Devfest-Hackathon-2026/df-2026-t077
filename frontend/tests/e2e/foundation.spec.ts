import { expect, test } from './fixtures'
import { planCards } from './planUi'

test('Japanese and English sample, uncertainty, drawer keyboard and mobile width', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/plan/new')
  await expect(page.getByText('行きたい気持ちは、そのままに。')).toBeVisible()
  await page.getByRole('button', { name: 'English', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await page.getByRole('link', { name: 'Compare the fixed sample' }).click()
  await expect(page.getByRole('heading', { name: 'Compare your trip options' })).toBeVisible()
  await expect(planCards(page)).toHaveCount(3)
  await expect(page.getByText('Wait time not included / unknown:', { exact: false }).first()).toBeVisible()
  const why = page.getByRole('button', { name: 'Reasons, tradeoffs & uncertainty' }).first()
  await why.click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('dialog').getByText('Crowding is unknown. Unspecified queue times are not included.')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(why).toBeFocused()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/foundation-mobile.png', fullPage: true })
  expect(errors).toEqual([])
})

test('deep links and missing resources show an explicit state', async ({ page }) => {
  await page.goto('/trips/demo-trip')
  await expect(page.getByText('まだ旅程は採用されていません')).toBeVisible()
  await page.goto('/trips/not-mine/compare?proposalId=missing')
  await expect(page.getByRole('alert')).toBeVisible()
  await page.goto('/not-a-page')
  await expect(page.getByRole('heading', { name: 'ページが見つかりません' })).toBeVisible()
})
