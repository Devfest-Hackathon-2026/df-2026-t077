import type { Locale, Plan, Spot, WaitAssumption } from '../../api/types'
import { spotName } from '../compare/display'

interface ItineraryTimelineProps {
  plan: Plan
  spots: Spot[]
  locale: Locale
  formatTime: (value: string) => string
  selectedStopId: string | null
  waitAssumptions: WaitAssumption[]
  waitNotIncludedSpotIds: string[]
  onSelectStop: (stopId: string) => void
}

function minutes(seconds: number) {
  return `${(seconds / 60).toFixed(1)} min`
}

export function ItineraryTimeline({
  plan,
  spots,
  locale,
  formatTime,
  selectedStopId,
  waitAssumptions,
  waitNotIncludedSpotIds,
  onSelectStop,
}: ItineraryTimelineProps) {
  const spotsById = new Map(spots.map((spot) => [spot.id, spot]))
  const stopsById = new Map(plan.stops.map((stop) => [stop.id, stop]))
  const legsByFromStopId = new Map(plan.legs.map((leg) => [leg.from_stop_id, leg]))
  const assumptionsBySpotId = new Map(waitAssumptions.map((item) => [item.spot_id, item]))
  const notIncluded = new Set(waitNotIncludedSpotIds)

  return (
    <ol className="trip-timeline">
      {plan.stops.map((stop) => {
        const spot = spotsById.get(stop.spot_id)
        const role = stop.role === 'origin'
          ? (locale === 'en' ? 'Start' : '出発')
          : stop.role === 'destination'
            ? (locale === 'en' ? 'Return' : '帰着')
            : null
        const leg = legsByFromStopId.get(stop.id)
        const nextStop = leg ? stopsById.get(leg.to_stop_id) : undefined

        return (
          <li className="trip-timeline-item" key={stop.id}>
            <button
              type="button"
              className={`trip-stop-select${selectedStopId === stop.id ? ' is-selected' : ''}`}
              aria-pressed={selectedStopId === stop.id}
              onClick={() => onSelectStop(stop.id)}
            >
              <span className="trip-stop-time">{formatTime(stop.start_at)}</span>
              <span className="trip-stop-main">
                <span className="trip-stop-name">{spotName(spot, stop.spot_id, locale)}</span>
                <span className="trip-stop-badges">
                  {role && <span className="trip-badge">{role}</span>}
                  {stop.requirement && (
                    <span className="trip-badge trip-must-badge">
                      {stop.requirement === 'must'
                        ? (locale === 'en' ? 'Must visit' : '必須訪問')
                        : (locale === 'en' ? 'Optional' : '任意')}
                    </span>
                  )}
                  {stop.locked_start_at && (
                    <span className="trip-badge trip-fixed-badge">
                      {locale === 'en' ? 'Fixed start' : '開始時刻固定'}
                    </span>
                  )}
                </span>
                <span className="trip-stop-times">
                  <span>{locale === 'en' ? 'Arrive' : '到着'}: {formatTime(stop.arrival_at)}</span>
                  {stop.role === 'visit' && (
                    <>
                      <span>{locale === 'en' ? 'Visit starts' : '訪問開始'}: {formatTime(stop.start_at)}</span>
                      <span>{locale === 'en' ? 'Leave' : '退場'}: {formatTime(stop.departure_at)}</span>
                    </>
                  )}
                </span>
              </span>
            </button>

            {stop.role === 'visit' && (
              <div className="trip-wait-breakdown" aria-label={locale === 'en' ? 'Wait breakdown' : '待機内訳'}>
                <span>{locale === 'en' ? 'Opening wait' : '開館待ち'}: {minutes(stop.opening_wait_seconds)}</span>
                <span>
                  {stop.queue_seconds > 0
                    ? (locale === 'en' ? 'Queue time' : '行列待ち時間')
                    : (locale === 'en' ? 'Queue time included' : '算入した行列待ち時間')}
                  : {!assumptionsBySpotId.has(stop.spot_id) && notIncluded.has(stop.spot_id) && stop.queue_seconds === 0 ? (locale === 'en' ? 'Not included' : '未算入') : minutes(stop.queue_seconds)}
                  {assumptionsBySpotId.has(stop.spot_id) && (
                    <> · {waitBasisLabel(assumptionsBySpotId.get(stop.spot_id)!, locale)}</>
                  )}
                  {!assumptionsBySpotId.has(stop.spot_id) && notIncluded.has(stop.spot_id) && (
                    <> · {locale === 'en' ? 'Wait time unknown' : '待ち時間は不明'}</>
                  )}
                  {!assumptionsBySpotId.has(stop.spot_id)
                    && !notIncluded.has(stop.spot_id)
                    && stop.queue_seconds > 0 && (
                      <> · {locale === 'en' ? 'Basis unavailable' : '根拠情報なし'}</>
                    )}
                  {!assumptionsBySpotId.has(stop.spot_id)
                    && !notIncluded.has(stop.spot_id)
                    && stop.queue_seconds === 0 && (
                      <> · {locale === 'en' ? 'Not a measured zero wait' : '実測0分ではありません'}</>
                    )}
                </span>
                <span>{locale === 'en' ? 'Schedule adjustment' : '予定調整'}: {minutes(stop.schedule_wait_seconds)}</span>
              </div>
            )}

            {leg && nextStop && (
              <div className="trip-leg" aria-label={locale === 'en' ? 'Walking leg' : '徒歩移動'}>
                <span>
                  {locale === 'en' ? 'Walk' : '徒歩'}: {(leg.distance_meters / 1000).toFixed(2)} km · {minutes(leg.duration_seconds)}
                </span>
                <span>
                  {locale === 'en' ? 'Route buffer' : '経路余裕'}: {minutes(leg.buffer_seconds)}
                </span>
                <span className="trip-leg-endpoints">
                  {spotName(spotsById.get(stop.spot_id), stop.spot_id, locale)}
                  {' → '}
                  {spotName(spotsById.get(nextStop.spot_id), nextStop.spot_id, locale)}
                </span>
                {leg.source_kind === 'estimated' && <span>{locale === 'en' ? 'Estimated walking route' : '徒歩経路の推定値'}</span>}
                {leg.source_kind === 'unknown' && (
                  <span className="trip-unknown-note">
                    {locale === 'en' ? 'Walking estimate source unknown' : '徒歩移動の根拠は不明です'}
                  </span>
                )}
              </div>
            )}
          </li>
        )
      })}
    </ol>
  )
}

function waitBasisLabel(assumption: WaitAssumption, locale: Locale) {
  if (assumption.basis === 'user_observed') {
    return locale === 'en' ? 'Traveler observed' : '本人観測'
  }
  if (assumption.basis === 'user_assumption') {
    return locale === 'en' ? 'Traveler assumption' : '本人の仮定'
  }
  return locale === 'en' ? 'Demo assumption' : 'デモ仮定'
}
