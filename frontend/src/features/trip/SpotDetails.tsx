import { SourceSummary } from '../../components/ui/SourceSummary'
import type { Evidence, Locale, Plan, Spot, Trip } from '../../api/types'

interface SpotDetailsProps {
  stop: Plan['stops'][number]
  spot: Spot | undefined
  evidence: Evidence[]
  requestedStop: Trip['requested_stops'][number] | undefined
  locale: Locale
  formatTime: (value: string) => string
}

export function SpotDetails({
  stop,
  spot,
  evidence,
  requestedStop,
  locale,
  formatTime,
}: SpotDetailsProps) {
  const evidenceById = new Map(evidence.map((item) => [item.id, item]))
  const sourceIds = new Set([...(spot?.evidence_ids ?? []), ...stop.evidence_ids])
  const sources = [...sourceIds]
    .map((id) => evidenceById.get(id))
    .filter((item): item is Evidence => item !== undefined)
  const missingSourceCount = sourceIds.size - sources.length
  const isJapanese = locale === 'ja'
  const unknown = isJapanese ? '不明' : 'Unknown'
  const name = spot
    ? (isJapanese ? spot.name_ja : spot.name_en)
    : stop.spot_id
  const description = spot
    ? (isJapanese ? spot.description_ja : spot.description_en)
    : unknown
  const visitorInfo = spot
    ? (isJapanese ? spot.visitor_info_ja : spot.visitor_info_en)
    : unknown
  const formatCheckedAt = (value: string) => new Intl.DateTimeFormat(locale, {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value))

  return (
    <article className="trip-spot-card" aria-labelledby={`spot-${stop.id}`}>
      <header>
        <h3 id={`spot-${stop.id}`}>{name}</h3>
        {spot?.is_demo && (
          <span className="trip-badge trip-demo-badge">{isJapanese ? 'デモ情報' : 'Demo data'}</span>
        )}
      </header>

      <p className="trip-spot-id"><code>{stop.spot_id}</code></p>
      <section>
        <h4>{isJapanese ? '見どころ' : 'About'}</h4>
        <p>{description}</p>
      </section>
      <section>
        <h4>{isJapanese ? '料金・利用情報' : 'Fees and visitor information'}</h4>
        <p>{visitorInfo}</p>
      </section>

      <dl className="trip-spot-facts">
        <div>
          <dt>{isJapanese ? '営業時間情報' : 'Opening hours'}</dt>
          <dd>
            {!spot || spot.opening_status === 'unknown'
              ? unknown
              : spot.opening_status === 'closed'
                ? (isJapanese ? '休業' : 'Closed')
                : (isJapanese ? '確認済み' : 'Verified')}
          </dd>
        </div>
        {spot?.opening_status === 'verified' && spot.opening_windows.length > 0 && (
          <div className="trip-opening-windows">
            <dt>{isJapanese ? '確認済みの時間帯' : 'Verified windows'}</dt>
            <dd>
              <ul>
                {spot.opening_windows.map((window, index) => (
                  <li key={`${window.opens_at}-${index}`}>
                    {formatTime(window.opens_at)}–{formatTime(window.closes_at)}
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        )}
        <div>
          <dt>{isJapanese ? '予約' : 'Reservation'}</dt>
          <dd>
            {spot?.reservation_required === true
              ? (requestedStop?.reservation_confirmed
                ? (isJapanese ? '本人が予約確保済み（アプリでの予約ではありません）' : 'Traveler confirmed reservation (not booked by this app)')
                : (isJapanese ? '必要・本人の確保未確認' : 'Required; traveler confirmation missing'))
              : spot?.reservation_required === false
                ? (isJapanese ? '不要' : 'Not required')
                : unknown}
          </dd>
        </div>
        <div>
          <dt>{isJapanese ? '予約状況' : 'Reservation status'}</dt>
          <dd>{requestedStop?.reservation_confirmed
            ? (isJapanese ? '本人申告で確保済み' : 'Traveler-reported as secured')
            : (isJapanese ? '本人申告の確保なし' : 'No traveler-reported confirmation')}</dd>
        </div>
      </dl>

      <section className="trip-spot-sources">
        <h4>{isJapanese ? '根拠・確認日' : 'Sources and verification dates'}</h4>
        {sources.length === 0 && (
          <p>{isJapanese ? '根拠情報はありません。詳細は未確認です。' : 'No source information is available; details are unverified.'}</p>
        )}
        {sources.map((source) => (
          <article key={source.id}>
            <SourceSummary source={source} />
            <p>
              {isJapanese ? '確認日' : 'Checked'}:{' '}
              {source.checked_at ? formatCheckedAt(source.checked_at) : unknown}
            </p>
            <p>
              {isJapanese ? '情報の種類' : 'Source type'}:{' '}
              {sourceKindLabel(source.source_kind, locale)}
              {' · '}
              {isJapanese ? '確度' : 'Confidence'}:{' '}
              {confidenceLabel(source.confidence, locale)}
            </p>
            {(source.confidence === 'unknown' || source.source_kind === 'unknown') && (
              <p className="trip-unknown-note">{isJapanese ? '根拠の確度は不明です。' : 'Source confidence is unknown.'}</p>
            )}
            {source.is_demo && (
              <p className="trip-unknown-note">{isJapanese ? 'デモ用の架空情報です。実際の利用前に確認してください。' : 'Synthetic demo information; verify before use.'}</p>
            )}
            {source.source_url && /^https?:\/\//.test(source.source_url) && (
              <a href={source.source_url} target="_blank" rel="noopener noreferrer">
                {isJapanese ? '出典を開く' : 'Open source'}
              </a>
            )}
          </article>
        ))}
        {missingSourceCount > 0 && (
          <p className="trip-unknown-note">
            {isJapanese ? '一部の参照元情報を取得できませんでした。' : 'Some referenced source details could not be retrieved.'}
          </p>
        )}
      </section>
    </article>
  )
}

function sourceKindLabel(sourceKind: Evidence['source_kind'], locale: Locale) {
  const labels = {
    measured: ['実測', 'Measured'],
    estimated: ['推定', 'Estimated'],
    curated: ['編集・確認済み', 'Curated'],
    user_observed: ['本人観測', 'Traveler observed'],
    user_assumption: ['本人の仮定', 'Traveler assumption'],
    user_preference: ['本人の希望', 'Traveler preference'],
    demo: ['デモ', 'Demo'],
    unknown: ['不明', 'Unknown'],
  } as const
  return labels[sourceKind][locale === 'ja' ? 0 : 1]
}

function confidenceLabel(confidence: Evidence['confidence'], locale: Locale) {
  const labels = {
    high: ['高', 'High'],
    medium: ['中', 'Medium'],
    low: ['低', 'Low'],
    unknown: ['不明', 'Unknown'],
  } as const
  return labels[confidence][locale === 'ja' ? 0 : 1]
}
