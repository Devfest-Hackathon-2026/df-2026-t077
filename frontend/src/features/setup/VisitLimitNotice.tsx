import { useFormContext, useWatch } from 'react-hook-form'
import { useLocale } from '../../i18n/useLocale'
import type { MessageKey } from '../../i18n/messages'
import { autoOmakaseSlots, visitLimitExcess } from './formSchema'
import { MAX_OMAKASE_VISITS, type TripFormValues } from './formTypes'

export const VISIT_LIMIT_NOTICE_ID = 'trip-visit-limit'

function fill(text: string, values: Record<string, number>) {
  return Object.entries(values).reduce((result, [key, value]) => result.replaceAll(`{${key}}`, String(value)), text)
}

/**
 * 行きたい場所の数と訪問数の上限の差を、入力中にその場で示す。
 * - 上限を超える：場所を減らすか上限を上げるよう案内する（「条件を確認する」時のフォーカス先）。
 * - 上限に足りない：残りをお任せで自動追加することを事前に知らせる。
 * `live` の1か所だけを読み上げ対象にし、上限欄の横の同じ案内は二重に読み上げない。
 */
export function VisitLimitNotice({ live = false }: { live?: boolean }) {
  const { control } = useFormContext<TripFormValues>()
  const stops = useWatch({ control, name: 'requestedStops' })
  const maxVisits = useWatch({ control, name: 'maxVisits' })
  const { t } = useLocale()
  const excess = visitLimitExcess(stops?.length ?? 0, maxVisits)
  const auto = excess ? null : autoOmakaseSlots(stops, maxVisits)
  const autoKey: MessageKey | null = !auto ? null : auto.added === 0 ? 'omakaseAutoNone' : auto.capped ? 'omakaseAutoCapped' : 'omakaseAutoAdd'
  const text = excess
    ? fill(t('visitLimitOver'), { count: excess.count, max: excess.max })
    : auto && autoKey ? fill(t(autoKey), { n: auto.added, gap: auto.gap, cap: MAX_OMAKASE_VISITS }) : ''
  const className = excess ? 'notice trip-form__limit-notice' : auto ? 'notice trip-form__auto-notice' : undefined
  if (!live) return text ? <p className={className}>{text}</p> : null
  // The live region stays mounted so screen readers announce the message when it appears.
  return <div id={VISIT_LIMIT_NOTICE_ID} role="status" tabIndex={-1} className={className}>{text}</div>
}
