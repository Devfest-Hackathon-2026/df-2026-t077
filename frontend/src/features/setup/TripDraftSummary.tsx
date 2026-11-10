import type { Spot } from '../../api/types'
import { dateForSpots } from '../../api/hooks'
import { useLocale } from '../../i18n/useLocale'
import { isOmakase, MAX_REQUESTED_STOPS, type TripFormValues } from './formTypes'
import { autoOmakaseSlots } from './formSchema'

export function TripDraftSummary({ values, spots }: { values: TripFormValues; spots: Spot[] }) {
  const { t, locale } = useLocale()
  const name = (id: string) => {
    const spot = spots.find((s) => s.id === id)
    return spot ? locale === 'ja' ? spot.name_ja : spot.name_en : t('setupNotEntered')
  }
  const chosen = values.requestedStops.filter((s) => s.spotId)
  const auto = chosen.length ? autoOmakaseSlots(values.requestedStops, values.maxVisits)?.added ?? 0 : 0
  const date = dateForSpots(values.date) ? new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric', weekday: 'short', timeZone: 'Asia/Tokyo' }).format(new Date(`${values.date}T00:00:00+09:00`)) : t('setupNotEntered')
  return <aside className="trip-draft" aria-labelledby="trip-draft-title">
    <span className="trip-draft__mark" aria-hidden="true">↗</span>
    <h3 id="trip-draft-title">{t('setupDraftTitle')}</h3>
    <p className="trip-draft__date">{date}</p><p>{values.startTime || '—'} <span aria-hidden="true">→</span> {values.endTime || '—'}<small>{t('japanTime')}</small></p>
    <dl><div><dt>{t('startSpot')}</dt><dd>{name(values.startSpotId)}</dd></div><div><dt>{t('endSpot')}</dt><dd>{name(values.endSpotId)}</dd></div><div><dt>{t('maxWalkKm')}</dt><dd>{values.maxWalkKm ? `${values.maxWalkKm} km` : '—'}</dd></div></dl>
    <h4>{t('setupPlaces')} <span>{chosen.length + auto} / {MAX_REQUESTED_STOPS}</span></h4>
    {/* "/ 6" is the system maximum, not the visit limit the user enters. */}
    <p className="trip-draft__max">{t('setupPlacesSystemMax').replace('{max}', String(MAX_REQUESTED_STOPS))}</p>
    {chosen.length ? <ol>{chosen.map((stop, i) => <li key={`${i}-${stop.spotId}`}><span>{isOmakase(stop) ? t('omakaseName') : name(stop.spotId)}</span><small>{t(isOmakase(stop) ? 'omakaseName' : stop.requirement === 'must' ? 'setupRequired' : 'setupOptional')}</small></li>)}
      {Array.from({ length: auto }, (_, i) => <li key={`auto-${i}`}><span>{t('omakaseName')}</span><small>{t('omakaseAutoShort')}</small></li>)}</ol> : <p className="trip-draft__empty">{t('setupNoPlaces')}</p>}
    <p className="trip-draft__hint">{t('setupDraftHint')}</p>
  </aside>
}
