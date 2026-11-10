import { client, unwrap } from './client'
import type { PlanningApi } from './attempts'
import type { IntentInterpretRequest, ProposalRequest } from './types'

export const planningApi: PlanningApi = {
  createTrip: (body) => unwrap(client.POST('/api/v1/trips', { body })),
  generateProposal: (tripId, body) => unwrap(client.POST('/api/v1/trips/{trip_id}/proposals', { params: { path: { trip_id: tripId } }, body })),
}

export const interpretWishes = (body: IntentInterpretRequest) => unwrap(client.POST('/api/v1/intent/interpret', { body }))
export const generateProposal = (tripId: string, body: ProposalRequest) => planningApi.generateProposal(tripId, body)
