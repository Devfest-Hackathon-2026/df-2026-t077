import type { Locale } from '../api/types'

const key = 'zurashitabi-ui-locale'
export function readUiLocale(): Locale {
  try { return localStorage.getItem(key) === 'en' ? 'en' : 'ja' } catch { return 'ja' }
}
export function saveUiLocale(locale: Locale) {
  try { localStorage.setItem(key, locale) } catch { /* UI remains usable when browser storage is unavailable. */ }
}
