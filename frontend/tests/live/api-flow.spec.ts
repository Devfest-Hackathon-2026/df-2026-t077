import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { ProposalBundle, TripResponse } from '../../src/api/types'
import { messages } from '../../src/i18n/messages'
import { planCard, planCards } from '../e2e/planUi'

interface Probe { creates: number; proposalIds: string[]; savedProposalId?: string }

async function readTrip(page: Page, tripId: string): Promise<TripResponse> {
  return page.evaluate(async (tripId) => {
    const modulePath = '/src/auth/token.ts'
    const { getToken } = await import(modulePath)
    const response = await fetch(`http://127.0.0.1:8008/api/v1/trips/${tripId}`, { headers: { Authorization: `Bearer ${await getToken()}` } })
    if (response.status !== 200) throw new Error(`Trip read failed: ${response.status}`)
    return response.json()
  }, tripId)
}

// Actual SDK/Admin authentication, HTTP, planner and Firestore emulator; no MSW.
// Facilities/routes are synthetic demo data; external Gemini/Maps are deliberately disabled.
for (const locale of ['ja', 'en'] as const) {
  const strategy = locale === 'ja' ? 'time_shift' : 'place_shift'
  test(`${locale}: real local generation, lost-response retry, ${strategy} adoption, refine and reload`, async ({ page }) => {
    const t = messages[locale]
    await page.goto('/plan/new')
    await expect(page.locator('#trip-date')).toBeVisible()
    if (locale === 'en') await page.getByRole('button', { name: 'English', exact: true }).click()
    await expect(page.locator('.mock-banner')).toHaveCount(0)
    // Discard only the first successful generation response, after the real server has saved it.
    await page.evaluate(() => {
      const probe: Probe = { creates: 0, proposalIds: [] }
      ;(window as unknown as { localProbe: Probe }).localProbe = probe
      const original = window.fetch.bind(window)
      window.fetch = async (input, init) => {
        const request = input instanceof Request ? input.clone() : new Request(input, init)
        const path = new URL(request.url).pathname
        if (request.method === 'POST' && path === '/api/v1/trips') probe.creates++
        const generation = request.method === 'POST' && /\/proposals$/.test(path)
        if (generation) probe.proposalIds.push((await request.json()).client_request_id)
        const response = await original(input, init)
        if (generation && probe.proposalIds.length === 1 && response.status === 201) {
          probe.savedProposalId = (await response.clone().json()).id
          throw new TypeError('Test: response lost after actual server save')
        }
        return response
      }
    })
    await page.locator('#trip-date').fill('2026-11-09')
    await page.locator('#trip-startTime').fill('09:00')
    await page.locator('#trip-endTime').fill('13:00')
    await page.locator('#trip-maxWalkKm').fill('3')
    // Equal to the 2 places chosen below, so no "leave it to us" slot is added automatically.
    await page.locator('#trip-maxVisits').fill('2')
    await page.locator('#trip-partySize').fill('1')
    await page.getByRole('checkbox', { name: t.history, exact: true }).check()
    await page.getByRole('checkbox', { name: t.quiet, exact: true }).check()
    await page.locator('#trip-startSpotId').selectOption('demo-origin')
    await page.locator('#trip-endSpotId').selectOption('demo-origin')
    await page.getByRole('button', { name: t.addVisit, exact: true }).click()
    await page.locator('#trip-requestedStops-0-spotId').selectOption('demo-museum')
    await page.locator('select[name="requestedStops.0.requirement"]').selectOption('must')
    await page.getByRole('button', { name: t.addVisit, exact: true }).click()
    await page.locator('#trip-requestedStops-1-spotId').selectOption('demo-cafe')
    await page.getByText(t.advanced, { exact: true }).click()
    await page.getByRole('button', { name: t.addAvoid, exact: true }).click()
    await page.locator('#trip-avoidWindows-0-spotId').selectOption('demo-museum')
    await page.locator('#trip-avoidWindows-0-startTime').fill('09:00')
    await page.locator('#trip-avoidWindows-0-endTime').fill('10:00')
    await page.getByRole('button', { name: t.addWait, exact: true }).click()
    await page.locator('#trip-waitAssumptions-0-spotId').selectOption('demo-museum')
    await page.locator('#trip-waitAssumptions-0-waitMinutes').fill('10')

    // The endpoint is wired; local tests have no Vertex credentials, so the manual form must remain usable.
    await page.locator('#trip-wishes').fill('museum is a must, prefer quiet places')
    const [intent] = await Promise.all([
      page.waitForResponse((r) => new URL(r.url()).pathname === '/api/v1/intent/interpret'),
      page.getByRole('button', { name: t.interpretIntent, exact: true }).click(),
    ])
    expect(intent.status()).toBe(503)
    await expect(page.locator('#trip-maxWalkKm')).toHaveValue('3')
    await page.getByRole('button', { name: t.reviewConditions, exact: true }).click()
    await page.getByRole('checkbox', { name: t.confirmConditions, exact: true }).check()
    const [created] = await Promise.all([
      page.waitForResponse((r) => new URL(r.url()).pathname === '/api/v1/trips' && r.request().method() === 'POST'),
      page.getByRole('button', { name: t.generateProposal, exact: true }).click(),
    ])
    expect(created.status()).toBe(201)
    const stored: TripResponse = await created.json()
    const tripId = stored.trip.id
    expect(stored.trip.constraints.start_at).toBe('2026-11-09T09:00:00+09:00')
    await expect(page.getByRole('button', { name: t.retrySubmission, exact: true })).toBeVisible()
    const [replayed] = await Promise.all([
      page.waitForResponse((r) => /\/proposals$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST'),
      page.getByRole('button', { name: t.retrySubmission, exact: true }).click(),
    ])
    expect(replayed.status()).toBe(201)
    const bundle: ProposalBundle = await replayed.json()
    await expect(page).toHaveURL(new RegExp(`/trips/${tripId}/compare\\?proposalId=${bundle.id}$`))
    await expect(planCards(page)).toHaveCount(3)
    const probe = await page.evaluate(() => (window as unknown as { localProbe: Probe }).localProbe)
    expect(probe.creates).toBe(1)
    expect(probe.proposalIds).toHaveLength(2)
    expect(probe.proposalIds[0]).toBe(probe.proposalIds[1])
    expect(bundle.id).toBe(probe.savedProposalId)
    const selected = bundle.alternatives.find((p) => p.strategy === strategy)!
    expect(selected.stops.some((stop) => stop.spot_id === 'demo-museum')).toBe(true)
    await planCard(page, strategy, locale).getByRole('button', { name: t.why, exact: true }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    const [selection] = await Promise.all([
      page.waitForResponse((r) => /\/selection$/.test(new URL(r.url()).pathname)),
      planCard(page, strategy, locale).getByRole('button', { name: locale === 'ja' ? 'この案にする' : 'Adopt this plan', exact: true }).click(),
    ])
    expect(selection.status()).toBe(200)
    await expect(page).toHaveURL(new RegExp(`/trips/${tripId}$`))
    await expect(page.getByRole('region', { name: locale === 'ja' ? '採用情報' : 'Saved selection' })).toContainText(selected.id)
    const adopted = await readTrip(page, tripId)
    expect(adopted.trip.version).toBe(2)
    expect(adopted.active_plan?.id).toBe(selected.id)
    expect(adopted.trip.requested_stops.find((s) => s.spot_id === 'demo-museum')?.requirement).toBe('must')
    if (strategy === 'place_shift') expect(adopted.trip.requested_stops.some((s) => s.spot_id !== 'demo-museum' && s.spot_id !== 'demo-cafe')).toBe(true)

    await page.getByRole('button', { name: t.refine, exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.locator('#trip-maxWalkKm').fill('2.5')
    await dialog.getByRole('checkbox', { name: t.confirmConditions, exact: true }).check()
    const [refinedResponse] = await Promise.all([
      page.waitForResponse((r) => /\/proposals$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST'),
      dialog.getByRole('button', { name: t.refine, exact: true }).click(),
    ])
    expect(refinedResponse.status()).toBe(201)
    const refined: ProposalBundle = await refinedResponse.json()
    expect(refined.request.mode).toBe('refine')
    expect(refined.base_version).toBe(2)
    expect(refined.effective_constraints.max_walk_meters).toBe(2500)
    expect(refined.baseline).not.toBeNull()
    expect(refined.baseline?.stops.filter((s) => s.role === 'visit').map((s) => s.spot_id)).toEqual(adopted.trip.requested_stops.map((s) => s.spot_id))
    // Generating another proposal must not adopt it or change the saved constraints.
    const unchanged = await readTrip(page, tripId)
    expect(unchanged.trip.version).toBe(2)
    expect(unchanged.active_plan?.id).toBe(selected.id)
    expect(unchanged.trip.constraints.max_walk_meters).toBe(3000)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

    // Keep tokens within the browser; return only non-secret status checks.
    const checks = await page.evaluate(async (tripId) => {
      const url = `http://127.0.0.1:8008/api/v1/trips/${tripId}`
      const anonymous = await fetch(url)
      const signup = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=local-emulator-only', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }) })
      const { idToken } = await signup.json()
      const forbidden = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } })
      return { anonymous: anonymous.status, signup: signup.status, forbidden: forbidden.status, leaked: (await forbidden.text()).includes(tripId) }
    }, tripId)
    expect(checks).toEqual({ anonymous: 401, signup: 200, forbidden: 404, leaked: false })
    await page.goto(`/trips/${tripId}`)
    await expect(page.getByRole('region', { name: locale === 'ja' ? '採用情報' : 'Saved selection' })).toContainText(selected.id)
    await page.reload()
    await expect(page.getByRole('region', { name: locale === 'ja' ? '採用情報' : 'Saved selection' })).toContainText(locale === 'ja' ? '旅程バージョン: 2' : 'Trip version: 2')
    expect((await readTrip(page, tripId)).active_plan?.id).toBe(selected.id)
  })
}
