import { test, expect } from './fixtures'
import { messages } from '../../src/i18n/messages'
import type { ProposalBundle } from '../../src/api/types'
import { planCard, planCards } from './planUi'

for (const locale of ['ja', 'en'] as const) {
  test(`${locale}: partial proposals show violations, missing baseline and only feasible options`, async ({ page }) => {
    const t = messages[locale]
    await page.goto('/plan/new')
    if (locale === 'en') await page.getByRole('button', { name: 'English', exact: true }).click()
    await expect(page.getByRole('link', { name: t.sample, exact: false })).toBeVisible()
    await page.evaluate(() => {
      const original = window.fetch.bind(window)
      window.fetch = async (input, init) => {
        const request = input instanceof Request ? input.clone() : new Request(input, init)
        const response = await original(input, init)
        if (request.method !== 'GET' || !/\/proposals\/demo-proposal$/.test(new URL(request.url).pathname)) return response
        const bundle: ProposalBundle = await response.clone().json()
        bundle.status = 'partial'
        bundle.baseline = null
        bundle.alternatives = bundle.alternatives.filter((plan) => plan.strategy === 'time_shift')
        bundle.violations = [{ code: 'TIME_LIMIT', spot_id: null, message: 'Explicit UI test: original schedule is infeasible', suggested_action: 'Extend the return deadline' }]
        return new Response(JSON.stringify(bundle), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
    })
    await page.getByRole('link', { name: t.sample, exact: false }).click()
    await expect(page.locator('.compare-result-partial')).toContainText('original schedule is infeasible')
    await expect(planCards(page)).toHaveCount(1)
    await expect(planCard(page, 'baseline', locale)).toHaveCount(0)
    await expect(page.locator('.compare-result-count')).toContainText('1')
    await page.getByRole('button', { name: t.refine, exact: true }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: t.refine, exact: true })).toBeFocused()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })

  test(`${locale}: saved reasons and refine cancel preserve selection, language and keyboard focus`, async ({ page }) => {
    const t = messages[locale]
    await page.goto('/plan/new')
    if (locale === 'en') await page.getByRole('button', { name: 'English', exact: true }).click()
    await page.getByRole('link', { name: t.sample, exact: false }).click()
    await planCard(page, 'place_shift', locale).getByRole('button', { name: locale === 'ja' ? 'この案にする' : 'Adopt this plan', exact: true }).click()
    await expect(page.locator('.trip-selection-status')).toContainText('plan-place_shift')
    const why = page.getByRole('button', { name: t.why, exact: true })
    await why.click()
    await page.getByRole('dialog').getByRole('button', { name: t.refine, exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(1)
    await page.keyboard.press('Escape')
    await expect(why).toBeFocused()
    await expect(page.locator('.trip-selection-status')).toContainText('plan-place_shift')
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('lang', locale)
    await expect(page.locator('.trip-selection-status')).toContainText('plan-place_shift')
    await page.getByRole('link', { name: locale === 'ja' ? '比較した案を見る' : 'View compared plans', exact: true }).click()
    await expect(planCards(page)).toHaveCount(3)
  })
}

test('selection response loss retries exactly the same plan, version and UUID', async ({ page }) => {
  await page.goto('/trips/demo-trip/compare?proposalId=demo-proposal')
  await expect(planCards(page)).toHaveCount(3)
  await page.evaluate(() => {
    const bodies: unknown[] = []
    ;(window as unknown as { selections: unknown[] }).selections = bodies
    const original = window.fetch.bind(window)
    window.fetch = async (input, init) => {
      const request = input instanceof Request ? input.clone() : new Request(input, init)
      const selection = request.method === 'POST' && /\/selection$/.test(new URL(request.url).pathname)
      if (selection) bodies.push(await request.json())
      const response = await original(input, init)
      if (selection && bodies.length === 1 && response.ok) throw new TypeError('Explicit UI test: selection response lost after save')
      return response
    }
  })
  await planCard(page, 'time_shift', 'ja').getByRole('button', { name: 'この案にする', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText(messages.ja.selectionRetryNote)
  for (const button of await page.getByRole('button', { name: 'この案にする', exact: true }).all()) await expect(button).toBeDisabled()
  await page.getByRole('button', { name: messages.ja.selectionRetrySame, exact: true }).click()
  await expect(page.locator('.trip-selection-status')).toContainText('plan-time_shift')
  await expect(page.locator('.trip-selection-status')).toContainText('旅程バージョン: 2')
  const bodies = await page.evaluate(() => (window as unknown as { selections: unknown[] }).selections)
  expect(bodies).toHaveLength(2)
  expect(bodies[1]).toEqual(bodies[0])
})

test('refining an old comparison requires latest-state review before a new proposal', async ({ page }) => {
  await page.goto('/trips/demo-trip/compare?proposalId=demo-proposal')
  await planCard(page, 'baseline', 'ja').getByRole('button', { name: 'この案にする', exact: true }).click()
  await expect(page.locator('.trip-selection-status')).toContainText('旅程バージョン: 2')
  await page.getByRole('link', { name: '比較した案を見る', exact: true }).click()
  await page.getByRole('button', { name: messages.ja.refine, exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('alert')).toContainText(messages.ja.VERSION_CONFLICT)
  await dialog.getByRole('button', { name: messages.ja.reviewLatest, exact: true }).click()
  await expect(dialog.getByRole('checkbox', { name: messages.ja.confirmConditions, exact: true })).not.toBeChecked()
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  await dialog.getByRole('checkbox', { name: messages.ja.confirmConditions, exact: true }).check()
  const [response] = await Promise.all([
    page.waitForResponse((response) => /\/proposals$/.test(new URL(response.url()).pathname)),
    dialog.getByRole('button', { name: messages.ja.refine, exact: true }).click(),
  ])
  expect(response.status()).toBe(201)
  const bundle = await response.json() as ProposalBundle
  expect(bundle.base_version).toBe(2)
  expect(bundle.request.mode).toBe('refine')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})
