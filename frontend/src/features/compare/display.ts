import type { Locale, Spot } from '../../api/types'

export function spotName(spot: Spot | undefined, spotId: string, locale: Locale) {
  if (!spot) return spotId
  return locale === 'ja' ? spot.name_ja : spot.name_en
}
