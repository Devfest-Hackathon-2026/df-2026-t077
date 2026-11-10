import type { Locale, Plan, Spot } from '../../api/types'
import { ServerText } from '../../components/ui/ServerText'
import { useLocale } from '../../i18n/useLocale'
import { isOtherLanguage, knownPlanSummary, knownServerText } from '../../i18n/serverText'

export function PlanSummary({ plan, sourceLocale, spots }: { plan: Plan; sourceLocale: Locale; spots: Spot[] }) {
  const { locale } = useLocale()
  const summary = plan.explanation.summary
  const known = knownPlanSummary(summary, locale, spots)
  const reason = plan.explanation.reason_fact_ids.map((id) => plan.facts.find((fact) => fact.id === id))
    .map((fact) => fact && knownServerText(fact.text, locale, spots)).find((text) => text !== undefined)
  const adapted = !known && isOtherLanguage(summary, locale, sourceLocale) && reason !== undefined
  return <div className="plan-text-summary">
    {adapted && <small>{locale === 'en' ? 'Display summary from the saved facts' : '保存済みのFactに基づく定型表示'}</small>}
    <p><ServerText text={summary} sourceLocale={sourceLocale} spots={spots} summary fallback={adapted ? reason : undefined} /></p>
  </div>
}
