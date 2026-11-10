import { useFieldArray, useFormContext, useWatch } from 'react-hook-form'
import type { Spot } from '../../api/types'
import { Button } from '../../components/ui/Button'
import { useLocale } from '../../i18n/useLocale'
import type { TripFormValues } from './formTypes'
import { InputField } from './FormFields'
import { SpotPicker } from './SpotPicker'

export function AdvancedOptions({ spots }: { spots: Spot[] }) {
  const { control, register } = useFormContext<TripFormValues>()
  const avoids = useFieldArray({ control, name: 'avoidWindows', keyName: 'formKey' })
  const waits = useFieldArray({ control, name: 'waitAssumptions', keyName: 'formKey' })
  const selected = useWatch({ control, name: 'requestedStops' })
  const waitValues = useWatch({ control, name: 'waitAssumptions' })
  const visitSpots = spots.filter((s) => selected.some((v) => v.spotId === s.id))
  const { t } = useLocale()
  return <details className="trip-form__wide trip-form__advanced"><summary><span>{t('advanced')}</span><span className="trip-form__optional">{t('setupOptional')}</span></summary>
    <fieldset><legend>{t('avoidWindows')}</legend>
      {avoids.fields.map((field, i) => <section className="trip-form__item" key={field.formKey}>
        <SpotPicker name={`avoidWindows.${i}.spotId`} label={t('visits')} spots={visitSpots} />
        <InputField name={`avoidWindows.${i}.startTime`} label={t('startTime')} type="time" />
        <InputField name={`avoidWindows.${i}.endTime`} label={t('endTime')} type="time" />
        <label>{t('basis')}<select {...register(`avoidWindows.${i}.basis`)}><option value="user_preference">{t('user_preference')}</option>{field.basis !== 'user_preference' && <option value={field.basis}>{t(field.basis)}</option>}</select></label>
        <InputField name={`avoidWindows.${i}.note`} label={t('note')} />
        <Button type="button" onClick={() => avoids.remove(i)}>{t('remove')}</Button>
      </section>)}
      <Button type="button" disabled={avoids.fields.length >= 6 || !visitSpots.length} onClick={() => avoids.append({ id: crypto.randomUUID(), spotId: '', startTime: '', endTime: '', basis: 'user_preference', evidenceIds: [], note: '' })}>{t('addAvoid')}</Button>
    </fieldset>
    <fieldset><legend>{t('waitAssumptions')}</legend><p>{t('waitHint')}</p>
      {waits.fields.map((field, i) => <section className="trip-form__item" key={field.formKey}>
        <SpotPicker name={`waitAssumptions.${i}.spotId`} label={t('visits')} spots={visitSpots} />
        <InputField name={`waitAssumptions.${i}.waitMinutes`} label={t('waitMinutes')} type="number" min="0" max="180" step="any" />
        <label>{t('basis')}<select {...register(`waitAssumptions.${i}.basis`)}><option value="user_assumption">{t('user_assumption')}</option><option value="user_observed">{t('user_observed')}</option>{field.basis === 'demo_assumption' && <option value="demo_assumption">{t('demo_assumption')}</option>}</select></label>
        {(waitValues[i]?.basis === 'user_observed' || waitValues[i]?.observedDate || waitValues[i]?.observedTime) && <>
          <InputField name={`waitAssumptions.${i}.observedDate`} label={t('observedDate')} type="date" />
          <InputField name={`waitAssumptions.${i}.observedTime`} label={t('observedTime')} type="time" />
        </>}
        <InputField name={`waitAssumptions.${i}.note`} label={t('note')} />
        <Button type="button" onClick={() => waits.remove(i)}>{t('remove')}</Button>
      </section>)}
      <Button type="button" disabled={waits.fields.length >= 2 || !visitSpots.length} onClick={() => waits.append({ spotId: '', waitMinutes: '', basis: 'user_assumption', observedDate: '', observedTime: '', note: '' })}>{t('addWait')}</Button>
    </fieldset>
  </details>
}
