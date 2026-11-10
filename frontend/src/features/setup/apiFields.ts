import type { FieldPath } from 'react-hook-form'
import type { TripFormValues } from './formTypes'

/** Whitelist server field paths; never use an arbitrary server string as a form path. */
export function apiFieldToForm(field: string | null | undefined): FieldPath<TripFormValues> | null {
  if (!field) return null
  const path = field.replace(/^body\./, '').replace(/\[(\d+)\]/g, '.$1')
  const simple: Record<string, FieldPath<TripFormValues>> = { 'constraints.start_at': 'startTime', 'constraints.end_at': 'endTime', 'constraints.start_spot_id': 'startSpotId', 'constraints.end_spot_id': 'endSpotId', 'constraints.max_walk_meters': 'maxWalkKm', 'constraints.max_visits': 'maxVisits', 'constraints.party_size': 'partySize', 'constraints.interests': 'interests' }
  if (Object.hasOwn(simple, path)) return simple[path]
  const match = /^(requested_stops|constraints\.avoid_windows|constraints\.wait_assumptions)\.(\d+)\.(\w+)$/.exec(path)
  if (!match) return null
  const index = Number(match[2])
  const groups: Record<string, { name: string; fields: Record<string, string> }> = {
    requested_stops: { name: 'requestedStops', fields: { spot_id: 'spotId', requirement: 'requirement', locked_start_at: 'lockedStartTime', reservation_confirmed: 'reservationConfirmed' } },
    'constraints.avoid_windows': { name: 'avoidWindows', fields: { spot_id: 'spotId', starts_at: 'startTime', ends_at: 'endTime', basis: 'basis', note: 'note', id: 'id', evidence_ids: 'evidenceIds' } },
    'constraints.wait_assumptions': { name: 'waitAssumptions', fields: { spot_id: 'spotId', wait_seconds: 'waitMinutes', observed_at: 'observedDate', basis: 'basis', note: 'note' } },
  }
  const group = groups[match[1]]
  const name = Object.hasOwn(group.fields, match[3]) ? group.fields[match[3]] : null
  return name && index < 6 ? `${group.name}.${index}.${name}` as FieldPath<TripFormValues> : null
}
