import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PlanningAttempt } from '../../api/attempts'
import { planningApi } from '../../api/planning'
import type { TripInput } from './toTripInput'

/** A retry reuses both UUIDs and any Trip already created by this confirmed submission. */
export function usePlanSubmission() {
  const navigate = useNavigate()
  const attempt = useRef<{ signature: string; value: PlanningAttempt } | null>(null)
  const active = useRef(false)
  const mounted = useRef(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>()
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const reset = useCallback(() => { if (!active.current) { attempt.current = null; setError(undefined) } }, [])
  async function submit(input: TripInput) {
    if (active.current) return
    active.current = true
    setBusy(true)
    setError(undefined)
    const signature = JSON.stringify(input)
    if (attempt.current?.signature !== signature) attempt.current = { signature, value: new PlanningAttempt(input) }
    try {
      const result = await attempt.current.value.run(planningApi)
      if (mounted.current) navigate(`/trips/${result.trip.trip.id}/compare?proposalId=${result.proposal.id}`)
    } catch (failure) {
      if (mounted.current) setError(failure)
      throw failure
    } finally {
      active.current = false
      if (mounted.current) setBusy(false)
    }
  }
  return { submit, reset, busy, error }
}
