import type { Page } from '@playwright/test'

/** Select plans by the visible strategy and action, independent of C's layout CSS. */
export function planCard(page: Page, strategy: 'baseline' | 'time_shift' | 'place_shift', locale: 'ja' | 'en') {
  const titles = { ja: { baseline: '元案', time_shift: '時間ずらし案', place_shift: '場所ずらし案' }, en: { baseline: 'Baseline plan', time_shift: 'Time shift', place_shift: 'Place shift' } }
  return page.getByRole('article').filter({ has: page.getByRole('heading', { name: titles[locale][strategy], exact: true }) })
}
export function planCards(page: Page) {
  return page.getByRole('article').filter({ has: page.getByRole('button', { name: /^(この案にする|Adopt this plan)$/ }) })
}
