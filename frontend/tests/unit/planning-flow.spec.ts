import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { components } from '../../src/api/schema'
import type { IntentDraft, TripCreateRequest, Spot } from '../../src/api/types'
import { formFromTrip, emptyTripForm, partialIntentInput } from '../../src/features/setup/formHelpers'
import { toTripInput } from '../../src/features/setup/toTripInput'
import { draftSuggestions, applySuggestions } from '../../src/features/setup/intentMapping'
import { apiFieldToForm } from '../../src/features/setup/apiFields'
import { refineRequest } from '../../src/features/why/refineRequest'
import { getAuthSession, setAuthIdentity, onIdentityChange } from '../../src/auth/session'

const load = <T>(name: string): T => JSON.parse(readFileSync(fileURLToPath(new URL(`../../../contracts/fixtures/v3/${name}`, import.meta.url)), 'utf8')) as T
const request = () => load<TripCreateRequest>('trip-create.request.json')
const emptyDraft = (): IntentDraft => ({ interests: null, requested_stops: [], max_walk_meters: null, end_at: null, avoid_windows: [], wait_assumptions: [], field_notes: [] })

test('existing API sample round-trips all preferences and evidence IDs', () => {
  const sample = request()
  const { client_request_id: id, ...expected } = sample
  expect(id).toBeTruthy()
  // With the limit equal to the places, nothing is auto-filled and the request round-trips exactly.
  const exact = { ...expected, constraints: { ...expected.constraints, max_visits: expected.requested_stops.length } }
  expect(toTripInput(formFromTrip({ ...sample, constraints: exact.constraints }), { areaId: sample.constraints.area_id, locale: 'ja', intentConfirmed: true })).toEqual(exact)
  // The shared sample has 2 places with a limit of 3, so the shortfall is sent as 1 "leave it to us" slot.
  const filled = toTripInput(formFromTrip(sample), { areaId: sample.constraints.area_id, locale: 'ja', intentConfirmed: true })
  expect(filled).toEqual({ ...expected, constraints: { ...expected.constraints, omakase_visits: 1 } })
})

test('intent input omits empty fields instead of inventing distances, times or visits', () => {
  const form = emptyTripForm()
  expect(partialIntentInput(form, 'area', 'en')).toEqual({ constraints: { area_id: 'area', locale: 'en' } })
  form.maxWalkKm = '0'
  expect(partialIntentInput(form, 'area', 'en').constraints).not.toHaveProperty('max_walk_meters')
})

test('AI cannot replace existing must/reservations/numbers and unknown places are excluded', () => {
  const form = formFromTrip(request())
  const before = structuredClone(form)
  const draft = emptyDraft()
  draft.max_walk_meters = 500
  draft.requested_stops = [{ spot_id: 'unknown', requirement: 'optional', reservation_confirmed: false }]
  const review = draftSuggestions(form, draft, [] as Spot[])
  expect(review.skipped).toBe(true)
  expect(review.suggestions).toEqual([])
  expect(form).toEqual(before)
})

test('only selected empty fields are applied, and later manual edits are protected', () => {
  const form = emptyTripForm()
  const draft = { ...emptyDraft(), max_walk_meters: 1500, interests: ['history'] as IntentDraft['interests'] }
  const review = draftSuggestions(form, draft, [])
  const selected = review.suggestions.filter((s) => s.field === 'maxWalkKm')
  expect(applySuggestions(form, selected).maxWalkKm).toBe('1.5')
  expect(applySuggestions(form, selected).interests).toEqual([])
  form.maxWalkKm = '2'
  expect(applySuggestions(form, selected).maxWalkKm).toBe('2')
})

test('refine uses current version/mode, preserves untouched timestamps, and explicit [] clears', () => {
  const sample = request()
  sample.constraints.wait_assumptions[0].observed_at = '2026-11-04T18:30:37+09:00'
  const trip = load<components['schemas']['TripResponse']>('trip.ja.json').trip
  trip.version = 7
  trip.active_selection = null
  trip.requested_stops = sample.requested_stops
  const form = formFromTrip(sample)
  const body = refineRequest(trip, form, sample.constraints, 'en', 'test-request')
  expect(body.mode).toBe('initial')
  expect(body.base_version).toBe(7)
  expect(body.constraint_overrides?.wait_assumptions?.[0].observed_at).toBe('2026-11-04T18:30:37+09:00')
  expect(body.constraint_overrides).not.toHaveProperty('requested_stops')
  form.avoidWindows = []
  form.waitAssumptions = []
  const cleared = refineRequest(trip, form, sample.constraints, 'ja', 'test-request')
  expect(cleared.constraint_overrides?.avoid_windows).toEqual([])
  expect(cleared.constraint_overrides?.wait_assumptions).toEqual([])
})

test('422 field mapping accepts known fields and rejects arbitrary or out-of-range paths', () => {
  expect(apiFieldToForm('constraints.max_walk_meters')).toBe('maxWalkKm')
  expect(apiFieldToForm('requested_stops[1].spot_id')).toBe('requestedStops.1.spotId')
  expect(apiFieldToForm('requested_stops.99.spot_id')).toBeNull()
  expect(apiFieldToForm('__proto__.polluted')).toBeNull()
  expect(apiFieldToForm('constructor')).toBeNull()
  expect(apiFieldToForm('requested_stops.0.constructor')).toBeNull()
})

test('an identity change clears old data before the new session is published', () => {
  setAuthIdentity('user-a')
  const events: string[] = []
  const unsubscribe = onIdentityChange(() => events.push(getAuthSession().uid ?? 'signed-out'))
  const revision = getAuthSession().revision
  setAuthIdentity('user-b')
  expect(events).toEqual(['user-a'])
  expect(getAuthSession().revision).toBe(revision + 1)
  setAuthIdentity('user-b')
  expect(events).toHaveLength(1)
  unsubscribe()
  setAuthIdentity(null)
})
