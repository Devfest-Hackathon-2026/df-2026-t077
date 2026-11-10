import { useEffect, useRef, useState } from 'react'
import { FormProvider, useForm, type FieldPath } from 'react-hook-form'
import { useNavigate } from 'react-router-dom'
import { ZodError } from 'zod'
import type { components } from '../../api/schema'
import type { ProposalBundle, Locale } from '../../api/types'
import { useSpots, useTrip } from '../../api/hooks'
import { ApiError } from '../../api/client'
import { generateProposal } from '../../api/planning'
import { env } from '../../config/env'
import { Button } from '../../components/ui/Button'
import { Drawer } from '../../components/ui/Drawer'
import { ApiNotice } from '../../components/ui/ApiNotice'
import { useLocale } from '../../i18n/useLocale'
import { fromJapanDateTime } from '../../lib/japanTime'
import { formFromTrip } from '../setup/formHelpers'
import { InputField } from '../setup/FormFields'
import { validationText } from '../setup/validationText'
import { AdvancedOptions } from '../setup/AdvancedOptions'
import type { TripFormValues, Interest } from '../setup/formTypes'
import { refineRequest } from './refineRequest'
import '../setup/setup.css'

interface Props { tripId: string; effectiveConstraints?: ProposalBundle['effective_constraints']; expectedVersion?: number; onClose: () => void; onGenerated?: () => void }
export function RefineForm({ tripId, effectiveConstraints, expectedVersion, onClose, onGenerated }: Props) {
  const trip = useTrip(tripId)
  const { t } = useLocale()
  return <Drawer title={t('refine')} onClose={onClose}>
    {trip.isPending ? <p role="status">{t('loading')}</p> : trip.isError ? <><ApiNotice error={trip.error} /><Button type="button" onClick={() => void trip.refetch()}>{t('retry')}</Button></> : <RefineEditor expectedVersion={expectedVersion} tripId={tripId} trip={trip.data} initial={effectiveConstraints ?? trip.data.trip.constraints} reload={trip.refetch} onGenerated={onGenerated ?? onClose} />}
  </Drawer>
}

function RefineEditor({ tripId, trip, initial, expectedVersion, reload, onGenerated }: { expectedVersion?: number; tripId: string; trip: components['schemas']['TripResponse']; initial: ProposalBundle['effective_constraints']; reload: () => Promise<{ data?: components['schemas']['TripResponse']; isError?: boolean }>; onGenerated: () => void }) {
  const { t, locale } = useLocale()
  const navigate = useNavigate()
  const [original, setOriginal] = useState(initial)
  const [version, setVersion] = useState(expectedVersion ?? trip.trip.version)
  const form = useForm<TripFormValues>({ defaultValues: formFromTrip({ constraints: initial, requested_stops: trip.trip.requested_stops }) })
  const spots = useSpots(original.area_id, fromJapanDateTime(original.start_at).date)
  const [language, setLanguage] = useState<Locale>(locale)
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const active = useRef(false)
  const alive = useRef(true)
  const [error, setError] = useState<unknown>(() => expectedVersion !== undefined && expectedVersion !== trip.trip.version ? new ApiError(409, 'VERSION_CONFLICT') : undefined)
  const attempt = useRef<{ signature: string; id: string } | undefined>(undefined)
  useEffect(() => { alive.current = true; const unsubscribe = form.subscribe({ formState: { values: true }, callback: () => setConfirmed(false) }); return () => { alive.current = false; unsubscribe() } }, [form])
  async function refresh() {
    const latest = await reload()
    if (!latest.data || latest.isError) return
    setOriginal(latest.data.trip.constraints); setVersion(latest.data.trip.version)
    form.reset(formFromTrip({ constraints: latest.data.trip.constraints, requested_stops: latest.data.trip.requested_stops }))
    setConfirmed(false); setError(undefined); attempt.current = undefined
  }
  async function submit() {
    if (!confirmed || active.current) return
    active.current = true; setBusy(true); setError(undefined); form.clearErrors()
    try {
      const latest = await reload()
      if (!latest.data || latest.isError) throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE')
      if (latest.data.trip.version !== version) throw new ApiError(409, 'VERSION_CONFLICT')
      const body = env.mocks ? { client_request_id: '', base_version: version, mode: latest.data.trip.active_selection ? 'refine' as const : 'initial' as const, constraint_overrides: { locale: language } } : refineRequest(latest.data.trip, form.getValues(), original, language, '')
      const signature = JSON.stringify(body)
      if (attempt.current?.signature !== signature) attempt.current = { signature, id: crypto.randomUUID() }
      body.client_request_id = attempt.current.id
      const result = await generateProposal(tripId, body)
      if (alive.current) { onGenerated(); navigate(`/trips/${tripId}/compare?proposalId=${result.id}`) }
    } catch (failure) {
      if (alive.current) {
        setError(failure)
        if (failure instanceof ZodError) {
          failure.issues.forEach((issue) => form.setError(issue.path.join('.') as FieldPath<TripFormValues>, { type: 'validate', message: issue.message }))
          const target = document.getElementById(`trip-${failure.issues[0]?.path.join('-')}`)
          for (let parent = target?.parentElement; parent; parent = parent.parentElement) if (parent instanceof HTMLDetailsElement) parent.open = true
          requestAnimationFrame(() => target?.focus())
        }
      }
    }
    finally { active.current = false; if (alive.current) setBusy(false) }
  }
  const choices: Interest[] = ['history', 'photography', 'nature', 'food', 'art', 'quiet']
  return <div className="trip-form"><p>{t('refineHint')}</p>{env.mocks && <p className="notice">{t('refineMock')}</p>}
    <FormProvider {...form}><form noValidate onSubmit={(e) => { e.preventDefault(); void submit() }}>
      <fieldset disabled={busy || env.mocks}>
        <InputField name="maxWalkKm" label={t('maxWalkKm')} type="number" min="0.1" max="30" step="any" />
        <InputField name="endTime" label={t('endTime')} type="time" />
        <fieldset><legend>{t('interests')}</legend>{choices.map((v) => <label key={v} className="trip-form__check"><input type="checkbox" value={v} {...form.register('interests')} />{t(v)}</label>)}</fieldset>
        <AdvancedOptions spots={spots.data?.items ?? []} />
      </fieldset>
      <label>{t('explanationLocale')}<select value={language} disabled={busy} onChange={(e) => { setLanguage(e.target.value as Locale); setConfirmed(false) }}><option value="ja">日本語</option><option value="en">English</option></select></label>
      <label className="trip-form__check"><input type="checkbox" checked={confirmed} disabled={busy} onChange={(e) => setConfirmed(e.target.checked)} />{t('confirmConditions')}</label>
      <Button className="primary" type="submit" disabled={!confirmed || busy}>{t(busy ? 'generatingProposal' : 'refine')}</Button>
    </form></FormProvider>
    {error instanceof ZodError ? <div role="alert"><h3>{t('inputErrors')}</h3><ul>{error.issues.map((e, i) => <li key={i}>{validationText(e.message, t)}</li>)}</ul></div> : error !== undefined && <ApiNotice error={error} />}
    {error instanceof ApiError && ['VERSION_CONFLICT', 'MODE_CONFLICT'].includes(error.code) && <Button type="button" disabled={busy} onClick={() => void refresh()}>{t('reviewLatest')}</Button>}
  </div>
}
