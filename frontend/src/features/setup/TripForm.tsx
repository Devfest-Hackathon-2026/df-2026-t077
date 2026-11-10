import { useEffect, useRef, useState } from 'react'
import { FormProvider, useForm, useWatch, type FieldPath } from 'react-hook-form'
import { ApiError } from '../../api/client'
import { useSpots, dateForSpots } from '../../api/hooks'
import { env } from '../../config/env'
import { Button } from '../../components/ui/Button'
import { ApiNotice } from '../../components/ui/ApiNotice'
import { useLocale } from '../../i18n/useLocale'
import type { MessageKey } from '../../i18n/messages'
import { isOmakase, type TripFormValues, type Interest } from './formTypes'
import { emptyTripForm, formFromTrip } from './formHelpers'
import { tripFormSchema } from './formSchema'
import { toTripInput } from './toTripInput'
import { InputField } from './FormFields'
import { validationText } from './validationText'
import { SpotPicker } from './SpotPicker'
import { VisitFields } from './VisitFields'
import { VisitLimitNotice, VISIT_LIMIT_NOTICE_ID } from './VisitLimitNotice'
import { AdvancedOptions } from './AdvancedOptions'
import { TripConfirmation } from './TripConfirmation'
import { TripDraftSummary } from './TripDraftSummary'
import { IntentInput } from './IntentInput'
import { usePlanSubmission } from './usePlanSubmission'
import { apiFieldToForm } from './apiFields'
import './setup.css'

const VISIT_LIMIT_MESSAGE = 'validation.tooManyVisits'
const interests: Interest[] =['history', 'photography', 'nature', 'food', 'art', 'quiet']
const labels: Record<string, MessageKey> = { date: 'visitDate', startTime: 'startTime', endTime: 'endTime', startSpotId: 'startSpot', endSpotId: 'endSpot', maxWalkKm: 'maxWalkKm', maxVisits: 'maxVisits', partySize: 'partySize', interests: 'interests', requestedStops: 'visits', avoidWindows: 'avoidWindows', waitAssumptions: 'waitAssumptions' }

