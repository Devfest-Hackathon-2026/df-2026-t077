import { useFormContext, useWatch, type FieldPath } from 'react-hook-form'
import type { Spot } from '../../api/types'
import { Field } from '../../components/ui/Field'
import { useLocale } from '../../i18n/useLocale'
import { OMAKASE_SPOT, type TripFormValues } from './formTypes'
import { validationText } from './validationText'

export function SpotPicker({ name, label, spots, disabled = false, allowOmakase = false }: { name: FieldPath<TripFormValues>; label: string; spots: Spot[]; disabled?: boolean; allowOmakase?: boolean }) {
  const { register, control, getFieldState, formState } = useFormContext<TripFormValues>()
  const { locale, t } = useLocale()
  const value = useWatch({ control, name })
  const id = `trip-${name.replaceAll('.', '-')}`
  const error = getFieldState(name, formState).error
  const missing = typeof value === 'string' && value !== '' && !(allowOmakase && value === OMAKASE_SPOT) && !spots.some((s) => s.id === value)
  return <Field id={id} label={label}>
    <select {...register(name)} value={typeof value === 'string' ? value : ''} id={id} disabled={disabled} aria-invalid={!!error || missing} aria-describedby={error || missing ? `${id}-error` : undefined}>
      <option value="">{t('chooseSpot')}</option>
      {allowOmakase && <option value={OMAKASE_SPOT}>{t('omakaseOption')}</option>}
      {missing && <option value={value}>{t('unknownSpot')} ({value})</option>}
      {spots.map((spot) => <option key={spot.id} value={spot.id}>{locale === 'ja' ? spot.name_ja : spot.name_en}{spot.is_demo ? ` · ${t('demoSpot')}` : ''}</option>)}
    </select>
    {(error || missing) && <small className="form-error" id={`${id}-error`}>{missing ? t('unknownSpot') : validationText(error?.message, t)}</small>}
  </Field>
}
