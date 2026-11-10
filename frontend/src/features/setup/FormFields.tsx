import type { ReactNode } from 'react'
import { useFormContext, type FieldPath } from 'react-hook-form'
import { Field } from '../../components/ui/Field'
import { useLocale } from '../../i18n/useLocale'
import { validationText } from './validationText'
import type { TripFormValues } from './formTypes'

export function InputField({ name, label, type = 'text', min, max, step, hint, disabled = false, onValue, after }: {
  name: FieldPath<TripFormValues>; label: string; type?: string; min?: string; max?: string; step?: string; hint?: string; disabled?: boolean; onValue?: (value: string) => void; after?: ReactNode
}) {
  const { register, getFieldState, formState } = useFormContext<TripFormValues>()
  const { t } = useLocale()
  const error = getFieldState(name, formState).error
  const id = `trip-${name.replaceAll('.', '-')}`
  const binding = register(name)
  return <Field id={id} label={label} hint={hint}>
    <input {...binding} id={id} type={type} min={min} max={max} step={step} disabled={disabled} aria-invalid={!!error} aria-describedby={[hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined} onChange={(event) => { void binding.onChange(event); onValue?.(event.target.value) }} />
    {error && <small id={`${id}-error`} className="form-error">{validationText(error.message, t)}</small>}
    {after}
  </Field>
}
