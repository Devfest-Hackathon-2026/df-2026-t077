import type { Spot } from '../../api/types'
import { useLocale } from '../../i18n/useLocale'
import { isOmakase, type TripFormValues } from './formTypes'
import { autoOmakaseSlots } from './formSchema'

export function TripConfirmation({ values, spots }: { values: TripFormValues; spots: Spot[] }) {
  const { t, locale } = useLocale()
  // The same count toTripInput adds to omakase_visits, shown before the user confirms.
  const auto = autoOmakaseSlots(values.requestedStops, values.maxVisits)?.added ?? 0
  const name = (id: string) => { const spot = spots.find((s) => s.id === id); return spot ? locale === 'ja' ? spot.name_ja : spot.name_en : id }
  return <div className="trip-form__review">
    <dl className="trip-form__review-grid"><div><dt>{t('visitDate')}</dt><dd>{values.date}<small>{values.startTime}–{values.endTime} · {t('japanTime')}</small></dd></div>
      <div><dt>{t('startSpot')} → {t('endSpot')}</dt><dd>{name(values.startSpotId)} → {name(values.endSpotId)}</dd></div>
      <div><dt>{t('maxWalkKm')}</dt><dd>{values.maxWalkKm} km</dd></div>
      <div><dt>{t('maxVisits')} / {t('partySize')}</dt><dd>{values.maxVisits} / {values.partySize}</dd></div>
      <div><dt>{t('interests')}</dt><dd>{values.interests.map((v) => t(v)).join(', ')}</dd></div></dl>
    <ol className="trip-form__review-stops">{values.requestedStops.map((s, i) => isOmakase(s) ? <li key={`omakase-${i}`}><strong>{t('omakaseName')}</strong><span>{t('omakaseReview')}</span></li> : <li key={s.spotId}><strong>{name(s.spotId)}</strong><span>{t(s.requirement)}</span>{s.lockedStartTime && <small>{t('fixedTime')}: {s.lockedStartTime}</small>}{s.reservationConfirmed && <small>{t('reservation')}</small>}</li>)}
      {Array.from({ length: auto }, (_, i) => <li key={`omakase-auto-${i}`} className="trip-form__review-auto"><strong>{t('omakaseAutoName')}</strong><span>{t('omakaseAutoReview')}</span></li>)}</ol>
    <h4>{t('avoidWindows')}</h4>
    {!values.avoidWindows.length ? <p>{t('noAvoidInput')}</p> : <ul>{values.avoidWindows.map((w) => <li key={w.id}>{name(w.spotId)} · {w.startTime}–{w.endTime} · {t(w.basis)}{w.note && ` · ${w.note}`}</li>)}</ul>}
    <h4>{t('waitAssumptions')}</h4><p>{t('waitHint')}</p>
    {!values.waitAssumptions.length ? <p>{t('noWaitInput')}</p> : <ul>{values.waitAssumptions.map((w) => <li key={w.spotId}>{name(w.spotId)} · {w.waitMinutes} min · {t(w.basis)}{w.observedDate && ` · ${w.observedDate} ${w.observedTime} JST`}{w.note && ` · ${w.note}`}</li>)}</ul>}
  </div>
}
