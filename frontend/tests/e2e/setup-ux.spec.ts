import { expect, test } from './fixtures'

test('empty review explains missing fields and links directly to the date input on mobile', async ({ page }) => {
  await page.goto('/plan/new')
  await expect(page.locator('.setup-devtools')).not.toHaveAttribute('open', '')
  await expect(page.locator('#trip-date')).toHaveAttribute('type', 'date')
  await expect(page.locator('#trip-date')).toBeInViewport({ ratio: 1 })
  await page.screenshot({ path: 'test-results/setup-ux-mobile.png', fullPage: false })
  await page.getByRole('button', { name: '条件を確認する', exact: true }).click()
  const errors = page.locator('.trip-form__errors')
  await expect(errors).toBeFocused()
  await errors.getByRole('link', { name: /旅行日/ }).first().click()
  await expect(page.locator('#trip-date')).toBeFocused()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('error links reveal a collapsed optional field instead of leaving the user searching', async ({ page }) => {
  await page.goto('/plan/new')
  await page.getByRole('button', { name: '開発用サンプル条件を読み込む' }).click()
  const details = page.locator('.trip-form__advanced')
  await details.locator(':scope > summary').click()
  await page.locator('#trip-waitAssumptions-0-waitMinutes').fill('-1')
  await details.locator(':scope > summary').click()
  await page.getByRole('button', { name: '条件を確認する', exact: true }).click()
  await page.locator('.trip-form__errors').getByRole('link', { name: /計算に使う待ち時間/ }).first().click()
  await expect(details).toHaveAttribute('open', '')
  await expect(page.locator('#trip-waitAssumptions-0-waitMinutes')).toBeFocused()
})

test('desktop summary, explicit return shortcut and language changes keep the reviewed preferences honest', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/plan/new')
  await page.getByRole('button', { name: '開発用サンプル条件を読み込む' }).click()
  const summary = page.getByRole('complementary', { name: 'いまの旅行条件' })
  await expect(summary).toBeVisible()
  await expect(summary).toContainText('2 / 6')
  // The "/ 6" is the system maximum, not the user's visit limit (3 in the sample).
  await expect(summary).toContainText('システムで選べるのは最大6件です。')
  await expect(page.locator('.trip-form__place-preview').first()).toBeVisible()
  await page.screenshot({ path: 'test-results/setup-ux-desktop.png', fullPage: false })
  await page.locator('#trip-endSpotId').selectOption('demo-garden')
  await page.getByRole('button', { name: '条件を確認する', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'この条件で提案します', exact: true })).toBeFocused()
  await page.getByRole('checkbox', { name: '内容と仮定を確認しました', exact: true }).check()
  await page.getByRole('button', { name: '出発地と同じにする', exact: true }).click()
  await expect(page.locator('#trip-endSpotId')).toHaveValue('demo-origin')
  await expect(page.getByRole('heading', { name: 'この条件で提案します', exact: true })).not.toBeVisible()
  await page.getByRole('button', { name: 'English', exact: true }).click()
  await expect(page.locator('#trip-maxWalkKm')).toHaveValue('3')
  await expect(page.locator('#trip-date')).toHaveValue('2026-11-05')
  await expect(page.getByRole('complementary', { name: 'Your trip so far' })).toContainText('2 / 6')
  await expect(page.getByRole('complementary', { name: 'Your trip so far' })).toContainText('The system supports up to 6 places.')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('when every place is a must-see, the form explains how to get a place-shift option', async ({ page }) => {
  await page.goto('/plan/new')
  await page.getByRole('button', { name: '開発用サンプル条件を読み込む' }).click()
  const hint = page.locator('#trip-all-must-hint')
  // The sample keeps one flexible visit, so a place-shift option is still possible.
  await expect(hint).toHaveCount(0)
  const second = page.locator('select[name="requestedStops.1.requirement"]')
  await second.selectOption('must')
  await expect(hint).toBeVisible()
  await expect(hint).toContainText('体験が合えば別の場所でもよい')
  await second.selectOption('optional')
  await expect(hint).toHaveCount(0)
})

test('choosing "leave it to us" replaces the per-place options with an explanation and shows in the review', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/plan/new')
  await page.getByRole('button', { name: '開発用サンプル条件を読み込む' }).click()
  await page.locator('#trip-requestedStops-1-spotId').selectOption('__omakase__')
  await expect(page.locator('#trip-omakase-1')).toContainText('楽しみたい体験に合い')
  // The per-place must/fixed-time controls are hidden for an お任せ row.
  await expect(page.locator('select[name="requestedStops.1.requirement"]')).toHaveCount(0)
  await expect(page.getByRole('complementary', { name: 'いまの旅行条件' })).toContainText('お任せ')
  // A flexible お任せ row means a place-shift option is still possible.
  await expect(page.locator('#trip-all-must-hint')).toHaveCount(0)
})

for (const locale of ['ja', 'en'] as const) {
  test(`${locale}: more places than the visit limit is explained while editing and focused on review`, async ({ page }) => {
    const text = locale === 'ja'
      ? { load: '開発用サンプル条件を読み込む', review: '条件を確認する', over: '行きたい場所が2件あり、訪問数の上限（1件）を超えています' }
      : { load: 'Load development sample preferences', review: 'Review preferences', over: 'You have 2 places to visit, which is more than your visit limit (1)' }
    await page.goto('/plan/new')
    if (locale === 'en') await page.getByRole('button', { name: 'English', exact: true }).click()
    await page.getByRole('button', { name: text.load }).click()
    // Loading the sample is asynchronous; wait for it so it cannot overwrite the limit typed below.
    await expect(page.locator('#trip-maxVisits')).toHaveValue('2')
    const notice = page.locator('#trip-visit-limit')
    const besideLimit = page.locator('.trip-form__limit-notice').filter({ hasNot: page.locator('#trip-visit-limit') })
    await expect(notice).toHaveText('')
    // The sample has 2 places; lowering the limit explains the mismatch at once, near the places and the limit.
    await page.locator('#trip-maxVisits').fill('1')
    await expect(notice).toContainText(text.over)
    await expect(page.locator('.trip-form__limit-notice')).toHaveCount(2)
    await expect(page.locator('.trip-form__limit-notice').nth(1)).toContainText(text.over)
    await page.getByRole('button', { name: text.review, exact: true }).click()
    await expect(notice).toBeFocused()
    await expect(page.locator('.trip-form__errors')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    // The summary link leads back to the same explanation.
    await page.locator('#trip-maxVisits').focus()
    await page.locator('.trip-form__errors a').filter({ hasText: locale === 'ja' ? '行きたい場所' : 'Places to visit' }).first().click()
    await expect(notice).toBeFocused()
    // Raising the limit clears both notices without submitting again.
    await page.locator('#trip-maxVisits').fill('2')
    await expect(notice).toHaveText('')
    await expect(besideLimit).toHaveCount(0)
    await expect(page.locator('.trip-form__limit-notice')).toHaveCount(0)
  })
}

for (const locale of ['ja', 'en'] as const) {
  test(`${locale}: fewer places than the visit limit are filled with "leave it to us" slots, shown before review`, async ({ page }) => {
    const text = locale === 'ja'
      ? { load: '開発用サンプル条件を読み込む', review: '条件を確認する', notice: '訪問数の上限まであと2件です。残りの2件は、楽しみたい体験に合う場所をお任せで追加します。', summary: 'いまの旅行条件', auto: 'お任せ（自動で追加）', autoShort: '上限に合わせて自動で追加', confirm: 'この条件で提案します' }
      : { load: 'Load development sample preferences', review: 'Review preferences', notice: 'You can visit 2 more place(s) within your visit limit.', summary: 'Your trip so far', auto: 'Leave it to us (added automatically)', autoShort: 'Added to reach your limit', confirm: 'Review before generating' }
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto('/plan/new')
    if (locale === 'en') await page.getByRole('button', { name: 'English', exact: true }).click()
    await page.getByRole('button', { name: text.load }).click()
    // The dev sample's limit equals its 2 places, so nothing is added yet.
    await expect(page.locator('#trip-maxVisits')).toHaveValue('2')
    await expect(page.locator('#trip-visit-limit')).toHaveText('')
    await page.locator('#trip-maxVisits').fill('4')
    await expect(page.locator('#trip-visit-limit')).toContainText(text.notice)
    await expect(page.locator('.trip-form__auto-notice')).toHaveCount(2)
    // The user's own rows are unchanged; the slots are only announced and summarised.
    await expect(page.locator('.trip-form__visit')).toHaveCount(2)
    const summary = page.getByRole('complementary', { name: text.summary })
    await expect(summary).toContainText('4 / 6')
    await expect(summary.getByText(text.autoShort, { exact: true })).toHaveCount(2)
    await page.getByRole('button', { name: text.review, exact: true }).click()
    await expect(page.getByRole('heading', { name: text.confirm, exact: true })).toBeFocused()
    await expect(page.locator('.trip-form__review-auto')).toHaveCount(2)
    await expect(page.locator('.trip-form__review-auto').first()).toContainText(text.auto)
    // Matching the limit again removes the automatic slots.
    await page.locator('#trip-maxVisits').fill('2')
    await expect(page.locator('#trip-visit-limit')).toHaveText('')
    await expect(page.locator('.trip-form__auto-notice')).toHaveCount(0)
    await expect(summary).toContainText('2 / 6')
  })
}

test('automatic "leave it to us" slots stop at the API maximum of 3 and say so', async ({ page }) => {
  await page.goto('/plan/new')
  await page.getByRole('button', { name: '開発用サンプル条件を読み込む' }).click()
  await expect(page.locator('#trip-maxVisits')).toHaveValue('2')
  await page.locator('#trip-maxVisits').fill('6')
  await expect(page.locator('#trip-visit-limit')).toContainText('訪問数の上限まであと4件ですが、お任せは最大3件までのため、お任せで追加するのは3件です。')
  await page.getByRole('button', { name: '条件を確認する', exact: true }).click()
  await expect(page.locator('.trip-form__review-auto')).toHaveCount(3)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
