import { expect, test } from './fixtures'
import { planCard, planCards } from './planUi'

test.use({ timezoneId: 'America/New_York' })

for (const locale of ['ja', 'en'] as const) {
  test(`${locale}: confirm, create, compare, select and reload in a foreign timezone`, async ({ page }) => {
    await page.goto('/plan/new')
    await page.locator('.setup-devtools > summary').click()
    if (locale === 'en') await page.getByRole('button', { name: 'English', exact: true }).click()
    const create = page.getByRole('button', { name: locale === 'ja' ? '固定条件で旅程を作成' : 'Create the fixed-sample trip' })
    await expect(create).toBeDisabled()
    await page.getByRole('checkbox', { name: locale === 'ja' ? 'この開発用の固定条件を確認しました' : 'I have reviewed these fixed development conditions' }).check()
    await create.click()
    await expect(page).toHaveURL(/\/trips\/trip-.*\/compare\?proposalId=proposal-/)
    await planCard(page, 'time_shift', locale).getByRole('button', { name: locale === 'ja' ? 'この案にする' : 'Adopt this plan', exact: true }).click()
    await expect(page).toHaveURL(/\/trips\/trip-[^/]+$/)
    const selection = page.getByRole('region', { name: locale === 'ja' ? '採用情報' : 'Saved selection' })
    await expect(selection).toContainText('plan-time_shift')
    await expect(selection).toContainText(locale === 'ja' ? '旅程バージョン: 2' : 'Trip version: 2')
    await expect(page.locator('.trip-map-fallback')).toContainText(locale === 'ja' ? '地図は現在利用できません' : 'The map is unavailable')
    await expect(page.locator('.trip-map-stop-index button')).toHaveCount(4)
    await page.locator('.trip-map-stop-index button').nth(1).click()
    await expect(page.locator('.trip-stop-select').nth(1)).toHaveAttribute('aria-pressed', 'true')
    await page.locator('.trip-stop-select').nth(2).click()
    await expect(page.locator('.trip-map-stop-index button').nth(2)).toHaveAttribute('aria-pressed', 'true')
    await page.reload()
    // UI language and the saved plan/IDs survive reload independently.
    await expect(page.getByRole('heading', { name: locale === 'ja' ? '採用済みの旅程' : 'Saved itinerary', exact: true })).toBeVisible()
    await expect(page.getByRole('region', { name: locale === 'ja' ? '採用情報' : 'Saved selection' })).toContainText('plan-time_shift')
    await expect(page.getByRole('region', { name: locale === 'ja' ? '採用情報' : 'Saved selection' })).toContainText(locale === 'ja' ? '旅程バージョン: 2' : 'Trip version: 2')
    await expect(page.locator('.trip-timeline-item').nth(2).locator('.trip-stop-time')).toHaveText('10:00')
    await page.getByRole('button', { name: locale === 'ja' ? /10:00.*架空資料館/ : /10:00.*Demo Museum/ }).click()
    await expect(page.getByRole('heading', { name: locale === 'ja' ? 'スポット詳細' : 'Place details', exact: true })).toBeVisible()
  })
}

test('same selection key replays once, a new stale key conflicts without changing the saved plan', async ({ page }) => {
  await page.goto('/plan/new')
  await page.locator('.setup-devtools > summary').click()
  await page.getByRole('checkbox', { name: 'この開発用の固定条件を確認しました' }).check()
  await page.getByRole('button', { name: '固定条件で旅程を作成' }).click()
  await expect(page).toHaveURL(/\/trips\/trip-.*\/compare\?proposalId=proposal-/)
  const compareUrl = new URL(page.url())
  await expect(planCards(page)).toHaveCount(3)
  const tripId = compareUrl.pathname.split('/')[2]
  const proposalId = compareUrl.searchParams.get('proposalId')!
  const result = await page.evaluate(async ({ tripId, proposalId }) => {
    const base = 'http://127.0.0.1:8000/api/v1/trips/' + tripId
    const headers = { Authorization: 'Bearer development-mock-only', 'Content-Type': 'application/json' }
    const body = { plan_id: 'plan-place_shift', expected_version: 1, idempotency_key: crypto.randomUUID() }
    const select = async (payload: typeof body) => {
      const response = await fetch(`${base}/proposals/${proposalId}/selection`, { method: 'POST', headers, body: JSON.stringify(payload) })
      return { status: response.status, data: await response.json() }
    }
    const first = await select(body)
    const replay = await select(body)
    const conflict = await select({ ...body, plan_id: 'plan-baseline', idempotency_key: crypto.randomUUID() })
    const trip = await (await fetch(base, { headers })).json()
    return { first, replay, conflict, trip }
  }, { tripId, proposalId })
  expect(result.first.status).toBe(200)
  expect(result.replay.data).toEqual(result.first.data)
  expect(result.conflict.status).toBe(409)
  expect(result.trip.trip.version).toBe(2)
  expect(result.trip.active_plan.id).toBe('plan-place_shift')
})

test('a stale proposal reloads the latest trip and requires review instead of selecting the old plan', async ({ page }) => {
  await page.goto('/plan/new')
  await page.locator('.setup-devtools > summary').click()
  await page.getByRole('checkbox', { name: 'この開発用の固定条件を確認しました' }).check()
  await page.getByRole('button', { name: '固定条件で旅程を作成' }).click()
  await expect(page).toHaveURL(/\/trips\/trip-.*\/compare\?proposalId=proposal-/)

  await page.locator('.compare-plan-card').first().getByRole('button', { name: 'この案にする' }).click()
  await expect(page).toHaveURL(/\/trips\/trip-[^/]+$/)
  await page.goBack()
  await expect(page).toHaveURL(/\/trips\/trip-.*\/compare\?proposalId=proposal-/)

  await page.locator('.compare-plan-card').nth(1).getByRole('button', { name: 'この案にする' }).click()
  await expect(page).toHaveURL(/\/trips\/trip-[^/?]+\?selectionConflict=VERSION_CONFLICT$/)
  await expect(page.getByRole('heading', { name: '最新の旅程を確認してください' })).toBeVisible()
  await expect(page.locator('.trip-selection-conflict')).toContainText('古い案は自動採用していません')
  await expect(page.locator('.trip-selection-status code')).toHaveText('plan-baseline')
  await expect(page.locator('.trip-selection-status')).toContainText('2')
})

test('synchronous double activation sends only one selection request', async ({ page }) => {
  await page.goto('/plan/new')
  await page.locator('.setup-devtools > summary').click()
  await page.getByRole('checkbox', { name: 'この開発用の固定条件を確認しました' }).check()
  await page.getByRole('button', { name: '固定条件で旅程を作成' }).click()
  await expect(page).toHaveURL(/\/trips\/trip-.*\/compare\?proposalId=proposal-/)

  let selectionRequests = 0
  page.on('request', (request) => {
    if (request.url().includes('/selection')) selectionRequests += 1
  })
  await page.locator('.compare-plan-card').nth(1).getByRole('button', { name: 'この案にする' }).evaluate((button) => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })

  await expect(page).toHaveURL(/\/trips\/trip-[^/]+$/)
  expect(selectionRequests).toBe(1)
  await expect(page.locator('.trip-selection-status code')).toHaveText('plan-time_shift')
})
