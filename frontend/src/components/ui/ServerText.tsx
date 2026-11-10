import { useId, useState } from 'react'
import type { Locale, Spot } from '../../api/types'
import { useLocale } from '../../i18n/useLocale'
import { isOtherLanguage, knownPlanSummary, knownServerText } from '../../i18n/serverText'

interface Props { text: string; sourceLocale?: Locale; spots?: Spot[]; summary?: boolean; fallback?: string }

/** Original AI/source text stays available. Unrecognized prose is never silently translated. */
export function ServerText(props: Props) {
  const { locale } = useLocale()
  return <TextContent key={`${locale}/${props.sourceLocale}/${props.text}`} {...props} locale={locale} />
}
function TextContent({ text, sourceLocale, spots = [], summary, fallback, locale }: Props & { locale: Locale }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const translated = summary ? knownPlanSummary(text, locale, spots) : knownServerText(text, locale, spots)
  if (translated) return <span lang={locale}>{translated}</span>
  if (!isOtherLanguage(text, locale, sourceLocale)) return <span lang={sourceLocale ?? locale}>{text}</span>
  const originalLanguage = /[ぁ-んァ-ヶ一-龯]/.test(text) ? 'ja' : sourceLocale ?? 'en'
  return <span className="server-text">
    <span>{fallback ?? (locale === 'en' ? 'A translation is not available for this saved text. Open the original below.' : 'この保存済み文章の翻訳はありません。以下から原文を確認できます。')}</span>
    <button type="button" className="server-text__toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>{locale === 'en' ? (open ? 'Hide original text' : `Read original ${originalLanguage === 'ja' ? 'Japanese' : 'English'} text`) : (open ? '原文を閉じる' : `${originalLanguage === 'ja' ? '日本語' : '英語'}の原文を読む`)}</button>
    <span id={id} lang={originalLanguage} className="server-text__original" hidden={!open}>{text}</span>
  </span>
}
