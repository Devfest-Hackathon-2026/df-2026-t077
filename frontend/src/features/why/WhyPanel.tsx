import type { Evidence, Plan, ProposalBundle, Spot } from '../../api/types'
import { useLocale } from '../../i18n/useLocale'
import { Drawer } from '../../components/ui/Drawer'
import { Button } from '../../components/ui/Button'
import { PlanSummary } from './PlanSummary'
import { SourceSummary } from '../../components/ui/SourceSummary'
import { ServerText } from '../../components/ui/ServerText'
import type { MessageKey } from '../../i18n/messages'

export interface WhyPanelProps {
  plan: Plan
  spots?: Spot[]
  evidence: Evidence[]
  effectiveConstraints: ProposalBundle['effective_constraints']
  onRefine: () => void
  onClose: () => void
}
const sourceLabels: Record<Evidence['source_kind'], MessageKey> = { measured: 'measured', estimated: 'estimated', curated: 'curated', user_observed: 'user_observed_evidence', user_assumption: 'user_assumption_evidence', user_preference: 'user_preference_evidence', demo: 'sourceDemo', unknown: 'sourceUnknown' }
function sourceLink(value: string | null) {
  try { const url = new URL(value ?? ''); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null } catch { return null }
}
export function WhyPanel({ plan, spots = [], evidence, effectiveConstraints, onRefine, onClose }: WhyPanelProps) {
  const { t, locale } = useLocale()
  const groups: { title: MessageKey; ids: string[] }[] = [
    { title: 'reasons', ids: plan.explanation.reason_fact_ids },
    { title: 'tradeoffs', ids: plan.explanation.tradeoff_fact_ids },
    { title: 'uncertainties', ids: plan.explanation.uncertainty_fact_ids },
  ]
  const facts = new Map(plan.facts.map((f) => [f.id, f]))
  const used = new Set(groups.flatMap((g) => g.ids).flatMap((id) => facts.get(id)?.evidence_ids ?? []))
  const sources = new Map(evidence.map((e) => [e.id, e]))
  const missing = groups.some((g) => g.ids.some((id) => !facts.has(id))) || [...used].some((id) => !sources.has(id))
  const date = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat(locale, { timeZone: 'Asia/Tokyo', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) + ' JST' : t('unknownDate')
  return <Drawer title={t('why')} onClose={onClose}>
    {effectiveConstraints.locale !== locale && <p className="notice">{t('explanationLanguage')}: {effectiveConstraints.locale}</p>}
    {plan.explanation.generation_mode === 'template' && <p className="notice">{locale === 'en' ? 'Template explanation based on the confirmed itinerary.' : '確定した旅程に基づく定型説明です。'}</p>}
    <PlanSummary plan={plan} sourceLocale={effectiveConstraints.locale} spots={spots} />
    {missing && <p className="notice">{t('missingReference')}</p>}
    {groups.map((group) => <section key={group.title}><h3>{t(group.title)}</h3>{group.ids.length === 0 && <p>{locale === 'en' ? 'No information provided for this category.' : 'この項目の説明は提供されていません。'}</p>}<ul className="facts">{group.ids.map((id) => { const fact = facts.get(id); return fact ? <li key={id}><ServerText text={fact.text} sourceLocale={effectiveConstraints.locale} spots={spots} />{fact.is_demo && <span className="badge">{t('demo')}</span>}</li> : null })}</ul></section>)}
    <h3>{t('evidence')}</h3>
    {[...used].map((id) => { const item = sources.get(id); if (!item) return null; const link = sourceLink(item.source_url); return <section key={id}><SourceSummary source={item} /><p><span className="badge">{t(sourceLabels[item.source_kind])}</span>{item.is_demo && item.source_kind !== 'demo' && <span className="badge">{t('demo')}</span>}</p><small>{date(item.checked_at)}</small>{link && <p><a href={link} target="_blank" rel="noopener noreferrer">{locale === 'en' ? 'Open source' : '出典を開く'}</a></p>}</section> })}
    <Button type="button" onClick={onRefine}>{t('refine')}</Button>
  </Drawer>
}
