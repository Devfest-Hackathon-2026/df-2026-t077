import type { Evidence } from '../../api/types'
import { useLocale } from '../../i18n/useLocale'
import { ServerText } from './ServerText'

/** Keep the original title, notes and provider together; verification metadata stays visible. */
export function SourceSummary({ source }: { source: Evidence }) {
  const { locale } = useLocale()
  const original = `${source.title}\n${source.note}\n${locale === 'en' ? 'Provider' : '提供元'}: ${source.provider}`
  if (locale === 'en' && /[ぁ-んァ-ヶ一-龯]/.test(original)) return <>
    <strong>Source information (Japanese)</strong>
    <p><ServerText text={original} fallback="The source title, notes and provider are available in their original Japanese." /></p>
  </>
  return <><strong>{source.title}</strong><p>{source.note || (locale === 'en' ? 'No additional notes' : '追加説明なし')}</p><p>{locale === 'en' ? 'Provider' : '提供元'}: {source.provider}</p></>
}
