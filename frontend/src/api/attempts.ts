import type { components } from './schema'
import type { ProposalBundle, ProposalRequest, TripCreateRequest } from './types'

type TripResponse = components['schemas']['TripResponse']
export interface PlanningApi {
  createTrip(body: TripCreateRequest): Promise<TripResponse>
  generateProposal(tripId: string, body: ProposalRequest): Promise<ProposalBundle>
}

/** One confirmed user submission. Retry this object; create another for new input. */
export class PlanningAttempt {
  private readonly createBody: TripCreateRequest
  private readonly proposalId: string
  private trip?: TripResponse
  private proposal?: ProposalBundle
  private pending?: Promise<{ trip: TripResponse; proposal: ProposalBundle }>

  constructor(input: Omit<TripCreateRequest, 'client_request_id'>, uuid = () => crypto.randomUUID()) {
    this.createBody = { ...structuredClone(input), client_request_id: uuid() }
    this.proposalId = uuid()
  }

  run(api: PlanningApi): Promise<{ trip: TripResponse; proposal: ProposalBundle }> {
    if (this.pending) return this.pending
    this.pending = this.execute(api).finally(() => { this.pending = undefined })
    return this.pending
  }

  private async execute(api: PlanningApi) {
    this.trip ??= await api.createTrip(structuredClone(this.createBody))
    this.proposal ??= await api.generateProposal(this.trip.trip.id, {
      client_request_id: this.proposalId, base_version: this.trip.trip.version,
      mode: 'initial', constraint_overrides: {},
    })
    return { trip: structuredClone(this.trip), proposal: structuredClone(this.proposal) }
  }
}
