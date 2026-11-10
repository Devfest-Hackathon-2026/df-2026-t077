/** Browser-only fake server. Storage is isolated to a labelled development mock. */
import type { components } from '../api/schema'
import type { Locale, ProposalBundle, ProposalRequest, SelectionRequest, TripCreateRequest } from '../api/types'

type TripResponse = components['schemas']['TripResponse']
type SelectionResponse = components['schemas']['SelectionResponse']
type LoadFixture = <T>(name: string) => T
export interface MockStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
interface Snapshot {
  version: 1
  trips: Record<string, TripResponse>
  proposals: Record<string, ProposalBundle>
  replay: Record<string, { payload: string; response: unknown }>
}
export class MockError extends Error {
  constructor(public status: number, public code: string) { super(code) }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
  }
  return JSON.stringify(value)
}
function keys(value: object, allowed: string[]) {
  if (Object.keys(value).some((name) => !allowed.includes(name))) throw new MockError(422, 'VALIDATION_ERROR')
}
function uuid(value: string) {
  if (typeof value !== 'string' || !/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(value)) throw new MockError(422, 'VALIDATION_ERROR')
}

export class MockTripStore {
  private state: Snapshot
  private readonly storageKey: string
  constructor(private load: LoadFixture, private storage: MockStorage, private scenario = 'normal') {
    this.storageKey = `zurashitabi:development-mock:v1:${scenario}`
    this.state = { version: 1, trips: {}, proposals: {}, replay: {} }
    const saved = storage.getItem(this.storageKey)
    if (saved) {
      try {
        const value = JSON.parse(saved) as Snapshot
        if (value.version === 1 && value.trips && value.proposals && value.replay) this.state = value
      } catch { /* An invalid development snapshot is replaced by fresh sample state. */ }
    }
    for (const locale of ['ja', 'en'] as const) {
      const id = locale === 'en' ? 'demo-trip-en' : 'demo-trip'
      if (!this.state.trips[id]) {
        const trip = load<TripResponse>(`trip.${locale}.json`)
        trip.trip.id = id
        trip.trip.constraints = this.sampleRequest(locale).constraints
        this.state.trips[id] = trip
        const bundle = this.sampleProposal(locale)
        bundle.trip_id = id
        this.state.proposals[`${id}/demo-proposal`] = bundle
      }
    }
    this.save()
  }

  private save() { this.storage.setItem(this.storageKey, JSON.stringify(this.state)) }
  private sampleProposal(locale: Locale) {
    const scenario = ['conflict', 'intent_ambiguous'].includes(this.scenario) ? 'normal' : this.scenario
    const bundle = this.load<ProposalBundle>(`proposal-${scenario}.${locale}.json`)
    // The shared fixture has 2 places with a limit of 3. The form now fills a shortfall with
    // "leave it to us" slots, which this fixed sample cannot plan, so the dev sample uses a
    // limit equal to its places. Every fixture plan visits those 2 places, so no plan changes.
    const request = this.load<TripCreateRequest>('trip-create.request.json')
    bundle.effective_constraints.max_visits = request.requested_stops.length + (request.constraints.omakase_visits ?? 0)
    return bundle
  }
  sampleRequest(locale: Locale): TripCreateRequest {
    const body = this.load<TripCreateRequest>('trip-create.request.json')
    body.constraints = this.sampleProposal(locale).effective_constraints
    return body
  }
  private replay<T>(scope: string, key: string, body: object): T | undefined {
    const previous = this.state.replay[`${scope}/${key}`]
    if (!previous) return undefined
    if (previous.payload !== canonical(body)) throw new MockError(409, 'IDEMPOTENCY_KEY_REUSED')
    return structuredClone(previous.response) as T
  }
  private remember<T>(scope: string, key: string, body: object, result: T): T {
    this.state.replay[`${scope}/${key}`] = { payload: canonical(body), response: structuredClone(result) }
    this.save()
    return structuredClone(result)
  }

  getTrip(id: string): TripResponse {
    const result = this.state.trips[id]
    if (!result) throw new MockError(404, 'NOT_FOUND')
    return structuredClone(result)
  }
  getProposal(tripId: string, proposalId: string): ProposalBundle {
    this.getTrip(tripId)
    const result = this.state.proposals[`${tripId}/${proposalId}`]
    if (!result) throw new MockError(404, 'NOT_FOUND')
    return structuredClone(result)
  }

