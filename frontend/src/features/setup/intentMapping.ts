import type { IntentDraft, Spot } from '../../api/types'
import { fromJapanDateTime } from '../../lib/japanTime'
import type { TripFormValues } from './formTypes'

export interface DraftSuggestion { field: keyof TripFormValues; patch: Partial<TripFormValues> }
/** Never overwrite existing explicit choices, including must, reservations and numbers. */
export function draftSuggestions(form: TripFormValues, draft: IntentDraft, spots: Spot[]): { suggestions: DraftSuggestion[]; skipped: boolean } {
  const suggestions: DraftSuggestion[] = []
  let skipped = false
  function offer<K extends keyof TripFormValues>(field: K, value: TripFormValues[K]) {
    const current = form[field]
    if ((Array.isArray(current) && current.length === 0) || current === '') suggestions.push({ field, patch: { [field]: value } })
    else if (JSON.stringify(current) !== JSON.stringify(value)) skipped = true
  }
  const hasSpot = (id: string) => spots.some((s) => s.id === id)
  const sameDayTime = (value: string) => { const parsed = fromJapanDateTime(value); if (parsed.date !== form.date) throw new Error('Different trip date'); return parsed.time }
  if (draft.interests?.length) offer('interests', [...draft.interests])
  if (draft.max_walk_meters !== null) {
    if (Number.isFinite(draft.max_walk_meters) && draft.max_walk_meters >= 100 && draft.max_walk_meters <= 30000) offer('maxWalkKm', String(draft.max_walk_meters / 1000))
    else skipped = true
  }
  if (draft.end_at) { try { offer('endTime', sameDayTime(draft.end_at)) } catch { skipped = true } }
  if (draft.requested_stops.length) {
    try {
      if (draft.requested_stops.some((s) => !hasSpot(s.spot_id))) throw new Error('Unknown spot')
      offer('requestedStops', draft.requested_stops.map((s) => ({ spotId: s.spot_id, requirement: s.requirement, lockedStartTime: s.locked_start_at ? sameDayTime(s.locked_start_at) : '', reservationConfirmed: s.reservation_confirmed })))
    } catch { skipped = true }
  }
  if (draft.avoid_windows.length) {
    try {
      if (draft.avoid_windows.some((w) => !hasSpot(w.spot_id))) throw new Error('Unknown spot')
      offer('avoidWindows', draft.avoid_windows.map((w) => ({ id: w.id, spotId: w.spot_id, startTime: sameDayTime(w.starts_at), endTime: sameDayTime(w.ends_at), basis: w.basis, evidenceIds: [...(w.evidence_ids ?? [])], note: w.note })))
    } catch { skipped = true }
  }
  if (draft.wait_assumptions.length) {
    try {
      if (draft.wait_assumptions.some((w) => !hasSpot(w.spot_id))) throw new Error('Unknown spot')
      offer('waitAssumptions', draft.wait_assumptions.map((w) => { const observed = w.observed_at ? fromJapanDateTime(w.observed_at) : null; return { spotId: w.spot_id, waitMinutes: String(w.wait_seconds / 60), basis: w.basis, observedDate: observed?.date ?? '', observedTime: observed?.time ?? '', note: w.note } }))
    } catch { skipped = true }
  }
  return { suggestions, skipped }
}

/** Recheck protection at apply time: edits made while the review was open also win. */
export function applySuggestions(form: TripFormValues, suggestions: DraftSuggestion[]): TripFormValues {
  const next = structuredClone(form)
  for (const suggestion of suggestions) {
    const current = next[suggestion.field]
    if ((Array.isArray(current) && current.length === 0) || current === '') Object.assign(next, structuredClone(suggestion.patch))
  }
  return next
}
