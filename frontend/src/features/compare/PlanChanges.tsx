import type { Locale, Plan, Spot } from '../../api/types'
import { ServerText } from '../../components/ui/ServerText'
import { spotName } from './display'

interface PlanChangesProps {
  plan: Plan
  spots: Spot[]
  locale: Locale
  sourceLocale: Locale
  formatTime: (value: string) => string
}

export function PlanChanges({ plan, spots, locale, sourceLocale, formatTime }: PlanChangesProps) {
  const spotsById = new Map(spots.map((spot) => [spot.id, spot]))
  const factsById = new Map(plan.facts.map((fact) => [fact.id, fact]))
  const changeFacts = [...new Set(plan.changes.flatMap((change) => change.reason_fact_ids))]
    .map((id) => factsById.get(id))
    .filter((fact): fact is Plan['facts'][number] => fact !== undefined)
  const experienceFacts = changeFacts.filter((fact) => fact.kind === 'interest')
  const detailFacts = changeFacts.filter((fact) => fact.kind !== 'interest' && fact.text !== plan.explanation.summary)

  return (
    <section className="compare-card-section compare-changes">
      <h3>{locale === 'en' ? 'Changes from baseline' : '元案からの変更点'}</h3>
      {plan.changes.length === 0 ? (
        <p>{locale === 'en' ? 'No changes are recorded for this plan.' : 'この案に記録された変更はありません。'}</p>
      ) : (
        <ol>
          {plan.changes.map((change, index) => {
            const original = spotName(spotsById.get(change.original_spot_id), change.original_spot_id, locale)
            const replacement = change.replacement_spot_id
              ? spotName(spotsById.get(change.replacement_spot_id), change.replacement_spot_id, locale)
              : null
            const label = change.kind === 'time_shift'
              ? (locale === 'en' ? 'Time shift' : '時間変更')
              : change.kind === 'place_replacement'
                ? (locale === 'en' ? 'Place replacement' : '場所の交換')
                : (locale === 'en' ? 'Stop removed' : '訪問先の削除')

            return (
              <li key={`${change.kind}-${change.original_spot_id}-${index}`}>
                <strong>{label}</strong>
                <p>
                  {change.kind === 'time_shift'
                    ? original
                    : `${original} → ${replacement ?? (locale === 'en' ? 'removed' : '削除')}`}
                </p>
                {(change.before_start_at || change.after_start_at) && (
                  <p className="compare-change-time">
                    {locale === 'en' ? 'Start time: ' : '開始時刻: '}
                    {change.before_start_at ? formatTime(change.before_start_at) : '—'}
                    {' → '}
                    {change.after_start_at ? formatTime(change.after_start_at) : '—'}
                  </p>
                )}
              </li>
            )
          })}
        </ol>
      )}

      {experienceFacts.length > 0 && (
        <div className="compare-change-facts">
          <h4>{locale === 'en' ? 'Experience fit' : '体験との一致'}</h4>
          <ul>
            {experienceFacts.map((fact) => (
              <li key={fact.id}>
                <ServerText text={fact.text} sourceLocale={sourceLocale} spots={spots} />
                {fact.is_demo && <span className="compare-data-badge compare-demo-badge">{locale === 'en' ? 'Demo' : 'デモ'}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {detailFacts.length > 0 && (
        <div className="compare-change-facts">
          <h4>{locale === 'en' ? 'Reasons and differences' : '理由・違い'}</h4>
          <ul>
            {detailFacts.map((fact) => (
              <li key={fact.id}>
                <ServerText text={fact.text} sourceLocale={sourceLocale} spots={spots} />
                {fact.is_demo && <span className="compare-data-badge compare-demo-badge">{locale === 'en' ? 'Demo' : 'デモ'}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
