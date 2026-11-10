import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useSpots, useTrip } from '../../api/hooks'
import { ApiError } from '../../api/client'
import type { TripResponse } from '../../api/types'
import { StatusPanel } from '../../components/ui/StatusPanel'
import { useLocale } from '../../i18n/useLocale'
import { fromJapanDateTime } from '../../lib/japanTime'
import { ItineraryTimeline } from './ItineraryTimeline'
import { ItineraryMap } from './ItineraryMap'
import { SpotDetails } from './SpotDetails'
import { RouteAttribution } from './RouteAttribution'
import { WhyPanel } from '../why/WhyPanel'
import { RefineForm } from '../why/RefineForm'
import { Button } from '../../components/ui/Button'
import './trip.css'

export function TripPage() {
  const { tripId = '' } = useParams()
  const [search] = useSearchParams()
  const { locale, t } = useLocale()
  const trip = useTrip(tripId)
  const conflictParam = search.get('selectionConflict')
  const selectionConflict = conflictParam === 'VERSION_CONFLICT'
    || conflictParam === 'MODE_CONFLICT'
    || conflictParam === 'IDEMPOTENCY_KEY_REUSED'
    || conflictParam === 'OTHER_CONFLICT'
    ? conflictParam
    : null

  if (!tripId) {
    return (
      <section className="trip-state" role="alert">
        <h1>{locale === 'en' ? 'Trip not found' : '旅程が見つかりません'}</h1>
        <Link to="/plan/new">{t('back')}</Link>
      </section>
    )
  }
  if (trip.isPending) return <StatusPanel loading />
  if (trip.isError) {
    const notFound = trip.error instanceof ApiError && trip.error.status === 404
    return (
      <section className="trip-state" role="alert">
        <h1>{notFound
          ? (locale === 'en' ? 'Trip not found' : '旅程が見つかりません')
          : (locale === 'en' ? 'Could not load trip' : '旅程を読み込めませんでした')}</h1>
        <p>{notFound
          ? (locale === 'en'
            ? 'This trip may not exist or may no longer be available.'
            : '旅程が存在しないか、現在取得できない可能性があります。')
          : (locale === 'en' ? 'The saved itinerary could not be retrieved.' : '保存済みの旅程を取得できませんでした。')}</p>
        {!notFound && <button type="button" onClick={() => void trip.refetch()}>{t('retry')}</button>}
        <Link to="/plan/new">{t('back')}</Link>
      </section>
    )
  }
  if (!trip.data) return <StatusPanel loading />

  return <TripDetails key={tripId} response={trip.data} selectionConflict={selectionConflict} />
}