export function TripForm() {
  const { t, locale } = useLocale()
  const methods = useForm<TripFormValues>({ defaultValues: emptyTripForm() })
  const values = useWatch({ control: methods.control })
  const date = values.date ?? ''
  const spots = useSpots(env.areaId, date)
  const items = spots.data?.items ?? []
  const submission = usePlanSubmission()
  const resetSubmission = submission.reset
  const [issues, setIssues] = useState<{ path: string; message: string }[]>([])
  const [reviewed, setReviewed] = useState<{ values: TripFormValues; signature: string } | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [sampleLoaded, setSampleLoaded] = useState(false)
  const summary = useRef<HTMLDivElement>(null)
  const confirmation = useRef<HTMLHeadingElement>(null)
  const signature = JSON.stringify({ values, locale, areaId: env.areaId })
  const currentReview = reviewed?.signature === signature ? reviewed : null

  useEffect(() => {
    return methods.subscribe({ formState: { values: true }, callback: () => { setReviewed(null); setConfirmed(false); resetSubmission() } })
  }, [methods, resetSubmission])

  function review() {
    methods.clearErrors(); setConfirmed(false); setReviewed(null)
    const parsed = tripFormSchema.safeParse(methods.getValues())
    const found = parsed.success ? [] : parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
    if (parsed.success) {
      const ids = new Set(items.map((s) => s.id))
      if (!ids.has(parsed.data.startSpotId)) found.push({ path: 'startSpotId', message: 'unknownSpot' })
      if (!ids.has(parsed.data.endSpotId)) found.push({ path: 'endSpotId', message: 'unknownSpot' })
      parsed.data.requestedStops.forEach((s, i) => { if (!isOmakase(s) && !ids.has(s.spotId)) found.push({ path: `requestedStops.${i}.spotId`, message: 'unknownSpot' }) })
    }
    setIssues(found)
    found.forEach((issue) => methods.setError(issue.path as FieldPath<TripFormValues>, { type: 'validate', message: issue.message }))
    if (found.length) {
      // Over the visit limit: go straight to the notice that says how many places and what to change.
      const overLimit = found.some((issue) => issue.message === VISIT_LIMIT_MESSAGE)
      requestAnimationFrame(() => overLimit ? focusVisitLimit() : summary.current?.focus())
      return
    }
    if (parsed.success) {
      setReviewed({ values: parsed.data, signature })
      requestAnimationFrame(() => confirmation.current?.focus())
    }
  }

  function focusVisitLimit() {
    const notice = document.getElementById(VISIT_LIMIT_NOTICE_ID)
    if (!notice) return
    notice.focus()
    notice.scrollIntoView({ block: 'center' })
  }

  function focusIssue(path: string, message?: string) {
    if (message === VISIT_LIMIT_MESSAGE) { requestAnimationFrame(focusVisitLimit); return }
    const target = document.getElementById(`trip-${path.replaceAll('.', '-')}`)
      ?? (path === 'interests' ? document.querySelector<HTMLInputElement>('input[name="interests"]') : null)
      ?? (path.startsWith('requestedStops') ? document.getElementById('trip-add-visit') : null)
    if (!target) return
    for (let parent = target.parentElement; parent; parent = parent.parentElement) {
      if (parent instanceof HTMLDetailsElement) parent.open = true
    }
    requestAnimationFrame(() => { target.focus(); target.scrollIntoView({ block: 'center' }) })
  }

  async function submit() {
    if (!currentReview || !confirmed || submission.busy) return
    try { await submission.submit(toTripInput(currentReview.values, { areaId: env.areaId, locale, intentConfirmed: confirmed })) }
    catch (failure) {
      if (failure instanceof ApiError && failure.status === 422) {
        const mapped = failure.details.map((d) => ({ path: apiFieldToForm(d.field), message: t('invalidValue') })).filter((d) => d.path !== null)
        for (const d of mapped) methods.setError(d.path as FieldPath<TripFormValues>, { type: 'server', message: d.message })
        if (mapped.length) setIssues(mapped.map((d) => ({ path: d.path!, message: 'invalidValue' })))
      }
    }
  }

  async function loadSample() {
    if (import.meta.env.DEV && env.mocks) {
      const { mockStore } = await import('../../mocks/runtime')
      methods.reset(formFromTrip(mockStore.sampleRequest(locale)))
      methods.clearErrors(); setIssues([]); setSampleLoaded(true); submission.reset()
    }
  }

  return <section className="trip-form trip-form--planning" aria-label={t('planningTitle')}>
    {env.mocks && <aside className="trip-form__sample"><p>{t('setupSampleHint')}</p><Button type="button" disabled={submission.busy} onClick={() => void loadSample()}>{t('loadDemo')}</Button></aside>}
    {sampleLoaded && <p role="status">{t('sampleLoaded')}</p>}
    {!env.areaId && <p role="alert">{t('areaMissing')}</p>}
    <div className="trip-form__layout"><div className="trip-form__main">
    {!!issues.length && <div role="alert" ref={summary} tabIndex={-1} className="trip-form__errors"><h3>{t('inputErrors')}</h3><ul>{issues.map((issue, i) => <li key={i}><a href={`#trip-${issue.path.replaceAll('.', '-')}`} onClick={(event) => { event.preventDefault(); focusIssue(issue.path, issue.message) }}>{t(labels[issue.path.split('.')[0]] ?? 'inputErrors')}: {validationText(issue.message, t)}</a></li>)}</ul></div>}
    <FormProvider {...methods}>
      <form noValidate onSubmit={(event) => { event.preventDefault(); review() }}>
        <fieldset disabled={submission.busy} className="trip-form__controls">
        <fieldset className="trip-form__section"><legend><span className="trip-form__step" aria-hidden="true">01</span>{t('setupBasics')}</legend><p className="trip-form__section-hint">{t('setupBasicsHint')}</p>
          <div className="trip-form__grid trip-form__schedule">
          <InputField name="date" label={t('visitDate')} type="date" />
          <InputField name="startTime" label={t('startTime')} type="time" />
          <InputField name="endTime" label={t('endTime')} type="time" />
          </div><p className="trip-form__timezone">{t('japanTime')} · {t('setupWalkingOnly')}</p>
          {!dateForSpots(date) ? <p className="trip-form__wide">{t('dateFirst')}</p> : spots.isPending ? <p role="status">{t('spotsLoading')}</p> : spots.isError ? <div className="trip-form__wide"><p>{t('spotsFailed')}</p><ApiNotice error={spots.error} /><Button type="button" onClick={() => void spots.refetch()}>{t('retry')}</Button></div> : !items.length ? <p>{t('noSpots')}</p> : null}
          <div className="trip-form__grid trip-form__endpoints"><SpotPicker name="startSpotId" label={t('startSpot')} spots={items} disabled={!items.length} />
          <SpotPicker name="endSpotId" label={t('endSpot')} spots={items} disabled={!items.length} /></div>
          <Button className="trip-form__text-button" type="button" disabled={!values.startSpotId} onClick={() => methods.setValue('endSpotId', methods.getValues('startSpotId'), { shouldDirty: true })}>{t('setupSameReturn')}</Button>
        </fieldset>
          <IntentInput visitDate={date} areaId={env.areaId} spots={items} onApplied={() => { setReviewed(null); setConfirmed(false); setIssues([]); methods.clearErrors(); submission.reset() }} />
          <VisitFields spots={items} />
        <fieldset className="trip-form__section"><legend><span className="trip-form__step" aria-hidden="true">03</span>{t('setupPace')}</legend><p className="trip-form__section-hint">{t('setupPaceHint')}</p>
          <fieldset className="trip-form__interest-group"><legend>{t('interests')}</legend><p id="trip-interests-hint" className="trip-form__section-hint">{t('setupInterestsHint')}</p><div className="trip-form__choices">{interests.map((interest) => <label className="trip-form__check trip-form__interest" key={interest}><input type="checkbox" value={interest} {...methods.register('interests')} aria-describedby="trip-interests-hint" />{t(interest)}</label>)}</div></fieldset>
          <div className="trip-form__grid"><InputField name="maxWalkKm" label={t('maxWalkKm')} type="number" min="0.1" max="30" step="any" hint={t('maxWalkHint')} />
          <InputField name="maxVisits" label={t('maxVisits')} type="number" min="1" max="6" step="1" after={<VisitLimitNotice />} />
          <InputField name="partySize" label={t('partySize')} type="number" min="1" max="10" step="1" /></div>
        </fieldset>
          <AdvancedOptions spots={items} />
          <div className="trip-form__review-action"><p>{t('setupReviewHint')}</p><Button className="primary" type="submit" disabled={!!dateForSpots(date) && spots.isPending}>{t('reviewConditions')} <span aria-hidden="true">→</span></Button></div>
        </fieldset>
      </form>
    </FormProvider>
    {currentReview && <section className="trip-form__confirmation" aria-labelledby="trip-confirm-title"><span className="trip-form__step" aria-hidden="true">04</span><h3 id="trip-confirm-title" ref={confirmation} tabIndex={-1}>{t('confirmationTitle')}</h3><p>{t('setupConfirmHint')}</p>
      <TripConfirmation values={currentReview.values} spots={items} />
      <label className="trip-form__check"><input type="checkbox" checked={confirmed} disabled={submission.busy} onChange={(e) => setConfirmed(e.target.checked)} />{t('confirmConditions')}</label>
      <div className="trip-form__actions"><Button className="primary" type="button" disabled={!confirmed || submission.busy} onClick={() => void submit()}>{t(submission.busy ? 'generatingProposal' : submission.error !== undefined ? 'retrySubmission' : 'generateProposal')}</Button><Button type="button" disabled={submission.busy} onClick={() => { setReviewed(null); setConfirmed(false); submission.reset(); methods.setFocus('date') }}>{t('editConditions')}</Button></div>
    </section>}
    {submission.busy && <p role="status">{t('generatingProposal')}</p>}
    {submission.error !== undefined && <ApiNotice error={submission.error} />}
    </div><TripDraftSummary values={methods.getValues()} spots={items} /></div>
  </section>
}