  createTrip(body: TripCreateRequest): TripResponse {
    uuid(body.client_request_id)
    const previous = this.replay<TripResponse>('create', body.client_request_id, body)
    if (previous) return previous
    keys(body, ['client_request_id', 'constraints', 'requested_stops', 'intent_confirmed'])
    if (!['ja', 'en'].includes(body.constraints?.locale) || body.intent_confirmed !== true) throw new MockError(422, 'VALIDATION_ERROR')
    const expected = this.sampleRequest(body.constraints.locale)
    if (canonical(body.constraints) !== canonical(expected.constraints) || canonical(body.requested_stops) !== canonical(expected.requested_stops)) {
      throw new MockError(422, 'DEMO_FIXED_INPUT_ONLY')
    }
    const result = this.load<TripResponse>(`trip.${body.constraints.locale}.json`)
    result.trip.id = `trip-${crypto.randomUUID()}`
    result.trip.constraints = structuredClone(body.constraints)
    result.trip.requested_stops = structuredClone(body.requested_stops)
    result.trip.created_at = result.trip.updated_at = new Date().toISOString()
    this.state.trips[result.trip.id] = result
    return this.remember('create', body.client_request_id, body, result)
  }

  createProposal(tripId: string, body: ProposalRequest): ProposalBundle {
    this.getTrip(tripId)
    uuid(body.client_request_id)
    const previous = this.replay<ProposalBundle>(`${tripId}/generate`, body.client_request_id, body)
    if (previous) return previous
    keys(body, ['client_request_id', 'base_version', 'mode', 'constraint_overrides'])
    const trip = this.state.trips[tripId].trip
    if (body.base_version !== trip.version) throw new MockError(409, 'VERSION_CONFLICT')
    if ((body.mode === 'initial' && trip.active_selection) || (body.mode === 'refine' && !trip.active_selection) || !['initial', 'refine'].includes(body.mode)) throw new MockError(409, 'MODE_CONFLICT')
    const overrides = body.constraint_overrides || {}
    if (Object.entries(overrides).some(([key, value]) => value !== null && key !== 'locale')) throw new MockError(422, 'DEMO_FIXED_INPUT_ONLY')
    const locale = overrides.locale ?? trip.constraints.locale
    if (!['ja', 'en'].includes(locale)) throw new MockError(422, 'VALIDATION_ERROR')
    const result = this.sampleProposal(locale)
    result.id = `proposal-${crypto.randomUUID()}`
    result.trip_id = tripId
    result.base_version = trip.version
    result.request = structuredClone(body)
    result.created_at = new Date().toISOString()
    this.state.proposals[`${tripId}/${result.id}`] = result
    return this.remember(`${tripId}/generate`, body.client_request_id, body, result)
  }

  select(tripId: string, proposalId: string, body: SelectionRequest): SelectionResponse {
    this.getTrip(tripId)
    uuid(body.idempotency_key)
    const replayBody = { proposal_id: proposalId, ...body }
    // A successful replay wins over the now-incremented version check.
    const previous = this.replay<SelectionResponse>(`${tripId}/select`, body.idempotency_key, replayBody)
    if (previous) return previous
    keys(body, ['plan_id', 'expected_version', 'idempotency_key'])
    const proposal = this.getProposal(tripId, proposalId)
    const trip = this.state.trips[tripId].trip
    if (this.scenario === 'conflict' || body.expected_version !== trip.version || proposal.base_version !== trip.version) throw new MockError(409, 'VERSION_CONFLICT')
    const plan = [proposal.baseline, ...proposal.alternatives].find((item) => item?.id === body.plan_id)
    if (!plan) throw new MockError(404, 'NOT_FOUND')
    const selected = structuredClone(trip)
    selected.version += 1
    selected.constraints = structuredClone(proposal.effective_constraints)
    selected.updated_at = new Date().toISOString()
    selected.active_selection = { proposal_id: proposalId, plan_id: body.plan_id, selected_at: selected.updated_at }
    const result: SelectionResponse = { trip: selected, active_plan: structuredClone(plan), evidence: structuredClone(proposal.evidence) }
    this.state.trips[tripId] = result
    return this.remember(`${tripId}/select`, body.idempotency_key, replayBody, result)
  }
}
