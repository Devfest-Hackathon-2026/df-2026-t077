import { test, expect, type Page } from '@playwright/test'
import type { ProposalBundle, TripResponse } from '../../src/api/types'
import { messages } from '../../src/i18n/messages'
import { planCard, planCards } from '../e2e/planUi'

async function storedTrip(page: Page, id: string): Promise<TripResponse> {
  return page.evaluate(async (id) => {
    const path = '/src/auth/token.ts'
    const { getToken } = await import(path)
    const response = await fetch(`http://127.0.0.1:8008/api/v1/trips/${id}`, { headers: { Authorization: `Bearer ${await getToken()}` } })
    if (!response.ok) throw new Error(`GET Trip: ${response.status}`)
    return response.json()
  }, id)
}

// maxVisits defaults to the number of places each test chooses, so no "leave it to us" slot is added automatically.
async function conditions(page: Page, locale: 'ja' | 'en', date = '2026-11-12', maxVisits = '2') {
  const t = messages[locale]
  await page.goto('/plan/new')
  await expect(page.locator('#trip-date')).toBeVisible()
  if (locale === 'en') await page.getByRole('button', { name: 'English', exact: true }).click()
  await page.locator('#trip-date').fill(date)
  await page.locator('#trip-startTime').fill('09:00')
  await page.locator('#trip-endTime').fill('17:00')
  await page.locator('#trip-maxWalkKm').fill('8')
  await page.locator('#trip-maxVisits').fill(maxVisits)
  await page.locator('#trip-partySize').fill('1')
  await page.getByRole('checkbox', { name: t.history, exact: true }).check()
  await page.locator('#trip-startSpotId').selectOption('sakae-station')
  await page.locator('#trip-endSpotId').selectOption('sakae-station')
  await expect(page.locator('#trip-startSpotId option')).toHaveCount(13)
  await expect(page.locator('.mock-banner')).toHaveCount(0)
  await page.getByRole('button', { name: t.addVisit, exact: true }).click()
}

async function generate(page: Page, locale: 'ja' | 'en'): Promise<ProposalBundle> {
  const t = messages[locale]
  await page.getByRole('button', { name: t.reviewConditions, exact: true }).click()
  await page.getByRole('checkbox', { name: t.confirmConditions, exact: true }).check()
  const [response] = await Promise.all([
    page.waitForResponse((response) => /\/proposals$/.test(new URL(response.url()).pathname) && response.request().method() === 'POST'),
    page.getByRole('button', { name: t.generateProposal, exact: true }).click(),
  ])
  expect(response.status()).toBe(201)
  const bundle: ProposalBundle = await response.json()
  await expect(page).toHaveURL(new RegExp(`proposalId=${bundle.id}$`))
  return bundle
}

