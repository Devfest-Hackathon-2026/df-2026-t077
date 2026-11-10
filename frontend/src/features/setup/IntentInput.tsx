import { useRef, useState } from 'react'
import { useFormContext } from 'react-hook-form'
import type { IntentInterpretRequest, Spot } from '../../api/types'
import type { components } from '../../api/schema'
import { interpretWishes } from '../../api/planning'
import { ApiNotice } from '../../components/ui/ApiNotice'
import { Button } from '../../components/ui/Button'
import { ServerText } from '../../components/ui/ServerText'
import { Drawer } from '../../components/ui/Drawer'
import { useLocale } from '../../i18n/useLocale'
import { dateForSpots } from '../../api/hooks'
import type { MessageKey } from '../../i18n/messages'
import { partialIntentInput } from './formHelpers'
import type { TripFormValues } from './formTypes'
import { applySuggestions, draftSuggestions } from './intentMapping'

type IntentResponse = components['schemas']['IntentDraftResponse']
export function IntentInput({ areaId, spots, visitDate, onApplied }: { areaId: string; spots: Spot[]; visitDate: string; onApplied: () => void }) {
  const { getValues, reset } = useFormContext<TripFormValues>()
  const { t, locale } = useLocale()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const running = useRef(false)
  const [error, setError] = useState<unknown>()
  const [result, setResult] = useState<{ response: IntentResponse; text: string; form: TripFormValues; locale: string }>()
  const [selected, setSelected] = useState<string[]>([])
  const [applied, setApplied] = useState(false)
  const request = useRef<{ signature: string; body: IntentInterpretRequest } | undefined>(undefined)
  const date = visitDate
  async function interpret() {
    if (running.current || !dateForSpots(date) || !areaId || !text.trim()) return
    running.current = true; setBusy(true); setError(undefined); setApplied(false)
    const form = structuredClone(getValues())
    const input = { text: text.trim(), area_id: areaId, visit_date: date, locale, current_input: partialIntentInput(form, areaId, locale) }
    const signature = JSON.stringify(input)
    if (request.current?.signature !== signature) request.current = { signature, body: { ...input, client_request_id: crypto.randomUUID() } }
    try {
      const response = await interpretWishes(request.current.body)
      if (JSON.stringify(form) !== JSON.stringify(getValues())) { setError(new Error('Input changed')); return }
      setResult({ response, text, form, locale }); setSelected([])
    } catch (failure) { setError(failure) }
    finally { running.current = false; setBusy(false) }
  }
  const review = result ? draftSuggestions(result.form, result.response.draft, spots) : null
  const fieldTitles: Partial<Record<keyof TripFormValues, MessageKey>> = { maxWalkKm: 'maxWalkKm', endTime: 'endTime', interests: 'interests', requestedStops: 'visits', avoidWindows: 'avoidWindows', waitAssumptions: 'waitAssumptions' }
  const fieldTitle = (field: keyof TripFormValues) => t(fieldTitles[field] ?? 'inputErrors')
  const name = (id: string) => { const s = spots.find((s) => s.id === id); return s ? locale === 'ja' ? s.name_ja : s.name_en : id }
  return <section className="trip-form__wide trip-form__intent"><label htmlFor="trip-wishes">{t('intentTitle')}</label><p>{t('intentHint')}</p>
    <textarea id="trip-wishes" value={text} maxLength={2000} rows={3} placeholder={t('setupIntentPlaceholder')} disabled={busy} onChange={(e) => { setText(e.target.value); setResult(undefined); setApplied(false) }} />
    {!dateForSpots(date) && <small>{t('dateFirst')}</small>}
    <Button type="button" disabled={busy || !text.trim() || !areaId || !dateForSpots(date) || !spots.length} onClick={() => void interpret()}>{t(busy ? 'interpreting' : 'interpretIntent')}</Button>
    {error !== undefined && <><ApiNotice error={error} /><p>{t('intentUnavailable')}</p></>}{applied && <p role="status">{t('draftApplied')}</p>}
    {result && review && <Drawer title={t('intentReview')} onClose={() => setResult(undefined)}>
      <h3>{t('originalText')}</h3><p>{result.text}</p>
      {result.locale !== locale && <p>{t('explanationLanguage')}: {result.locale}</p>}
      {review.skipped && <p className="notice">{t('draftSkipped')}</p>}
      {!review.suggestions.length && <p>{t('noDraft')}</p>}
      {review.suggestions.map((suggestion) => <section key={suggestion.field}><label className="trip-form__check"><input type="checkbox" checked={selected.includes(suggestion.field)} onChange={(e) => setSelected(e.target.checked ? [...selected, suggestion.field] : selected.filter((v) => v !== suggestion.field))} />{fieldTitle(suggestion.field)}</label>
        {suggestion.patch.maxWalkKm && <p>{suggestion.patch.maxWalkKm} km</p>}{suggestion.patch.endTime && <p>{suggestion.patch.endTime} JST</p>}
        {suggestion.patch.interests && <p>{suggestion.patch.interests.map((v) => t(v)).join(', ')}</p>}
        {suggestion.patch.requestedStops?.map((s) => <p key={s.spotId}>{name(s.spotId)} · {t(s.requirement)} {s.lockedStartTime}{s.reservationConfirmed && ` · ${t('reservation')}`}</p>)}
        {suggestion.patch.avoidWindows?.map((w) => <p key={w.id}>{name(w.spotId)} · {w.startTime}–{w.endTime} · {t(w.basis)} · {w.note}</p>)}
        {suggestion.patch.waitAssumptions?.map((w) => <p key={w.spotId}>{name(w.spotId)} · {w.waitMinutes} min · {t(w.basis)} · {w.observedDate} {w.observedTime} · {w.note}</p>)}
      </section>)}
      {result.response.draft.field_notes.map((n, i) => <p key={i}>{t('sourceQuote')}: “{n.source_quote}”</p>)}
      {!!result.response.unresolved.length && <h3>{t('unresolved')}</h3>}{result.response.unresolved.map((q, i) => <p key={i}><ServerText text={q.question} sourceLocale={result.locale as 'ja' | 'en'} />{q.source_quote && ` — “${q.source_quote}”`}</p>)}
      {result.response.warnings.map((w, i) => <p key={i} className="notice">{w === 'INTENT_UNAVAILABLE' ? t('intentUnavailable') : <ServerText text={w} sourceLocale={result.locale as 'ja' | 'en'} />}</p>)}
      <Button type="button" disabled={!selected.length} onClick={() => { reset(applySuggestions(getValues(), review.suggestions.filter((s) => selected.includes(s.field)))); onApplied(); setResult(undefined); setApplied(true) }}>{t('applyDraft')}</Button>
      <Button type="button" onClick={() => setResult(undefined)}>{t('rejectDraft')}</Button>
    </Drawer>}
  </section>
}
