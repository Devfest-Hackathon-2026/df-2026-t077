import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PlanningAttempt } from '../../src/api/attempts'
import { singleFlight } from '../../src/lib/singleFlight'
import { fromJapanDateTime, japanTripWindow, toJapanDateTime } from '../../src/lib/japanTime'
import { MockTripStore } from '../../src/mocks/store'
import type { ProposalRequest, TripCreateRequest } from '../../src/api/types'

const load = <T>(name: string): T => JSON.parse(readFileSync(fileURLToPath(new URL(`../../../contracts/fixtures/v3/${name}`, import.meta.url)), 'utf8')) as T
function memory() {
  const data = new Map<string, string>()
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) } }
}

test('Japan form timestamps and invalid dates are independent of host timezone', () => {
  expect(toJapanDateTime('2026-11-05', '09:00')).toBe('2026-11-05T09:00:00+09:00')
  expect(fromJapanDateTime('2026-11-04T23:30:00Z')).toEqual({ date: '2026-11-05', time: '08:30' })
  expect(() => toJapanDateTime('2026-02-30', '09:00')).toThrow()
  expect(() => toJapanDateTime('2026-11-05', '24:00')).toThrow()
  expect(() => fromJapanDateTime('2026-11-05T09:00:00')).toThrow()
  expect(() => japanTripWindow('2026-11-05', '12:00', '09:00')).toThrow()
})

test('failed anonymous sign-in can retry while simultaneous calls share one operation', async () => {
  let calls = 0
  const operation = singleFlight(async () => { calls++; if (calls === 1) throw new Error('offline'); return 'signed-in' })
  const first = operation()
  expect(operation()).toBe(first)
  await expect(first).rejects.toThrow('offline')
  await expect(operation()).resolves.toBe('signed-in')
  expect(calls).toBe(2)
})

test('generation retry keeps trip and request UUID, even after a lost response', async () => {
  const store = new MockTripStore(load, memory())
  const input = store.sampleRequest('ja')
  const attempt = new PlanningAttempt(input)
  let creates = 0
  const generatedIds: string[] = []
  const api = {
    createTrip: async (body: TripCreateRequest) => { creates++; return store.createTrip(body) },
    generateProposal: async (id: string, body: ProposalRequest) => {
      generatedIds.push(body.client_request_id)
      const result = store.createProposal(id, body)
      if (generatedIds.length === 1) throw new Error('response lost after save')
      return result
    },
  }
  await expect(attempt.run(api)).rejects.toThrow('response lost')
  const result = await attempt.run(api)
  expect(creates).toBe(1)
  expect(generatedIds[0]).toBe(generatedIds[1])
  expect(result.proposal.trip_id).toBe(result.trip.trip.id)
})

test('mock selection replay, payload conflict, old version and reload preserve adopted plan', () => {
  const storage = memory()
  const store = new MockTripStore(load, storage)
  const trip = store.createTrip(store.sampleRequest('ja')).trip
  const request: ProposalRequest = { client_request_id: crypto.randomUUID(), base_version: 1, mode: 'initial', constraint_overrides: {} }
  const proposal = store.createProposal(trip.id, request)
  const body = { plan_id: proposal.alternatives[0].id, expected_version: 1, idempotency_key: crypto.randomUUID() }
  const result = store.select(trip.id, proposal.id, body)
  expect(store.select(trip.id, proposal.id, body)).toEqual(result)
  expect(result.trip.version).toBe(2)
  expect(() => store.select(trip.id, proposal.id, { ...body, plan_id: proposal.baseline!.id })).toThrow('IDEMPOTENCY_KEY_REUSED')
  expect(() => store.select(trip.id, proposal.id, { ...body, idempotency_key: crypto.randomUUID() })).toThrow('VERSION_CONFLICT')
  const reloaded = new MockTripStore(load, storage)
  expect(reloaded.getTrip(trip.id).active_plan?.id).toBe(body.plan_id)
  expect(reloaded.getTrip(trip.id).trip.version).toBe(2)
})

test('fixed-input mock rejects arbitrary trips and unconfirmed submission', () => {
  const store = new MockTripStore(load, memory())
  const sample = store.sampleRequest('en')
  sample.constraints.max_walk_meters += 1
  expect(() => store.createTrip(sample)).toThrow('DEMO_FIXED_INPUT_ONLY')
  const unconfirmed = { ...store.sampleRequest('en'), intent_confirmed: false } as unknown as TripCreateRequest
  expect(() => store.createTrip(unconfirmed)).toThrow('VALIDATION_ERROR')
})

test('infeasible scenario cannot adopt a made-up plan', () => {
  const store = new MockTripStore(load, memory(), 'no_feasible')
  const trip = store.createTrip(store.sampleRequest('ja')).trip
  const proposal = store.createProposal(trip.id, { client_request_id: crypto.randomUUID(), base_version: 1, mode: 'initial', constraint_overrides: {} })
  expect(proposal.baseline).toBeNull()
  expect(() => store.select(trip.id, proposal.id, { plan_id: 'invented', expected_version: 1, idempotency_key: crypto.randomUUID() })).toThrow('NOT_FOUND')
  expect(store.getTrip(trip.id).active_plan).toBeNull()
})

test('visit limit check matches the review rule and ignores an incomplete limit', async () => {
  const { visitLimitExcess } = await import('../../src/features/setup/formSchema')
  expect(visitLimitExcess(5, '4')).toEqual({ count: 5, max: 4 })
  expect(visitLimitExcess(4, '4')).toBeNull()
  expect(visitLimitExcess(2, '4')).toBeNull()
  expect(visitLimitExcess(3, ' 2 ')).toEqual({ count: 3, max: 2 })
  for (const unset of ['', '0', '7', '2.5', 'x', undefined]) expect(visitLimitExcess(6, unset)).toBeNull()
})
