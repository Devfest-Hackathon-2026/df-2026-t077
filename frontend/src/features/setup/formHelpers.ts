import type { TripCreateRequest, Locale } from '../../api/types'
import { fromJapanDateTime, toJapanDateTime } from '../../lib/japanTime'
import { OMAKASE_SPOT, isOmakase, type TripFormValues } from './formTypes'
import type { IntentInterpretRequest } from '../../api/types'

export const emptyTripForm = (): TripFormValues => ({
  date: '', startTime: '', endTime: '', startSpotId: '', endSpotId: '',
  maxWalkKm: '', maxVisits: '', partySize: '', interests: [], requestedStops: [], avoidWindows: [], waitAssumptions: [],
})

/** The sample loader/refine editor preserves every API preference and evidence reference. */
export function formFromTrip(input: Pick<TripCreateRequest, 'constraints' | 'requested_stops'>): TripFormValues {
  const c = input.constraints
  const start = fromJapanDateTime(c.start_at)
  return {
    date: start.date, startTime: start.time, endTime: fromJapanDateTime(c.end_at).time,
    startSpotId: c.start_spot_id, endSpotId: c.end_spot_id,
    maxWalkKm: String(c.max_walk_meters / 1000), maxVisits: String(c.max_visits), partySize: String(c.party_size), interests: [...c.interests],
    requestedStops: [
      ...input.requested_stops.map((s) => ({ spotId: s.spot_id, requirement: s.requirement, lockedStartTime: s.locked_start_at ? fromJapanDateTime(s.locked_start_at).time : '', reservationConfirmed: s.reservation_confirmed })),
      ...Array.from({ length: c.omakase_visits ?? 0 }, () => ({ spotId: OMAKASE_SPOT, requirement: 'optional' as const, lockedStartTime: '', reservationConfirmed: false })),
    ],
    avoidWindows: c.avoid_windows.map((w) => ({ id: w.id, spotId: w.spot_id, startTime: fromJapanDateTime(w.starts_at).time, endTime: fromJapanDateTime(w.ends_at).time, basis: w.basis, evidenceIds: [...(w.evidence_ids ?? [])], note: w.note })),
    waitAssumptions: c.wait_assumptions.map((w) => {
      const observed = w.observed_at ? fromJapanDateTime(w.observed_at) : null
      return { spotId: w.spot_id, waitMinutes: String(w.wait_seconds / 60), basis: w.basis, observedDate: observed?.date ?? '', observedTime: observed?.time ?? '', note: w.note }
    }),
  }
}

/** Send only explicitly entered values; no synthetic defaults or unconfirmed Trip creation. */
export function partialIntentInput(form: TripFormValues, areaId: string, locale: Locale): IntentInterpretRequest['current_input'] {
  const constraints: NonNullable<IntentInterpretRequest['current_input']['constraints']> = { area_id: areaId, locale }
  const dateTime = (time: string) => { try { return toJapanDateTime(form.date, time) } catch { return undefined } }
  if (dateTime(form.startTime)) constraints.start_at = dateTime(form.startTime)
  if (dateTime(form.endTime)) constraints.end_at = dateTime(form.endTime)
  if (form.startSpotId) constraints.start_spot_id = form.startSpotId
  if (form.endSpotId) constraints.end_spot_id = form.endSpotId
  if (form.interests.length) constraints.interests = [...form.interests]
  if (/^\d+(\.\d+)?$/.test(form.maxWalkKm) && Number(form.maxWalkKm) >= 0.1 && Number(form.maxWalkKm) <= 30) constraints.max_walk_meters = Math.round(Number(form.maxWalkKm) * 1000)
  if (/^[1-6]$/.test(form.maxVisits)) constraints.max_visits = Number(form.maxVisits)
  if (/^(?:[1-9]|10)$/.test(form.partySize)) constraints.party_size = Number(form.partySize)
  // Only include complete, explicit preference groups; incomplete ones stay in the form.
  try {
    if (form.avoidWindows.length) constraints.avoid_windows = form.avoidWindows.map((w) => ({ id: w.id, spot_id: w.spotId, starts_at: toJapanDateTime(form.date, w.startTime), ends_at: toJapanDateTime(form.date, w.endTime), basis: w.basis, evidence_ids: [...w.evidenceIds], note: w.note }))
  } catch { /* Do not invent a date or time for an incomplete group. */ }
  if (form.waitAssumptions.length && form.waitAssumptions.every((w) => /^\d+(\.\d+)?$/.test(w.waitMinutes) && Number(w.waitMinutes) >= 0 && Number(w.waitMinutes) <= 180 && (w.basis !== 'user_observed' || (w.observedDate && w.observedTime)))) {
    try { constraints.wait_assumptions = form.waitAssumptions.map((w) => ({ spot_id: w.spotId, wait_seconds: Math.round(Number(w.waitMinutes) * 60), basis: w.basis, observed_at: w.observedDate && w.observedTime ? toJapanDateTime(w.observedDate, w.observedTime) : null, note: w.note })) } catch { /* Leave incomplete observations for manual editing. */ }
  }
  return {
    constraints,
    ...(form.requestedStops.length ? { requested_stops: form.requestedStops.filter((s) => s.spotId && !isOmakase(s)).map((s) => ({ spot_id: s.spotId, requirement: s.requirement, locked_start_at: s.lockedStartTime ? dateTime(s.lockedStartTime) ?? null : null, reservation_confirmed: s.reservationConfirmed })) } : {}),
  }
}
