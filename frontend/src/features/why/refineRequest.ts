import type { ProposalRequest, Trip, TripCreateRequest } from '../../api/types'
import type { TripFormValues } from '../setup/formTypes'
import { formFromTrip } from '../setup/formHelpers'
import { toTripInput } from '../setup/toTripInput'

/** Proposals change only these allowed preferences, and never adopt or recreate a Trip. */
export function refineRequest(trip: Trip, values: TripFormValues, original: TripCreateRequest['constraints'], locale: 'ja' | 'en', requestId: string): ProposalRequest {
  const input = toTripInput(values, { areaId: original.area_id, locale, intentConfirmed: true })
  const initial = formFromTrip({ constraints: original, requested_stops: trip.requested_stops })
  return {
    client_request_id: requestId,
    base_version: trip.version,
    mode: trip.active_selection ? 'refine' : 'initial',
    constraint_overrides: {
      max_walk_meters: input.constraints.max_walk_meters,
      interests: input.constraints.interests,
      end_at: input.constraints.end_at,
      // Untouched arrays preserve exact timestamps/metadata from the API, including seconds.
      avoid_windows: JSON.stringify(values.avoidWindows) === JSON.stringify(initial.avoidWindows) ? original.avoid_windows : input.constraints.avoid_windows,
      wait_assumptions: JSON.stringify(values.waitAssumptions) === JSON.stringify(initial.waitAssumptions) ? original.wait_assumptions : input.constraints.wait_assumptions,
      locale,
    },
  }
}
