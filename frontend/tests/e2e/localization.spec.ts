import { test, expect } from './fixtures'
import { messages } from '../../src/i18n/messages'
import type { ProposalBundle } from '../../src/api/types'
import { planCard, planCards } from './planUi'

test('switching language after Japanese generation translates warnings and facts without generating or adopting', async ({ page }) => {
  await page.goto('/trips/demo-trip/compare?proposalId=demo-proposal')
  await expect(planCards(page)).toHaveCount(3)
  const times = await page.locator('.compare-stop time').allTextContents()
  const metrics = await page.locator('.compare-metrics dd').allTextContents()
  const posts: string[] = []
  page.on('request', (request) => { if (request.method() === 'POST') posts.push(new URL(request.url()).pathname) })
  await page.getByRole('button', { name: 'English', exact: true }).click()
  await expect(page.locator('.compare-page')).toContainText('Saved explanation language: ja')
  await expect(page.locator('.compare-warning-list').first()).toContainText('Crowding is unknown')
  await expect(planCard(page, 'place_shift', 'en').locator('.compare-why')).toContainText('The cafe experience is lost.')
  expect(await page.locator('.compare-stop time').allTextContents()).toEqual(times)
  expect(await page.locator('.compare-metrics dd').allTextContents()).toEqual(metrics)
  for (const card of await planCards(page).all()) expect(await card.innerText()).not.toMatch(/[ぁ-んァ-ヶ一-龯]/)
  await planCard(page, 'place_shift', 'en').getByRole('button', { name: messages.en.why, exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('The cafe experience is lost.')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '日本語', exact: true }).click()
  await expect(planCard(page, 'place_shift', 'ja').locator('.compare-why')).toContainText('カフェの体験を失います。')
  expect(posts).toEqual([])
})

test('unrecognized AI prose stays available as original, alongside a labelled fact-based summary', async ({ page }) => {
  await page.goto('/plan/new')
  await expect(page.getByRole('link', { name: messages.ja.sample, exact: false })).toBeVisible()
  await page.evaluate(() => {
    const original = window.fetch.bind(window)
    window.fetch = async (input, init) => {
      const request = input instanceof Request ? input.clone() : new Request(input, init)
      const response = await original(input, init)
      if (request.method !== 'GET' || !/\/proposals\/demo-proposal$/.test(new URL(request.url).pathname)) return response
      const bundle: ProposalBundle = await response.clone().json()
      bundle.baseline!.explanation.summary = 'これは検査用の未登録の生成AI説明です。'
      bundle.baseline!.explanation.generation_mode = 'gemini'
      bundle.baseline!.facts.push({ id: 'untranslated-risk', kind: 'tradeoff', text: '検査用の個別の不利益を省略しない。', evidence_ids: [], is_demo: true })
      bundle.baseline!.explanation.tradeoff_fact_ids = ['untranslated-risk']
      return new Response(JSON.stringify(bundle), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
  })
  await page.getByRole('link', { name: messages.ja.sample, exact: false }).click()
  await expect(planCards(page)).toHaveCount(3)
  await page.getByRole('button', { name: 'English', exact: true }).click()
  const card = planCard(page, 'baseline', 'en')
  await expect(card.locator('.plan-text-summary')).toContainText('Display summary from the saved facts')
  await expect(card.locator('.plan-text-summary')).toContainText('Synthetic sample preserving the requested visit order.')
  await expect(card.getByText('これは検査用の未登録の生成AI説明です。', { exact: true })).not.toBeVisible()
  await card.locator('.plan-text-summary').getByRole('button', { name: 'Read original Japanese text', exact: true }).click()
  await expect(card.getByText('これは検査用の未登録の生成AI説明です。', { exact: true })).toBeVisible()
  await expect(card.locator('.plan-text-summary [lang="ja"]')).toBeVisible()
  const tradeoff = card.locator('.compare-explanation-summary > div').filter({ hasText: messages.en.tradeoffs })
  await tradeoff.getByRole('button', { name: 'Read original Japanese text', exact: true }).click()
  await expect(tradeoff).toContainText('検査用の個別の不利益を省略しない。')
})

test('AI interpretation follows the parent date after a language switch, reset and reload of candidates', async ({ page }) => {
  await page.goto('/plan/new')
  await page.getByRole('button', { name: 'English', exact: true }).click()
  await page.locator('#trip-date').fill('2026-11-05')
  await page.locator('#trip-wishes').fill('I want a quiet visit to the museum.')
  const intent = page.locator('.trip-form__intent')
  const organize = intent.getByRole('button', { name: messages.en.interpretIntent, exact: true })
  await expect(organize).toBeEnabled()
  await expect(intent.getByText(messages.en.dateFirst, { exact: true })).toHaveCount(0)
  await page.locator('#trip-date').fill('')
  await expect(organize).toBeDisabled()
  await expect(intent.getByText(messages.en.dateFirst, { exact: true })).toBeVisible()
  await page.locator('#trip-date').fill('2026-11-05')
  await expect(organize).toBeEnabled()
  await organize.click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('dialog')).toContainText('I want a quiet visit to the museum.')
})
