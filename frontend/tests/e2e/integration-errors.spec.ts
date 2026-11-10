import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { messages } from '../../src/i18n/messages'
import { planCard } from './planUi'

interface Probe { requests: { path: string; body: Record<string, unknown> }[] }
async function sample(page: Page, locale: 'ja' | 'en') {
  await page.goto('/plan/new')
  if (locale === 'en') await page.getByRole('button', { name: 'English', exact: true }).click()
  await page.getByRole('button', { name: messages[locale].loadDemo }).click()
}
async function confirm(page: Page, locale: 'ja' | 'en') {
  await page.getByRole('button', { name: messages[locale].reviewConditions, exact: true }).click()
  await page.getByRole('checkbox', { name: messages[locale].confirmConditions, exact: true }).check()
  await page.getByRole('button', { name: messages[locale].generateProposal, exact: true }).click()
}
/** Explicit UI test responses, not a simulated optimizer or real Gemini result. */
async function respond(page: Page, endpoint: string, status: number, body: unknown, failures = 1) {
  await page.evaluate(({ endpoint, status, body, failures }) => {
    const probe: Probe = { requests: [] }
    ;(window as unknown as { integrationProbe: Probe }).integrationProbe = probe
    const original = window.fetch.bind(window)
    let remaining = failures
    window.fetch = async (input, init) => {
      const request = input instanceof Request ? input.clone() : new Request(input, init)
      const path = new URL(request.url).pathname
      if (request.method === 'POST') {
        probe.requests.push({ path, body: await request.clone().json() })
        if (path.endsWith(endpoint) && remaining-- > 0) return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
      }
      return original(input, init)
    }
  }, { endpoint, status, body, failures })
}
const failure = (code: string, details: unknown[] = []) => ({ error: { code, message: code, details, request_id: 'explicit-ui-test' } })

for (const locale of ['ja', 'en'] as const) {
  for (const [status, code] of [[429, 'RATE_LIMITED'], [503, 'DEPENDENCY_UNAVAILABLE'], [504, 'GENERATION_TIMEOUT']] as const) {
    test(`${locale}: ${status} keeps inputs and retries the same creation ID`, async ({ page }) => {
      await sample(page, locale)
      await respond(page, '/api/v1/trips', status, failure(code))
      await confirm(page, locale)
      await expect(page.getByRole('alert')).toContainText(messages[locale][code])
      await expect(page.locator('#trip-maxWalkKm')).toHaveValue('3')
      await expect(page.locator('#trip-date')).toHaveValue('2026-11-05')
      await page.getByRole('button', { name: messages[locale].retrySubmission, exact: true }).click()
      await expect(page).toHaveURL(/\/compare\?proposalId=proposal-/)
      const probe = await page.evaluate(() => (window as unknown as { integrationProbe: Probe }).integrationProbe)
      const creates = probe.requests.filter((r) => r.path === '/api/v1/trips')
      expect(creates).toHaveLength(2)
      expect(creates[0].body.client_request_id).toBe(creates[1].body.client_request_id)
    })
  }
  test(`${locale}: server 422 points to the correct field and preserves the reviewed input`, async ({ page }) => {
    await sample(page, locale)
    await respond(page, '/api/v1/trips', 422, failure('VALIDATION_ERROR', [{ code: 'invalid', message: 'Invalid value', field: 'body.constraints.max_walk_meters' }]))
    await confirm(page, locale)
    await expect(page.locator('#trip-maxWalkKm')).toHaveAttribute('aria-invalid', 'true')
    await expect(page.locator('#trip-maxWalkKm')).toHaveValue('3')
    await expect(page.locator('.trip-form__errors')).toContainText(messages[locale].maxWalkKm)
    await expect(page).toHaveURL(/\/plan\/new$/)
  })
}

