import { useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { PlanningAttempt } from '../api/attempts'
import { client, unwrap } from '../api/client'
import { Button } from '../components/ui/Button'
import { StatusPanel } from '../components/ui/StatusPanel'
import { useLocale } from '../i18n/useLocale'
import { fromJapanDateTime, japanTripWindow } from '../lib/japanTime'
import { mockStore } from './runtime'

export default function MockPlanningForm() {
  const { locale, t } = useLocale()
  const navigate = useNavigate()
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>()
  const attempt = useRef<{ locale: string; value: PlanningAttempt } | null>(null)
  const sample = mockStore.sampleRequest(locale)
  const start = fromJapanDateTime(sample.constraints.start_at)
  const end = fromJapanDateTime(sample.constraints.end_at)

  async function submit(event?: FormEvent) {
    event?.preventDefault()
    if (!confirmed || busy) return
    setBusy(true)
    setError(undefined)
    try {
      if (!attempt.current || attempt.current.locale !== locale) {
        const input = { ...sample, constraints: { ...sample.constraints, ...japanTripWindow(start.date, start.time, end.time) } }
        attempt.current = { locale, value: new PlanningAttempt(input) }
      }
      const result = await attempt.current.value.run({
        createTrip: (body) => unwrap(client.POST('/api/v1/trips', { body })),
        generateProposal: (tripId, body) => unwrap(client.POST('/api/v1/trips/{trip_id}/proposals', { params: { path: { trip_id: tripId } }, body })),
      })
      navigate(`/trips/${result.trip.trip.id}/compare?proposalId=${result.proposal.id}`)
    } catch (failure) { setError(failure) }
    finally { setBusy(false) }
  }
  return <section className="status" aria-labelledby="mock-flow-title"><h2 id="mock-flow-title">{t('flowTitle')}</h2><p>{t('flowNote')}</p><form onSubmit={(event) => void submit(event)}>
    <p>{start.date} · {start.time}–{end.time} JST · {sample.constraints.max_walk_meters} m</p>
    <p>{t('flowStops')}</p>
    <label className="confirmation"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={busy} /> {t('confirmSample')}</label>
    <p><Button className="primary" type="submit" disabled={!confirmed || busy}>{busy ? t('loading') : t('createSample')}</Button></p>
  </form>{error !== undefined && <StatusPanel error={error} onRetry={() => void submit()} />}</section>
}
