import { expect, test } from './fixtures'
import { planCards } from './planUi'

test.use({ timezoneId: 'America/New_York' })

for (const locale of ['ja', 'en'] as const) {
  test(`${locale}: editable form confirms, generates and compares a labelled fixed sample`, async ({ page }) => {
    await page.goto('/plan/new')
    if (locale === 'en') await page.getByRole('button', { name: 'English', exact: true }).click()
    await page.getByRole('button', { name: locale === 'ja' ? '開発用サンプル条件を読み込む' : 'Load development sample preferences' }).click()
    await expect(page.locator('#trip-date')).toHaveValue('2026-11-05')
    await expect(page.locator('#trip-startTime')).toHaveValue('09:00')
    await expect(page.locator('#trip-startSpotId')).toHaveValue('demo-origin')
    await expect(page.locator('#trip-date')).toHaveAttribute('type', 'date')
    await page.getByRole('button', { name: locale === 'ja' ? '条件を確認する' : 'Review preferences', exact: true }).click()
    const generate = page.getByRole('button', { name: locale === 'ja' ? 'この条件で提案' : 'Generate with these preferences', exact: true })
    await expect(generate).toBeDisabled()
    await page.getByRole('checkbox', { name: locale === 'ja' ? '内容と仮定を確認しました' : 'I have reviewed these preferences and assumptions', exact: true }).check()
    await generate.click()
    await expect(page).toHaveURL(/\/trips\/trip-.*\/compare\?proposalId=proposal-/)
    await expect(planCards(page)).toHaveCount(3)
  })
}

test('language changes keep inputs; editing preferences invalidates the confirmation', async ({ page }) => {
  await page.goto('/plan/new')
  await page.getByRole('button', { name: '開発用サンプル条件を読み込む' }).click()
  await page.getByRole('button', { name: '条件を確認する', exact: true }).click()
  await page.getByRole('checkbox', { name: '内容と仮定を確認しました', exact: true }).check()
  await page.locator('#trip-maxWalkKm').fill('2.5')
  await expect(page.getByRole('heading', { name: 'この条件で提案します', exact: true })).not.toBeVisible()
  await page.getByRole('button', { name: 'English', exact: true }).click()
  await expect(page.locator('#trip-maxWalkKm')).toHaveValue('2.5')
  await expect(page.locator('#trip-date')).toHaveValue('2026-11-05')
  await page.getByRole('button', { name: 'Review preferences', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: 'I have reviewed these preferences and assumptions', exact: true })).not.toBeChecked()
  await expect(page.getByRole('button', { name: 'Generate with these preferences', exact: true })).toBeDisabled()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/setup-mobile-en.png', fullPage: true })
})

test('time errors are translated and AI ambiguity does not overwrite the form', async ({ page }) => {
  await page.goto('/plan/new')
  await page.getByRole('button', { name: '開発用サンプル条件を読み込む' }).click()
  await page.locator('#trip-endTime').fill('08:00')
  await page.getByRole('button', { name: '条件を確認する', exact: true }).click()
  await expect(page.locator('.trip-form__errors')).toContainText('終了は開始より後にしてください。')
  await page.locator('#trip-endTime').fill('13:00')
  await page.locator('#trip-wishes').fill('あまり歩きたくない')
  await page.getByRole('button', { name: 'AIで希望を整理', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('歩ける距離を入力してください。')
  await expect(page.getByRole('button', { name: '選択した項目をフォームへ反映' })).toBeDisabled()
  await page.getByRole('button', { name: '反映せず閉じる' }).click()
  await expect(page.locator('#trip-maxWalkKm')).toHaveValue('3')
  await expect(page).toHaveURL(/\/plan\/new$/)
})

test('a lost generation response retries the same UUID without creating another Trip', async ({ page }) => {
  await page.goto('/plan/new')
  await page.getByRole('button', { name: '開発用サンプル条件を読み込む' }).click()
  await page.evaluate(() => {
    const state = { creates: 0, generateIds: [] as string[] }
    ;(window as unknown as { retryProbe: typeof state }).retryProbe = state
    const original = window.fetch.bind(window)
    window.fetch = async (input, init) => {
      const request = input instanceof Request ? input.clone() : new Request(input, init)
      const path = new URL(request.url).pathname
      if (request.method === 'POST' && path === '/api/v1/trips') state.creates++
      const generation = request.method === 'POST' && /\/proposals$/.test(path)
      if (generation) state.generateIds.push((await request.clone().json()).client_request_id)
      const response = await original(input, init)
      if (generation && state.generateIds.length === 1) throw new TypeError('Simulated response loss after save')
      return response
    }
  })
  await page.getByRole('button', { name: '条件を確認する', exact: true }).click()
  await page.getByRole('checkbox', { name: '内容と仮定を確認しました', exact: true }).check()
  await page.getByRole('button', { name: 'この条件で提案', exact: true }).click()
  await expect(page.getByRole('button', { name: '同じ条件で再試行', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '同じ条件で再試行', exact: true }).click()
  await expect(page).toHaveURL(/\/trips\/trip-.*\/compare\?proposalId=proposal-/)
  const state = await page.evaluate(() => (window as unknown as { retryProbe: { creates: number; generateIds: string[] } }).retryProbe)
  expect(state.creates).toBe(1)
  expect(state.generateIds).toHaveLength(2)
  expect(state.generateIds[0]).toBe(state.generateIds[1])
})

test('Why groups facts and generates a new explanation without adoption or Trip creation', async ({ page }) => {
  await page.goto('/trips/demo-trip/compare?proposalId=demo-proposal')
  await page.getByRole('button', { name: '理由・不利益・不確実性', exact: true }).first().click()
  await expect(page.getByRole('heading', { name: '失うもの・増える負担', exact: true })).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: '条件を変えて再提案', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('説明言語の変更だけ')
  await dialog.getByLabel('新しい説明の言語').selectOption('en')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await dialog.getByRole('checkbox', { name: '内容と仮定を確認しました', exact: true }).check()
  await dialog.getByRole('button', { name: '条件を変えて再提案', exact: true }).click()
  await expect(page).toHaveURL(/\/trips\/demo-trip\/compare\?proposalId=proposal-/)
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page.getByText('説明の保存言語: en', { exact: false })).toBeVisible()
})

test('a response from the previous identity cannot navigate or expose a proposal', async ({ page }) => {
  await page.goto('/plan/new')
  await page.getByRole('button', { name: '開発用サンプル条件を読み込む' }).click()
  await page.evaluate(async () => {
    const modulePath = '/src/auth/session.ts'
    const session = await import(modulePath)
    const original = window.fetch.bind(window)
    window.fetch = async (input, init) => {
      const request = input instanceof Request ? input.clone() : new Request(input, init)
      const response = await original(input, init)
      if (request.method === 'POST' && /\/proposals$/.test(new URL(request.url).pathname)) session.setAuthIdentity('different-mock-user')
      return response
    }
  })
  await page.getByRole('button', { name: '条件を確認する', exact: true }).click()
  await page.getByRole('checkbox', { name: '内容と仮定を確認しました', exact: true }).check()
  await page.getByRole('button', { name: 'この条件で提案', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('認証が必要です')
  await expect(page).toHaveURL(/\/plan\/new$/)
  await expect(planCards(page)).toHaveCount(0)
})