test('a concrete AI draft applies only selected empty fields and never creates a Trip', async ({ page }) => {
  await page.goto('/plan/new')
  await page.locator('#trip-date').fill('2026-11-05')
  await expect(page.locator('#trip-startSpotId option')).toHaveCount(9)
  await respond(page, '/api/v1/intent/interpret', 200, {
    draft: { interests: ['history'], requested_stops: [{ spot_id: 'demo-museum', requirement: 'must', locked_start_at: null, reservation_confirmed: false }], max_walk_meters: 1500, end_at: '2026-11-05T13:00:00+09:00', avoid_windows: [], wait_assumptions: [], field_notes: [{ field: 'max_walk_meters', source_quote: '1.5kmまで' }] },
    unresolved: [], warnings: [], generation_mode: 'template', requires_confirmation: true,
  })
  await page.locator('#trip-wishes').fill('資料館は必須、1.5kmまで、13時までに戻りたい')
  await page.getByRole('button', { name: messages.ja.interpretIntent, exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('1.5kmまで')
  await expect(dialog.getByRole('button', { name: messages.ja.applyDraft })).toBeDisabled()
  await dialog.getByRole('checkbox', { name: messages.ja.maxWalkKm, exact: true }).check()
  await dialog.getByRole('checkbox', { name: messages.ja.visits, exact: true }).check()
  await dialog.getByRole('button', { name: messages.ja.applyDraft }).click()
  await expect(page.locator('#trip-maxWalkKm')).toHaveValue('1.5')
  await expect(page.locator('#trip-requestedStops-0-spotId')).toHaveValue('demo-museum')
  await expect(page.locator('#trip-endTime')).toHaveValue('')
  await expect(page.getByRole('checkbox', { name: messages.ja.history, exact: true })).not.toBeChecked()
  const probe = await page.evaluate(() => (window as unknown as { integrationProbe: Probe }).integrationProbe)
  expect(probe.requests.filter((r) => r.path === '/api/v1/trips')).toHaveLength(0)
})

test('an AI proposal conflicting with a manually entered distance is not applied', async ({ page }) => {
  await sample(page, 'ja')
  await respond(page, '/api/v1/intent/interpret', 200, {
    draft: { interests: null, requested_stops: [], max_walk_meters: 500, end_at: null, avoid_windows: [], wait_assumptions: [], field_notes: [] },
    unresolved: [], warnings: [], generation_mode: 'template', requires_confirmation: true,
  })
  await page.locator('#trip-wishes').fill('歩く距離を短くしたい')
  await page.getByRole('button', { name: messages.ja.interpretIntent, exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText(messages.ja.draftSkipped)
  await expect(page.getByRole('button', { name: messages.ja.applyDraft })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(page.locator('#trip-maxWalkKm')).toHaveValue('3')
  await expect(page.locator('#trip-requestedStops-0-spotId')).toHaveValue('demo-museum')
})

test('refine conflict requires a fresh review and preserves the selected itinerary', async ({ page }) => {
  await page.goto('/trips/demo-trip/compare?proposalId=demo-proposal')
  await planCard(page, 'time_shift', 'ja').getByRole('button', { name: 'この案にする', exact: true }).click()
  await expect(page).toHaveURL(/\/trips\/demo-trip$/)
  await page.getByRole('button', { name: messages.ja.refine, exact: true }).click()
  await page.evaluate(() => {
    const original = window.fetch.bind(window)
    let conflicted = false
    window.fetch = async (input, init) => {
      const request = input instanceof Request ? input.clone() : new Request(input, init)
      const path = new URL(request.url).pathname
      if (request.method === 'POST' && path.endsWith('/proposals')) {
        conflicted = true
        return new Response(JSON.stringify({ error: { code: 'VERSION_CONFLICT', message: 'VERSION_CONFLICT', details: [], request_id: 'explicit-conflict-test' } }), { status: 409, headers: { 'Content-Type': 'application/json' } })
      }
      const response = await original(input, init)
      if (conflicted && request.method === 'GET' && path === '/api/v1/trips/demo-trip') {
        const body = await response.json(); body.trip.version++
        return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return response
    }
  })
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('checkbox', { name: messages.ja.confirmConditions, exact: true }).check()
  await dialog.getByRole('button', { name: messages.ja.refine, exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText(messages.ja.VERSION_CONFLICT)
  await dialog.getByRole('button', { name: messages.ja.reviewLatest }).click()
  await expect(dialog.getByRole('checkbox', { name: messages.ja.confirmConditions, exact: true })).not.toBeChecked()
  await expect(dialog.getByRole('button', { name: messages.ja.refine, exact: true })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('region', { name: '採用情報' })).toContainText('plan-time_shift')
  await expect(page).toHaveURL(/\/trips\/demo-trip$/)
})

test('a processing refine request keeps its UUID instead of offering a new request', async ({ page }) => {
  await page.goto('/trips/demo-trip/compare?proposalId=demo-proposal')
  await page.getByRole('button', { name: messages.ja.why, exact: true }).first().click()
  await page.getByRole('dialog').getByRole('button', { name: messages.ja.refine, exact: true }).click()
  await respond(page, '/proposals', 409, failure('REQUEST_IN_PROGRESS'))
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('checkbox', { name: messages.ja.confirmConditions, exact: true }).check()
  await dialog.getByRole('button', { name: messages.ja.refine, exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText(messages.ja.REQUEST_IN_PROGRESS)
  await expect(dialog.getByRole('button', { name: messages.ja.reviewLatest })).toHaveCount(0)
  await dialog.getByRole('button', { name: messages.ja.refine, exact: true }).click()
  await expect(page).toHaveURL(/\/trips\/demo-trip\/compare\?proposalId=proposal-/)
  const probe = await page.evaluate(() => (window as unknown as { integrationProbe: Probe }).integrationProbe)
  const requests = probe.requests.filter((r) => r.path.endsWith('/proposals'))
  expect(requests).toHaveLength(2)
  expect(requests[0].body.client_request_id).toBe(requests[1].body.client_request_id)
})
