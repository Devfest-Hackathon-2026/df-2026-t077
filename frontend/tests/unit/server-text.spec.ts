import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import type { Spot } from '../../src/api/types'
import { knownPlanSummary, knownServerText, isOtherLanguage } from '../../src/i18n/serverText'

const spots = (JSON.parse(readFileSync(new URL('../../../data/curated/spots.json', import.meta.url), 'utf8')) as { items: Spot[] }).items

test('saved Japanese missing-option and unknown-wait notes become English without claiming measured relief', () => {
  const note = 'すべての訪問先が「必ずこの場所に行く」のため、場所案（訪問先を入れ替える案）は作れません。1か所以上を「体験が合えば別の場所でもよい」にすると提案できます。'
  expect(knownServerText(note, 'en')).toContain('Every visit is marked')
  expect(knownServerText('待ち時間が未入力の訪問先は計算に含めていません。空いているという意味ではありません。', 'en')).toBe('Unspecified waits are not included; this does not mean those spots are empty.')
  const text = knownServerText('本人が避けたい時間帯との重複を83分減らす時間案です。実際の混雑減少を示す値ではありません。', 'en')
  expect(text).toContain('83 minutes')
  expect(text).toContain('does not measure actual crowd reduction')
})

test('numeric signs and unknown omakase counts survive either display language', () => {
  const ja = '予定調整の待機は17分、歩行距離の差は-58mです。'
  const en = knownServerText(ja, 'en')!
  expect(en).toBe('Schedule waiting is 17 minutes and the walking-distance difference is -58 m.')
  expect(knownServerText(en, 'ja')).toBe(ja)
  expect(knownServerText('お任せ枠のうち2件は、楽しみたい体験に合い条件内に収まる場所が見つからなかったため追加していません。', 'en')).toContain('2 "leave it to us" slot(s) were not filled')
})

test('place reasons and losses use checked bilingual records, retaining original quantities and data', () => {
  const before = structuredClone(spots)
  const original = spots.find((spot) => spot.id === 'osu-shopping-street')!
  const replacement = spots.find((spot) => spot.id === 'banshoji')!
  const reason = `${replacement.name_ja}は、希望に関係する歴史を含む交換先です。元の${original.name_ja}との共通点は写真です。`
  const english = knownServerText(reason, 'en', spots)!
  expect(english).toContain(replacement.name_en)
  expect(english).toContain('requested history')
  expect(knownServerText(english, 'ja', spots)).toBe(reason)
  const loss = `${original.name_ja}を外すため食を失い、歴史が加わります。元の概要: ${original.description_ja} 交換先の概要: ${replacement.description_ja} 歩行距離の差は-58mです。`
  const translated = knownServerText(loss, 'en', spots)!
  expect(translated).toContain('loses food and adds history')
  expect(translated).toContain(original.description_en)
  expect(translated).toContain(replacement.description_en)
  expect(translated).toContain('-58 m')
  expect(knownServerText(translated, 'ja', spots)).toBe(loss)
  expect(spots).toEqual(before)
})

test('unrecognized or altered prose is not fabricated, including unknown place names and descriptions', () => {
  const invented = '必ず待ち時間が0分になります。'
  expect(knownServerText(invented, 'en', spots)).toBeUndefined()
  expect(knownPlanSummary(invented, 'en', spots)).toBeUndefined()
  expect(isOtherLanguage(invented, 'en')).toBe(true)
  expect(knownServerText('架空の場所は、希望に関係する歴史を含む交換先です。元の未確認の場所との共通点は写真です。', 'en', spots)).toBeUndefined()
})

test('a summary of verbatim confirmed facts can change language without changing facts', () => {
  const ja = '確認した訪問順を維持した元案です。 待ち時間が未入力の訪問先は計算に含めていません。空いているという意味ではありません。'
  // Only fully recognized summaries are translated; arbitrary generated wording stays as original.
  const en = knownPlanSummary('確認した訪問順を維持した元案です。', 'en', spots)
  expect(en).toBe('This baseline keeps the confirmed visit order.')
  expect(knownPlanSummary(ja, 'en', spots)).toContain('Unspecified waits are not included')
  expect(knownPlanSummary(ja + '未来の待ち時間も保証します。', 'en', spots)).toBeUndefined()
})