// Real Nagoya catalog + walking estimates, actual HTTP/Firebase Auth/Firestore emulators.
// These checks do not use paid Gemini/Maps JavaScript services or claim measured crowd data.
for (const locale of ['ja', 'en'] as const) {
  test(`${locale}: Nagoya compare, reasons, selection, map-free timeline, refine and reload`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    const t = messages[locale]
    await conditions(page, locale)
    await page.locator('#trip-requestedStops-0-spotId').selectOption('nagoya-castle')
    await page.locator('select[name="requestedStops.0.requirement"]').selectOption('must')
    await page.getByRole('button', { name: t.addVisit, exact: true }).click()
    await page.locator('#trip-requestedStops-1-spotId').selectOption('osu-shopping-street')
    await page.getByText(t.advanced, { exact: true }).click()
    await page.getByRole('button', { name: t.addAvoid, exact: true }).click()
    await page.locator('#trip-avoidWindows-0-spotId').selectOption('nagoya-castle')
    await page.locator('#trip-avoidWindows-0-startTime').fill('09:00')
    await page.locator('#trip-avoidWindows-0-endTime').fill('11:00')
    const bundle = await generate(page, locale)
    expect(bundle.effective_constraints.area_id).toBe('nagoya-central')
    expect(bundle.effective_constraints.start_at).toBe('2026-11-12T09:00:00+09:00')
    expect(bundle.baseline).not.toBeNull()
    await expect(planCards(page)).toHaveCount(3)
    const plans = [bundle.baseline!, ...bundle.alternatives]
    for (const plan of plans) {
      expect(plan.stops.find((stop) => stop.spot_id === 'nagoya-castle')?.requirement).toBe('must')
      expect(plan.metrics.wait_not_included_spot_ids).not.toHaveLength(0)
      expect(plan.legs.every((leg) => leg.source_kind === 'estimated')).toBe(true)
    }
    const time = bundle.alternatives.find((plan) => plan.strategy === 'time_shift')!
    expect(time.stops.filter((stop) => stop.role === 'visit').map((stop) => stop.spot_id).sort()).toEqual(['nagoya-castle', 'osu-shopping-street'])
    const place = bundle.alternatives.find((plan) => plan.strategy === 'place_shift')!
    expect(place.changes.some((change) => change.kind === 'place_replacement')).toBe(true)
    await expect(page.locator('.route-attribution').first()).toContainText('Google Maps')
    await expect(page.locator('.compare-demo-badge')).toHaveCount(0)
    await expect(page.locator('.compare-cautions').first()).toContainText(locale === 'ja' ? '未算入' : 'Not included')
    const strategy = locale === 'ja' ? 'place_shift' : 'time_shift'
    const chosen = bundle.alternatives.find((plan) => plan.strategy === strategy)!
    const whyButton = planCard(page, strategy, locale).getByRole('button', { name: t.why, exact: true })
    await whyButton.click()
    await expect(page.getByRole('dialog').getByRole('heading', { name: t.uncertainties, exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(whyButton).toBeFocused()
    await page.screenshot({ path: `test-results/curated/compare-${locale}-mobile.png`, fullPage: true })
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.screenshot({ path: `test-results/curated/compare-${locale}-desktop.png`, fullPage: true })
    await page.setViewportSize({ width: 360, height: 800 })
    const [adoptedResponse] = await Promise.all([
      page.waitForResponse((response) => /\/selection$/.test(new URL(response.url()).pathname)),
      planCard(page, strategy, locale).getByRole('button', { name: locale === 'ja' ? 'この案にする' : 'Adopt this plan', exact: true }).click(),
    ])
    expect(adoptedResponse.status()).toBe(200)
    await expect(page).toHaveURL(new RegExp(`/trips/${bundle.trip_id}$`))
    await expect(page.locator('.trip-selection-status')).toContainText(chosen.id)
    await expect(page.locator('.trip-summary')).toContainText(t.unknown)
    await expect(page.locator('.trip-map-fallback')).toBeVisible()
    await page.locator('.trip-map-stop-index button').nth(1).click()
    await expect(page.locator('.trip-stop-select').nth(1)).toHaveAttribute('aria-pressed', 'true')
    await page.locator('.trip-stop-select').nth(2).click()
    await expect(page.locator('.trip-map-stop-index button').nth(2)).toHaveAttribute('aria-pressed', 'true')
    const saved = await storedTrip(page, bundle.trip_id)
    expect(saved.trip.version).toBe(2)
    expect(saved.active_plan?.id).toBe(chosen.id)
    await page.getByRole('button', { name: t.why, exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: t.refine, exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(1)
    await page.keyboard.press('Escape')
    expect((await storedTrip(page, bundle.trip_id)).active_plan?.id).toBe(chosen.id)
    await page.getByRole('button', { name: t.refine, exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.locator('#trip-maxWalkKm').fill('9')
    await dialog.getByRole('checkbox', { name: t.confirmConditions, exact: true }).check()
    const [refinedResponse] = await Promise.all([
      page.waitForResponse((response) => /\/proposals$/.test(new URL(response.url()).pathname)),
      dialog.getByRole('button', { name: t.refine, exact: true }).click(),
    ])
    expect(refinedResponse.status()).toBe(201)
    const refined: ProposalBundle = await refinedResponse.json()
    expect(refined.request.mode).toBe('refine')
    expect(refined.base_version).toBe(2)
    expect(refined.effective_constraints.max_walk_meters).toBe(9000)
    await expect(page).toHaveURL(new RegExp(`proposalId=${refined.id}$`))
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const unchanged = await storedTrip(page, bundle.trip_id)
    expect(unchanged.active_plan?.id).toBe(chosen.id)
    expect(unchanged.trip.constraints.max_walk_meters).toBe(8000)
    await page.goto(`/trips/${bundle.trip_id}`)
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('lang', locale)
    await expect(page.locator('.trip-selection-status')).toContainText(chosen.id)
    await expect(page.locator('.trip-selection-status')).toContainText(locale === 'ja' ? '旅程バージョン: 2' : 'Trip version: 2')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `test-results/curated/itinerary-${locale}-mobile.png`, fullPage: true })
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.screenshot({ path: `test-results/curated/itinerary-${locale}-desktop.png`, fullPage: true })
    expect(errors).toEqual([])
  })
}

test('a must-visit closed on Tuesday is infeasible and cannot be adopted', async ({ page }) => {
  await conditions(page, 'ja', '2026-11-10', '1')
  await page.locator('#trip-requestedStops-0-spotId').selectOption('yamamotoya-honke')
  await page.locator('select[name="requestedStops.0.requirement"]').selectOption('must')
  const bundle = await generate(page, 'ja')
  expect(bundle.status).toBe('no_feasible_plan')
  expect(bundle.violations.some((violation) => violation.code === 'CLOSED')).toBe(true)
  await expect(page.getByRole('heading', { name: messages.ja.noPlan, exact: true })).toBeVisible()
  await expect(planCards(page)).toHaveCount(0)
  await page.getByRole('button', { name: messages.ja.refine, exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  expect((await storedTrip(page, bundle.trip_id)).active_plan).toBeNull()
})

test('omakase uses real catalog IDs and preserves the explicit must visit', async ({ page }) => {
  await conditions(page, 'ja')
  await page.locator('#trip-requestedStops-0-spotId').selectOption('nagoya-castle')
  await page.locator('select[name="requestedStops.0.requirement"]').selectOption('must')
  await page.getByRole('button', { name: messages.ja.addVisit, exact: true }).click()
  const picker = page.locator('#trip-requestedStops-1-spotId')
  const value = await picker.locator('option').filter({ hasText: 'お任せ' }).getAttribute('value')
  expect(value).toBeTruthy()
  await picker.selectOption(value!)
  const bundle = await generate(page, 'ja')
  expect(bundle.effective_constraints.omakase_visits).toBe(1)
  expect(bundle.baseline).not.toBeNull()
  expect(bundle.baseline!.stops.some((stop) => stop.spot_id === 'nagoya-castle' && stop.requirement === 'must')).toBe(true)
  expect(bundle.baseline!.stops.filter((stop) => stop.role === 'visit')).toHaveLength(2)
  expect(bundle.baseline!.stops.every((stop) => !stop.spot_id.includes('demo-'))).toBe(true)
  await expect(planCards(page).first()).toBeVisible()
})

test('Japanese single-must proposal displays English missing-option notes after switching language', async ({ page }) => {
  await conditions(page, 'ja', '2026-11-12', '1')
  await page.locator('#trip-requestedStops-0-spotId').selectOption('nagoya-castle')
  await page.locator('select[name="requestedStops.0.requirement"]').selectOption('must')
  const bundle = await generate(page, 'ja')
  expect(bundle.alternatives).toHaveLength(0)
  expect(bundle.effective_constraints.locale).toBe('ja')
  const posts: string[] = []
  page.on('request', (request) => { if (request.method() === 'POST') posts.push(request.url()) })
  await page.getByRole('button', { name: 'English', exact: true }).click()
  await expect(page.locator('.compare-page')).toContainText('With one visit and no time to avoid')
  await expect(page.locator('.compare-page')).toContainText('Every visit is marked')
  await expect(page.locator('.compare-why')).toContainText('This baseline keeps the confirmed visit order.')
  await expect(page.locator('.compare-cautions')).toContainText('Not included')
  expect(await page.locator('.compare-page').innerText()).not.toMatch(/[ぁ-んァ-ヶ一-龯]/)
  expect(posts).toEqual([])
  await page.screenshot({ path: 'test-results/curated/translated-single-must-en.png', fullPage: true })
  expect((await storedTrip(page, bundle.trip_id)).trip.constraints.locale).toBe('ja')
})

test('Japanese real plans retain facts, distances, adopted ID and unknown waits when displayed in English', async ({ page }) => {
  await conditions(page, 'ja')
  await page.locator('#trip-requestedStops-0-spotId').selectOption('nagoya-castle')
  await page.locator('select[name="requestedStops.0.requirement"]').selectOption('must')
  await page.getByRole('button', { name: messages.ja.addVisit, exact: true }).click()
  await page.locator('#trip-requestedStops-1-spotId').selectOption('osu-shopping-street')
  await page.getByText(messages.ja.advanced, { exact: true }).click()
  await page.getByRole('button', { name: messages.ja.addAvoid, exact: true }).click()
  await page.locator('#trip-avoidWindows-0-spotId').selectOption('nagoya-castle')
  await page.locator('#trip-avoidWindows-0-startTime').fill('09:00')
  await page.locator('#trip-avoidWindows-0-endTime').fill('11:00')
  const bundle = await generate(page, 'ja')
  await expect(planCards(page)).toHaveCount(3)
  const metrics = await page.locator('.compare-metrics dd').allTextContents()
  const times = await page.locator('.compare-stop time').allTextContents()
  const posts: string[] = []
  page.on('request', (request) => { if (request.method() === 'POST') posts.push(request.url()) })
  await page.getByRole('button', { name: 'English', exact: true }).click()
  const place = planCard(page, 'place_shift', 'en')
  await expect(place.locator('.compare-why')).toContainText('loses food and adds history')
  expect(await page.locator('.compare-metrics dd').allTextContents()).toEqual(metrics)
  expect(await page.locator('.compare-stop time').allTextContents()).toEqual(times)
  for (const card of await planCards(page).all()) expect(await card.innerText()).not.toMatch(/[ぁ-んァ-ヶ一-龯]/)
  await place.getByRole('button', { name: messages.en.why, exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('loses food and adds history')
  await expect(page.getByRole('dialog')).toContainText('not mean those spots are empty')
  await page.keyboard.press('Escape')
  expect(posts).toEqual([])
  await page.screenshot({ path: 'test-results/curated/translated-three-plans-en.png', fullPage: true })
  const chosen = bundle.alternatives.find((plan) => plan.strategy === 'place_shift')!
  await place.getByRole('button', { name: 'Adopt this plan', exact: true }).click()
  await expect(page.locator('.trip-selection-status')).toContainText(chosen.id)
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page.locator('.trip-selection-status')).toContainText(chosen.id)
  const saved = await storedTrip(page, bundle.trip_id)
  expect(saved.trip.version).toBe(2)
  expect(saved.trip.constraints.locale).toBe('ja')
  expect(saved.active_plan?.metrics).toEqual(chosen.metrics)
  expect(saved.active_plan?.facts).toEqual(chosen.facts)
  const source = page.locator('.trip-spot-sources article').first()
  await expect(source).toContainText('Source information (Japanese)')
  const originalSource = source.getByRole('button', { name: 'Read original Japanese text', exact: true })
  await expect(originalSource).toHaveCount(1)
  await originalSource.click()
  await expect(source.locator('[lang="ja"]')).toBeVisible()
  await expect(source).toContainText('名古屋市交通局')
  await source.getByRole('button', { name: 'Hide original text', exact: true }).click()
  await page.getByRole('button', { name: messages.en.why, exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('loses food and adds history')
})

test('fewer places than the visit limit are sent as automatic "leave it to us" slots and keep the must visit', async ({ page }) => {
  await conditions(page, 'ja', '2026-11-12', '3')
  await page.locator('#trip-requestedStops-0-spotId').selectOption('nagoya-castle')
  await page.locator('select[name="requestedStops.0.requirement"]').selectOption('must')
  await expect(page.locator('#trip-visit-limit')).toContainText('残りの2件は')
  const bundle = await generate(page, 'ja')
  expect(bundle.effective_constraints.max_visits).toBe(3)
  expect(bundle.effective_constraints.omakase_visits).toBe(2)
  expect(bundle.baseline).not.toBeNull()
  const visits = bundle.baseline!.stops.filter((stop) => stop.role === 'visit')
  expect(visits.some((stop) => stop.spot_id === 'nagoya-castle' && stop.requirement === 'must')).toBe(true)
  // Picks come from the real catalog; a slot with no fitting place is left empty rather than invented.
  expect(visits.length).toBeGreaterThanOrEqual(1)
  expect(visits.length).toBeLessThanOrEqual(3)
  expect(visits.every((stop) => !stop.spot_id.includes('demo-'))).toBe(true)
  await expect(planCards(page).first()).toBeVisible()
})
