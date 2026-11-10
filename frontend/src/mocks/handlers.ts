import { http, HttpResponse } from 'msw/http'
import { env } from '../config/env'
import type { ErrorResponse, IntentInterpretRequest, ProposalRequest, SelectionRequest, TripCreateRequest } from '../api/types'
import { fixture } from './fixtures'
import { mockStore } from './runtime'
import { MockError } from './store'

const base = env.apiBaseUrl
const scenarios = ['normal', 'time_shift', 'place_shift', 'unknown', 'partial', 'no_feasible', 'conflict', 'intent_ambiguous']
if (!scenarios.includes(env.scenario)) throw new Error('Unknown mock scenario')
const error = (status: number, code: string) => HttpResponse.json({ error: { code, message: code, details: [], request_id: 'development-mock' } } satisfies ErrorResponse, { status })
const locale = (request: Request) => new URL(request.url).searchParams.get('locale') === 'en' ? 'en' : 'ja'
async function call(request: Request, operation: () => unknown | Promise<unknown>, status = 200) {
  if (request.headers.get('Authorization') !== 'Bearer development-mock-only') return error(401, 'UNAUTHENTICATED')
  try {
    return new HttpResponse(JSON.stringify(await operation()), { status, headers: { 'Content-Type': 'application/json' } })
  } catch (failure) {
    if (failure instanceof MockError) return error(failure.status, failure.code)
    if (failure instanceof SyntaxError) return error(422, 'VALIDATION_ERROR')
    return error(503, 'DEPENDENCY_UNAVAILABLE')
  }
}
export const handlers = [
  http.get(`${base}/api/v1/spots`, ({ request }) => call(request, () => {
    const query = new URL(request.url).searchParams
    if (query.get('area_id') !== 'demo-area' || query.get('visit_date') !== '2026-11-05') throw new MockError(422, 'DEMO_FIXED_INPUT_ONLY')
    return fixture(`spots.${locale(request)}.json`)
  })),
  http.get(`${base}/api/v1/trips/:tripId`, ({ request, params }) => call(request, () => mockStore.getTrip(String(params.tripId)))),
  http.get(`${base}/api/v1/trips/:tripId/proposals/:proposalId`, ({ request, params }) => call(request, () => mockStore.getProposal(String(params.tripId), String(params.proposalId)))),
  http.post(`${base}/api/v1/trips`, ({ request }) => call(request, async () => mockStore.createTrip(await request.json() as TripCreateRequest), 201)),
  http.post(`${base}/api/v1/trips/:tripId/proposals`, ({ request, params }) => call(request, async () => mockStore.createProposal(String(params.tripId), await request.json() as ProposalRequest), 201)),
  http.post(`${base}/api/v1/intent/interpret`, ({ request }) => call(request, async () => {
    const body = await request.json() as IntentInterpretRequest
    return fixture(`intent-ambiguous.${body.locale === 'en' ? 'en' : 'ja'}.json`)
  })),
  http.post(`${base}/api/v1/trips/:tripId/proposals/:proposalId/selection`, ({ request, params }) => call(request, async () => mockStore.select(String(params.tripId), String(params.proposalId), await request.json() as SelectionRequest))),
  // Every unmatched API stays in the mock. Never forward it to a real backend.
  http.all(`${base}/api/*`, () => error(503, 'DEPENDENCY_UNAVAILABLE')),
]
