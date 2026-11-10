import type { Locale, Spot } from '../api/types'
import { plannerTextPairs } from './plannerTextPairs'

type Pair = readonly [string, string]
const interestLabels: Pair[] = [['歴史', 'history'], ['写真', 'photography'], ['自然', 'nature'], ['食', 'food'], ['芸術', 'art'], ['静かな環境', 'quiet atmosphere'], ['明示なし', 'none stated']]
function interests(value: string, locale: Locale): string | undefined {
  const items = value.split(', ')
  const translated = items.map((item) => interestLabels.find(([ja, en]) => item === ja || item === en)?.[locale === 'ja' ? 0 : 1])
  return translated.every((item) => item !== undefined) ? translated.join(', ') : undefined
}
function place(value: string, spots: Spot[]): Spot | undefined {
  return spots.find((spot) => [spot.id, spot.name_ja, spot.name_en].includes(value))
}

/** Translate only recognized deterministic messages. Never invent a translation of arbitrary AI text. */
export function knownServerText(text: string, locale: Locale, spots: Spot[] = []): string | undefined {
  for (const [ja, en] of plannerTextPairs) if (text === ja || text === en) return locale === 'ja' ? ja : en
  if (text === 'EXPLANATION_FALLBACK') return locale === 'ja'
    ? '説明生成が利用できなかったため定型文を使用しています。旅程自体は引き続き比較できます。'
    : 'The explanation uses a template because generated explanation was unavailable. The itinerary itself remains available.'
  const numeric: { ja: RegExp; en: RegExp; render: (values: string[], locale: Locale) => string }[] = [
    { ja: /^本人が避けたい時間帯との重複を(\d+)分減らす時間案です。実際の混雑減少を示す値ではありません。$/, en: /^This time option reduces overlap with the user's avoid window by (\d+) minutes; it does not measure actual crowd reduction\.$/, render: ([n], l) => l === 'ja' ? `本人が避けたい時間帯との重複を${n}分減らす時間案です。実際の混雑減少を示す値ではありません。` : `This time option reduces overlap with the user's avoid window by ${n} minutes; it does not measure actual crowd reduction.` },
    { ja: /^予定調整の待機は(\d+)分、歩行距離の差は([+-]?\d+)mです。$/, en: /^Schedule waiting is (\d+) minutes and the walking-distance difference is ([+-]?\d+) m\.$/, render: ([wait, distance], l) => l === 'ja' ? `予定調整の待機は${wait}分、歩行距離の差は${distance}mです。` : `Schedule waiting is ${wait} minutes and the walking-distance difference is ${distance} m.` },
    { ja: /^予定調整の待機は(\d+)分、歩行距離は(\d+)mです。$/, en: /^Schedule waiting is (\d+) minutes and walking distance is (\d+) m\.$/, render: ([wait, distance], l) => l === 'ja' ? `予定調整の待機は${wait}分、歩行距離は${distance}mです。` : `Schedule waiting is ${wait} minutes and walking distance is ${distance} m.` },
    { ja: /^予定調整の待機は合計(\d+)分です。$/, en: /^This option includes (\d+) minutes of schedule waiting\.$/, render: ([wait], l) => l === 'ja' ? `予定調整の待機は合計${wait}分です。` : `This option includes ${wait} minutes of schedule waiting.` },
    { ja: /^お任せ枠のうち(\d+)件は、楽しみたい体験に合い条件内に収まる場所が見つからなかったため追加していません。$/, en: /^(\d+) "leave it to us" slot\(s\) were not filled: no place matching your interests fits within the conditions\.$/, render: ([n], l) => l === 'ja' ? `お任せ枠のうち${n}件は、楽しみたい体験に合い条件内に収まる場所が見つからなかったため追加していません。` : `${n} "leave it to us" slot(s) were not filled: no place matching your interests fits within the conditions.` },
  ]
  for (const template of numeric) {
    const match = template.ja.exec(text) ?? template.en.exec(text)
    if (match) return template.render(match.slice(1), locale)
  }

  const reasonJa = /^(.+)は、希望に関係する(.+)を含む交換先です。元の(.+)との共通点は(.+)です。$/.exec(text)
  const reasonEn = /^(.+) is a replacement related to the requested (.+) experience\. It shares (.+) with (.+)\.$/.exec(text)
  if (reasonJa || reasonEn) {
    const replacement = place((reasonJa ?? reasonEn)![1], spots)
    const original = place(reasonJa ? reasonJa[3] : reasonEn![4], spots)
    const matched = interests((reasonJa ?? reasonEn)![2], locale)
    const common = interests(reasonJa ? reasonJa[4] : reasonEn![3], locale)
    if (replacement && original && matched && common) return locale === 'ja'
      ? `${replacement.name_ja}は、希望に関係する${matched}を含む交換先です。元の${original.name_ja}との共通点は${common}です。`
      : `${replacement.name_en} is a replacement related to the requested ${matched} experience. It shares ${common} with ${original.name_en}.`
  }
  const tradeoffJa = /^(.+)を外すため(.+)を失い、(.+)が加わります。元の概要: (.+) 交換先の概要: (.+) 歩行距離(の差)?は([+-]?\d+)mです。$/s.exec(text)
  const tradeoffEn = /^Replacing (.+) loses (.+) and adds (.+)\. Original: (.+) Replacement: (.+) (The walking-distance difference|Walking distance) is ([+-]?\d+) m\.$/s.exec(text)
  const tradeoff = tradeoffJa ?? tradeoffEn
  if (tradeoff) {
    const original = place(tradeoff[1], spots)
    const replacement = spots.find((spot) => (tradeoffJa ? spot.description_ja : spot.description_en) === tradeoff[5])
    const lost = interests(tradeoff[2], locale), gained = interests(tradeoff[3], locale)
    const difference = tradeoffJa ? !!tradeoff[6] : tradeoff[6] === 'The walking-distance difference'
    if (original && replacement && lost && gained && (tradeoffJa ? original.description_ja : original.description_en) === tradeoff[4]) return locale === 'ja'
      ? `${original.name_ja}を外すため${lost}を失い、${gained}が加わります。元の概要: ${original.description_ja} 交換先の概要: ${replacement.description_ja} 歩行距離${difference ? 'の差' : ''}は${tradeoff[7]}mです。`
      : `Replacing ${original.name_en} loses ${lost} and adds ${gained}. Original: ${original.description_en} Replacement: ${replacement.description_en} ${difference ? 'The walking-distance difference' : 'Walking distance'} is ${tradeoff[7]} m.`
  }
  const omakaseJa = /^お任せ枠として、楽しみたい体験（(.+)）に合い、営業時間と移動の条件に収まる(.+)を選びました。$/.exec(text)
  const omakaseEn = /^For your "leave it to us" slot, (.+) was chosen: it matches (.+) and fits the opening hours and walking route\.$/.exec(text)
  if (omakaseJa || omakaseEn) {
    const selected = place(omakaseJa ? omakaseJa[2] : omakaseEn![1], spots)
    const matched = interests(omakaseJa ? omakaseJa[1] : omakaseEn![2], locale)
    if (selected && matched) return locale === 'ja'
      ? `お任せ枠として、楽しみたい体験（${matched}）に合い、営業時間と移動の条件に収まる${selected.name_ja}を選びました。`
      : `For your "leave it to us" slot, ${selected.name_en} was chosen: it matches ${matched} and fits the opening hours and walking route.`
  }
  return undefined
}

export function isOtherLanguage(text: string, locale: Locale, sourceLocale?: Locale): boolean {
  const japanese = /[ぁ-んァ-ヶ一-龯]/.test(text)
  return locale === 'en' ? japanese : sourceLocale === 'en' && !japanese
}

/** Summaries assembled verbatim from known facts can be translated without a model call. */
export function knownPlanSummary(text: string, locale: Locale, spots: Spot[]): string | undefined {
  const exact = knownServerText(text, locale, spots)
  if (exact) return exact
  const originals = plannerTextPairs.flatMap(([ja, en]) => [ja, en]).sort((a, b) => b.length - a.length)
  let remaining = text.trim()
  const translated: string[] = []
  while (remaining) {
    const tail = knownServerText(remaining, locale, spots)
    if (tail) { translated.push(tail); remaining = ''; break }
    const prefix = originals.find((original) => remaining.startsWith(original))
    if (!prefix) return undefined
    translated.push(knownServerText(prefix, locale, spots)!)
    remaining = remaining.slice(prefix.length).trimStart()
  }
  return translated.length ? translated.join(locale === 'ja' ? '' : ' ') : undefined
}
