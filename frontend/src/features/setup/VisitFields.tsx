import { useEffect } from 'react'
import { useFieldArray, useFormContext, useWatch } from 'react-hook-form'
import type { Spot } from '../../api/types'
import { Button } from '../../components/ui/Button'
import { useLocale } from '../../i18n/useLocale'
import { isOmakase, MAX_REQUESTED_STOPS, type TripFormValues } from './formTypes'
import { SpotPicker } from './SpotPicker'
import { InputField } from './FormFields'
import { VisitLimitNotice } from './VisitLimitNotice'

export function VisitFields({ spots }: { spots: Spot[] }) {
  const { control, register, setValue } = useFormContext<TripFormValues>()
  const { fields, append, remove, move } = useFieldArray({ control, name: 'requestedStops' })
  const stops = useWatch({ control, name: 'requestedStops' })
  const { t, locale } = useLocale()
  // place_shift only swaps flexible visits, so with every visit marked must it can never be offered.
  const allMust = stops.length > 0 && stops.every((stop) => !isOmakase(stop) && stop.requirement === 'must')
  // An お任せ row is always a flexible visit: clear any must/fixed-time/reservation set before switching to it.
  useEffect(() => {
    stops.forEach((stop, i) => {
      if (!isOmakase(stop)) return
      if (stop.requirement !== 'optional') setValue(`requestedStops.${i}.requirement`, 'optional')
      if (stop.lockedStartTime) setValue(`requestedStops.${i}.lockedStartTime`, '')
      if (stop.reservationConfirmed) setValue(`requestedStops.${i}.reservationConfirmed`, false)
    })
  }, [stops, setValue])
  return <fieldset className="trip-form__section trip-form__visits"><legend><span className="trip-form__step" aria-hidden="true">02</span>{t('setupPlaces')}</legend><p className="trip-form__section-hint">{t('setupPlacesHint')}</p><p className="trip-form__candidate-hint">{t('setupCandidateHint')}</p>
    {!fields.length && <div className="trip-form__empty"><span aria-hidden="true">＋</span><strong>{t('setupVisitEmpty')}</strong><p>{t('setupVisitEmptyHint')}</p></div>}
    {fields.map((field, i) => {
      const selected = spots.find((spot) => spot.id === stops[i]?.spotId)
      return <section className="trip-form__item trip-form__visit" key={field.id} aria-label={`${t('visits')} ${i + 1}`}>
      <div className="trip-form__visit-heading"><span>{String(i + 1).padStart(2, '0')}</span><strong>{t('visits')} {i + 1}</strong></div>
      <SpotPicker name={`requestedStops.${i}.spotId`} label={`${i + 1}. ${t('visits')}`} spots={spots} allowOmakase />
      {stops[i] && isOmakase(stops[i]) ? <p className="notice" role="note" id={`trip-omakase-${i}`}>{t('omakaseHelp')}</p> : <>
      {selected && <div className="trip-form__place-preview"><p>{locale === 'ja' ? selected.description_ja : selected.description_en}</p><div>{selected.tags.map((tag) => <span key={tag}>{t(tag)}</span>)}</div></div>}
      <label>{t('requirement')}<select {...register(`requestedStops.${i}.requirement`)} disabled={!!stops[i]?.lockedStartTime || !!stops[i]?.reservationConfirmed}><option value="must">{t('must')}</option><option value="optional">{t('optional')}</option></select></label>
      <p className="trip-form__section-hint">{t(stops[i]?.requirement === 'must' ? 'setupMustHelp' : 'setupOptionalHelp')}</p>
      <details><summary>{t('fixedTime')}</summary>
        <InputField name={`requestedStops.${i}.lockedStartTime`} label={t('fixedTime')} type="time" onValue={(value) => { if (value) setValue(`requestedStops.${i}.requirement`, 'must', { shouldDirty: true }) }} />
        <label className="trip-form__check"><input type="checkbox" {...register(`requestedStops.${i}.reservationConfirmed`, { onChange: (event) => { if (event.target.checked) setValue(`requestedStops.${i}.requirement`, 'must', { shouldDirty: true }) } })} />{t('reservation')}</label>
        <small>{t('reservationHint')}</small>
      </details>
      </>}
      <div className="trip-form__actions"><Button type="button" disabled={i === 0} onClick={() => move(i, i - 1)}>{t('moveUp')}</Button><Button type="button" disabled={i === fields.length - 1} onClick={() => move(i, i + 1)}>{t('moveDown')}</Button><Button type="button" onClick={() => remove(i)}>{t('remove')}</Button></div>
    </section>})}
    <VisitLimitNotice live />
    {allMust && <p className="notice" role="note" id="trip-all-must-hint">{t('setupAllMustHint')}</p>}
    <Button id="trip-add-visit" className="trip-form__add-visit" type="button" disabled={fields.length >= MAX_REQUESTED_STOPS ||!spots.length} onClick={() => append({ spotId: '', requirement: 'optional', lockedStartTime: '', reservationConfirmed: false })}><span aria-hidden="true">＋</span>{t('addVisit')}</Button>
  </fieldset>
}
