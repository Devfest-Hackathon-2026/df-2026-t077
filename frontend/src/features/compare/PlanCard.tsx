import type { Evidence, Locale, Plan, Spot } from '../../api/types'
import { useLocale } from '../../i18n/useLocale'
import { spotName } from './display'
import { PlanChanges } from './PlanChanges'
import { PlanSummary } from '../why/PlanSummary'
import { ServerText } from '../../components/ui/ServerText'
import { RouteAttribution } from '../trip/RouteAttribution'

interface PlanCardProps {
  plan: Plan
  title: string
  spots: Spot[]
  evidence: Evidence[]
  isSelecting: boolean
  selectionDisabled: boolean
  locale: Locale
  sourceLocale: Locale
  formatTime: (value: string) => string
  onWhy: () => void
  onSelect: () => void
}

export function PlanCard({
  plan,
  title,
  spots,
  evidence,
  isSelecting,
  selectionDisabled,
  locale,
  sourceLocale,
  formatTime,
  onWhy,
  onSelect,
}: PlanCardProps) {
  const { t } = useLocale()
  const spotsById = new Map(spots.map((spot) => [spot.id, spot]))
  const evidenceById = new Map(evidence.map((item) => [item.id, item]))
  const stopSpots = plan.stops
    .map((stop) => spotsById.get(stop.spot_id))
    .filter((spot): spot is Spot => spot !== undefined)
  const referencedEvidenceIds = new Set([
    ...plan.facts.flatMap((fact) => fact.evidence_ids),
    ...plan.stops.flatMap((stop) => stop.evidence_ids),
    ...plan.legs.flatMap((leg) => leg.evidence_ids),
    ...stopSpots.flatMap((spot) => spot.evidence_ids),
  ])
  const referencedEvidence = [...referencedEvidenceIds]
    .map((id) => evidenceById.get(id))
    .filter((item): item is Evidence => item !== undefined)
  const hasDemoData = plan.facts.some((fact) => fact.is_demo)
    || plan.legs.some((leg) => leg.source_kind === 'demo')
    || plan.stops.some((stop) => {
      const spot = spotsById.get(stop.spot_id)
      return spot?.is_demo === true
        || spot?.evidence_ids.some((id) => evidenceById.get(id)?.is_demo === true) === true
    })
    || referencedEvidence.some((item) => item.is_demo || item.source_kind === 'demo')
  const unknownEvidence = referencedEvidence.filter(
    (item) => item.source_kind === 'unknown' || item.confidence === 'unknown',
  )
  const unknownLegs = plan.legs.filter((leg) => leg.source_kind === 'unknown')
  const stopById = new Map(plan.stops.map((stop) => [stop.id, stop]))
  const explanationGroups = [
    { title: t('reasons'), ids: plan.explanation.reason_fact_ids },
    { title: t('tradeoffs'), ids: plan.explanation.tradeoff_fact_ids },
    { title: t('uncertainties'), ids: plan.explanation.uncertainty_fact_ids },
  ]
  const waitNotIncluded = plan.metrics.wait_not_included_spot_ids
  const minutes = (seconds: number) => (seconds / 60).toFixed(1)

  return (
    <article className="compare-plan-card">
      <header className="compare-plan-heading">
        <h2>{title}</h2>
        {hasDemoData && (
          <span className="compare-data-badge compare-demo-badge">
            {locale === 'en' ? 'Contains demo data' : 'デモデータを含む'}
          </span>
        )}
      </header>

      <section className="compare-card-section">
        <h3>{locale === 'en' ? 'Stops' : '訪問先'}</h3>
        <ol className="compare-stops">
          {plan.stops.map((stop) => {
            const spot = spotsById.get(stop.spot_id)
            const stopEvidenceIds = new Set([
              ...stop.evidence_ids,
              ...(spot?.evidence_ids ?? []),
            ])
            const stopEvidence = [...stopEvidenceIds]
              .map((id) => evidenceById.get(id))
              .filter((item): item is Evidence => item !== undefined)
            const isDemo = spot?.is_demo === true
              || stopEvidence.some((item) => item.is_demo || item.source_kind === 'demo')
            const isUnknown = stopEvidence.some(
              (item) => item.source_kind === 'unknown' || item.confidence === 'unknown',
            )
            const role = stop.role === 'origin'
              ? (locale === 'en' ? 'Start' : '出発')
              : stop.role === 'destination'
                ? (locale === 'en' ? 'End' : '帰着')
                : null

            return (
              <li className="compare-stop" key={stop.id}>
                <time dateTime={stop.start_at}>{formatTime(stop.start_at)}</time>
                <div className="compare-stop-details">
                  <span className="compare-stop-name">{spotName(spot, stop.spot_id, locale)}</span>
                  <div className="compare-data-labels">
                    {role && <span className="compare-data-badge">{role}</span>}
                    {stop.requirement && (
                      <span className="compare-data-badge compare-requirement-badge">
                        {stop.requirement === 'must'
                          ? (locale === 'en' ? 'Must' : '必須')
                          : (locale === 'en' ? 'Optional' : '任意')}
                      </span>
                    )}
                    {stop.locked_start_at && (
                      <span className="compare-data-badge compare-fixed-badge">
                        {locale === 'en' ? 'Fixed start time' : '開始時刻固定'}
                      </span>
                    )}
                    {spot?.opening_status === 'unknown' && (
                      <span className="compare-data-badge compare-unknown-badge">
                        {locale === 'en' ? 'Hours unknown' : '営業時間不明'}
                      </span>
                    )}
                    {spot?.opening_status === 'closed' && (
                      <span className="compare-data-badge compare-warning-badge">
                        {locale === 'en' ? 'Closed' : '休業'}
                      </span>
                    )}
                    {isDemo && (
                      <span className="compare-data-badge compare-demo-badge">{t('demo')}</span>
                    )}
                    {isUnknown && (
                      <span className="compare-data-badge compare-unknown-badge">
                        {locale === 'en' ? 'Source unknown' : '情報源不明'}
                      </span>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
      </section>

      <section className="compare-card-section compare-metrics">
        <h3>{locale === 'en' ? 'Distance and return margin' : '徒歩距離・帰着余裕'}</h3>
        <dl>
          <div>
            <dt>{t('walk')}</dt>
            <dd>{(plan.metrics.walk_meters / 1000).toFixed(1)} km</dd>
          </div>
          <div>
            <dt>{t('slack')}</dt>
            <dd>{minutes(plan.metrics.finish_slack_seconds)} min</dd>
          </div>
        </dl>
      </section>

      <PlanChanges sourceLocale={sourceLocale} plan={plan} spots={spots} locale={locale} formatTime={formatTime} />

      <section className="compare-card-section compare-cautions">
        <h3>{locale === 'en' ? 'Effort and cautions' : '負担・注意点'}</h3>
        <dl>
          <div>
            <dt>{locale === 'en' ? 'Walking time' : '移動時間'}</dt>
            <dd>{minutes(plan.metrics.travel_seconds)} min</dd>
          </div>
          <div>
            <dt>{locale === 'en' ? 'Queue time included' : '算入した待ち時間'}</dt>
            <dd>{waitNotIncluded.length > 0 && plan.metrics.modeled_queue_seconds === 0 ? (locale === 'en' ? 'Not included' : '未算入') : `${minutes(plan.metrics.modeled_queue_seconds)} min`}</dd>
          </div>
          <div>
            <dt>{locale === 'en' ? 'Avoid-window overlap' : '回避希望時間との重複'}</dt>
            <dd>{minutes(plan.metrics.avoid_overlap_seconds)} min</dd>
          </div>
        </dl>
        <p className="compare-caution-note">
          {locale === 'en'
            ? 'An included value of 0 min is not a measured zero wait.'
            : '算入時間が0分でも、実測で待ち時間がないことを意味しません。'}
        </p>
        {waitNotIncluded.length > 0 && (
          <p className="compare-caution-note">
            {locale === 'en' ? 'Wait time not included / unknown:' : '待ち時間は未算入・不明:'}{' '}
            {waitNotIncluded.map((id) => spotName(spotsById.get(id), id, locale)).join(', ')}
          </p>
        )}
        {unknownEvidence.length > 0 && (
          <p className="compare-caution-note">
            {locale === 'en' ? 'Evidence with unknown confidence:' : '確度不明の根拠:'}{' '}
            {unknownEvidence.map((item) => <span key={item.id}><ServerText text={item.title} />{' '}</span>)}
          </p>
        )}
        {unknownLegs.length > 0 && (
          <p className="compare-caution-note">
            {locale === 'en' ? 'Travel source unknown for:' : '移動情報の根拠不明:'}{' '}
            {unknownLegs.map((leg) => {
              const from = stopById.get(leg.from_stop_id)
              const to = stopById.get(leg.to_stop_id)
              return `${from ? spotName(spotsById.get(from.spot_id), from.spot_id, locale) : leg.from_stop_id} → ${to ? spotName(spotsById.get(to.spot_id), to.spot_id, locale) : leg.to_stop_id}`
            }).join(', ')}
          </p>
        )}
        {plan.warnings.length > 0 && (
          <ul className="compare-warning-list">
            {plan.warnings.map((warning, index) => <li key={`${index}-${warning}`}><ServerText text={warning} sourceLocale={sourceLocale} /></li>)}
          </ul>
        )}
      </section>

      <section className="compare-card-section compare-why">
        <h3>{locale === 'en' ? 'Why this plan' : 'この案の理由'}</h3>
        {plan.explanation.generation_mode === 'template' && (
          <p className="compare-template-note">
            {locale === 'en'
              ? 'Template explanation; the itinerary is still available for comparison.'
              : '定型文による説明です。旅程は引き続き比較できます。'}
          </p>
        )}
        <PlanSummary plan={plan} sourceLocale={sourceLocale} spots={spots} />
        <dl className="compare-explanation-summary">{explanationGroups.map((group) => {
          const fact = group.ids.map((id) => plan.facts.find((item) => item.id === id)).find((item) => item !== undefined)
          return fact && fact.text !== plan.explanation.summary ? <div key={group.title}><dt>{group.title}</dt><dd><ServerText text={fact.text} sourceLocale={sourceLocale} spots={spots} />{fact.is_demo && <span className="compare-data-badge compare-demo-badge">{t('demo')}</span>}</dd></div> : null
        })}</dl>
        <RouteAttribution plan={plan} evidence={evidence} locale={locale} />
      </section>

      <footer className="compare-card-actions">
        <button type="button" className="compare-why-button" onClick={onWhy}>{t('why')}</button>
        <button type="button" className="compare-select-button" disabled={isSelecting || selectionDisabled} onClick={onSelect}>
          {isSelecting
            ? t('loading')
            : (locale === 'en' ? 'Adopt this plan' : 'この案にする')}
        </button>
      </footer>
    </article>
  )
}