function TripDetails({
  response,
  selectionConflict,
}: {
  response: TripResponse
  selectionConflict: 'VERSION_CONFLICT' | 'MODE_CONFLICT' | 'IDEMPOTENCY_KEY_REUSED' | 'OTHER_CONFLICT' | null
}) {
  const { locale, t } = useLocale()
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null)
  const [panel, setPanel] = useState<'why' | 'refine' | null>(null)
  const trip = response.trip
  const plan = response.active_plan
  const visitDate = fromJapanDateTime(trip.constraints.start_at).date
  const spots = useSpots(trip.constraints.area_id, visitDate)
  const selectedStop = plan?.stops.find((stop) => stop.id === selectedStopId)
    ?? plan?.stops[0]
  const allEvidence = [...response.evidence, ...(spots.data?.evidence ?? [])]
  const formatTime = (value: string) => new Intl.DateTimeFormat(locale, {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value))

  return (
    <section className="trip-page" aria-labelledby="itinerary-title">
      <header className="trip-heading">
        <h1 id="itinerary-title">{t('trip')}</h1>
        <p>{new Intl.DateTimeFormat(locale, { timeZone: 'Asia/Tokyo', dateStyle: 'full' }).format(new Date(trip.constraints.start_at))} · {t('japanTime')}</p>
      </header>

      <div className="trip-actions">
        {plan && <Button type="button" onClick={() => setPanel('why')}>{t('why')}</Button>}
        <Button type="button" onClick={() => setPanel('refine')}>{t('refine')}</Button>
        {trip.active_selection && <Link className="button" to={`/trips/${trip.id}/compare?proposalId=${encodeURIComponent(trip.active_selection.proposal_id)}`}>{locale === 'en' ? 'View compared plans' : '比較した案を見る'}</Link>}
      </div>

      {selectionConflict && (
        <section className="trip-selection-conflict" role="status">
          <h2>{t('selectionReviewRequiredTitle')}</h2>
          <p>
            {selectionConflict === 'VERSION_CONFLICT'
              ? t('selectionVersionConflict')
              : selectionConflict === 'MODE_CONFLICT'
                ? t('selectionModeConflict')
                : selectionConflict === 'IDEMPOTENCY_KEY_REUSED'
                  ? t('selectionKeyMismatch')
                  : t('selectionOtherConflict')}
          </p>
        </section>
      )}

      {plan ? (
        <>
          <section className="trip-selection-status" aria-label={locale === 'en' ? 'Saved selection' : '採用情報'}>
            <h2>{locale === 'en' ? 'Saved itinerary' : '採用済みの旅程'}</h2>
            <p>
              {locale === 'en' ? 'Plan' : 'プラン'}: <code>{plan.id}</code>
              {' · '}
              {locale === 'en' ? 'Trip version' : '旅程バージョン'}: {trip.version}
            </p>
            {trip.active_selection && (
              <p>
                {locale === 'en' ? 'Selected at' : '採用日時'}:{' '}
                <time dateTime={trip.active_selection.selected_at}>
                  {formatTime(trip.active_selection.selected_at)}
                </time>
              </p>
            )}
          </section>

          <section className="trip-summary" aria-label={locale === 'en' ? 'Itinerary summary' : '旅程の概要'}>
            <dl><div><dt>{t('walk')}</dt><dd>{(plan.metrics.walk_meters / 1000).toFixed(1)} km</dd></div><div><dt>{t('slack')}</dt><dd>{(plan.metrics.finish_slack_seconds / 60).toFixed(1)} min</dd></div><div><dt>{locale === 'en' ? 'Visit places' : '訪問先'}</dt><dd>{plan.stops.filter((stop) => stop.role === 'visit').length}</dd></div></dl>
            {plan.metrics.wait_not_included_spot_ids.length > 0 && <p className="notice">{t('unknown')} · {t('notCrowd')}</p>}
          </section>

          <RouteAttribution plan={plan} evidence={allEvidence} locale={locale} />
          <section className="trip-map-section">
            <h2>{locale === 'en' ? 'Map' : '地図'}</h2>
            <ItineraryMap
              plan={plan}
              spots={spots.data?.items ?? []}
              locale={locale}
              selectedStopId={selectedStop?.id ?? null}
              onSelectStop={setSelectedStopId}
            />
          </section>

          <div className="trip-content-grid">
            <section className="trip-itinerary">
              <h2>{locale === 'en' ? 'Itinerary' : '時刻表'}</h2>
              <ItineraryTimeline
                plan={plan}
                spots={spots.data?.items ?? []}
                locale={locale}
                formatTime={formatTime}
                selectedStopId={selectedStop?.id ?? null}
                waitAssumptions={trip.constraints.wait_assumptions}
                waitNotIncludedSpotIds={plan.metrics.wait_not_included_spot_ids}
                onSelectStop={setSelectedStopId}
              />
            </section>
            <section className="trip-spot-details">
              <h2>{locale === 'en' ? 'Place details' : 'スポット詳細'}</h2>
              {spots.isLoading && <p role="status">{t('loading')}</p>}
              {spots.isError && (
                <div className="trip-spot-error" role="alert">
                  <p>{locale === 'en'
                    ? 'Spot information could not be loaded. The itinerary remains available.'
                    : 'スポット情報を取得できませんでした。時刻表は引き続き確認できます。'}</p>
                  <button type="button" onClick={() => void spots.refetch()}>{t('retry')}</button>
                </div>
              )}
              {selectedStop && (
                <SpotDetails
                  stop={selectedStop}
                  spot={spots.data?.items.find((item) => item.id === selectedStop.spot_id)}
                  evidence={allEvidence}
                  requestedStop={selectedStop.role === 'visit'
                    ? trip.requested_stops.find((item) => item.spot_id === selectedStop.spot_id)
                    : undefined}
                  locale={locale}
                  formatTime={formatTime}
                />
              )}
            </section>
          </div>
        </>
      ) : (
        <section className="trip-empty-state" role="status">
          <h2>{t('noSelection')}</h2>
          <p>{locale === 'en'
            ? 'No plan has been adopted for this trip. Compare a proposal and explicitly select a plan first.'
            : 'この旅程には採用済みの案がありません。提案を比較し、案を選択してください。'}</p>
          <Link className="trip-action-link" to="/plan/new">{t('back')}</Link>
        </section>
      )}

      <p className="trip-back-link"><Link to="/plan/new">{t('back')}</Link></p>
      {panel === 'why' && plan && <WhyPanel spots={spots.data?.items ?? []} plan={plan} evidence={allEvidence} effectiveConstraints={trip.constraints} onClose={() => setPanel(null)} onRefine={() => setPanel('refine')} />}
      {panel === 'refine' && <RefineForm tripId={trip.id} effectiveConstraints={trip.constraints} onClose={() => setPanel(null)} />}
    </section>
  )
}
