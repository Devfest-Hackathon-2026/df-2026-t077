import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { client, unwrap } from './client'
import type { IntentInterpretRequest, ProposalRequest, SelectionRequest, TripCreateRequest } from './types'
import { useLocale } from '../i18n/useLocale'
import { toJapanDateTime } from '../lib/japanTime'

export function dateForSpots(date: string): boolean {
  try { toJapanDateTime(date, '00:00'); return true } catch { return false }
}

export function useSpots(areaId: string, date: string) {
  const { locale } = useLocale()
  return useQuery({ queryKey: ['spots', areaId, date, locale], enabled: !!areaId && dateForSpots(date), queryFn: ({ signal }) => unwrap(client.GET('/api/v1/spots', { params: { query: { area_id: areaId, visit_date: date, locale } }, signal })) })
}
export function useInterpretIntent() {
  return useMutation({ mutationFn: (body: IntentInterpretRequest) => unwrap(client.POST('/api/v1/intent/interpret', { body })) })
}
export function useCreateTrip() {
  return useMutation({ mutationFn: (body: TripCreateRequest) => unwrap(client.POST('/api/v1/trips', { body })) })
}
export function useTrip(tripId: string) {
  return useQuery({ queryKey: ['trip', tripId], enabled: !!tripId, queryFn: ({ signal }) => unwrap(client.GET('/api/v1/trips/{trip_id}', { params: { path: { trip_id: tripId } }, signal })) })
}
export function useGenerateProposal(tripId: string) {
  return useMutation({ mutationFn: (body: ProposalRequest) => unwrap(client.POST('/api/v1/trips/{trip_id}/proposals', { params: { path: { trip_id: tripId } }, body })) })
}
export function useProposal(tripId: string, proposalId: string) {
  return useQuery({ queryKey: ['proposal', tripId, proposalId], enabled: !!tripId && !!proposalId, queryFn: ({ signal }) => unwrap(client.GET('/api/v1/trips/{trip_id}/proposals/{proposal_id}', { params: { path: { trip_id: tripId, proposal_id: proposalId } }, signal })) })
}
export function useSelectPlan(tripId: string, proposalId: string) {
  const query = useQueryClient()
  return useMutation({ mutationFn: (body: SelectionRequest) => unwrap(client.POST('/api/v1/trips/{trip_id}/proposals/{proposal_id}/selection', { params: { path: { trip_id: tripId, proposal_id: proposalId } }, body })), onSuccess: () => query.invalidateQueries({ queryKey: ['trip', tripId] }) })
}
