import { z } from 'zod'
import type { TripCreateRequest } from '../../api/types'
import { isOmakase } from './formTypes'
import {
  japanTripWindow,
  toJapanDateTime,
} from '../../lib/japanTime'
import type {
  TripFormValues,
  TripInputContext,
} from './formTypes'
import { autoOmakaseSlots, tripFormSchema } from './formSchema'

// UUIDを付ける前の、API用の入力型。
export type TripInput =
  Omit<TripCreateRequest, 'client_request_id'>

// フォーム外から受け取る情報もチェックする。
const tripInputContextSchema = z.object({
  areaId: z.string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/),

  locale: z.enum(['ja', 'en']),

  // 本人が最終確認した場合だけ変換を許可する。
  intentConfirmed: z.literal(true, {
    message: 'validation.confirmationRequired',
  }),
}).strict()

export function toTripInput(
  values: TripFormValues,
  context: TripInputContext,
): TripInput {
  // チェックに失敗した場合は、ここで例外になり、
  // API用データは返さない。
  const form = tripFormSchema.parse(values)
  const confirmedContext = tripInputContextSchema.parse(context)

  const tripWindow = japanTripWindow(
    form.date,
    form.startTime,
    form.endTime,
  )

  return {
    constraints: {
      area_id: confirmedContext.areaId,
      timezone: 'Asia/Tokyo',

      start_at: tripWindow.start_at,
      end_at: tripWindow.end_at,

      start_spot_id: form.startSpotId,
      end_spot_id: form.endSpotId,

      mode: 'walking',

      // km→m。1m未満の端数は四捨五入する。
      max_walk_meters: Math.round(
        Number(form.maxWalkKm) * 1000,
      ),

      max_visits: Number(form.maxVisits),
      party_size: Number(form.partySize),

      interests: [...form.interests],
      locale: confirmedContext.locale,

      // お任せ枠：backendが楽しみたい体験と条件に合う場所を選ぶ。
      // 訪問数の上限に足りない分は、確認画面で示したとおり自動のお任せ枠として加える。
      omakase_visits: form.requestedStops.filter(isOmakase).length
        + (autoOmakaseSlots(form.requestedStops, form.maxVisits)?.added ?? 0),

      avoid_windows: form.avoidWindows.map((window) => ({
        id: window.id,
        spot_id: window.spotId,

        starts_at: toJapanDateTime(
          form.date,
          window.startTime,
        ),
        ends_at: toJapanDateTime(
          form.date,
          window.endTime,
        ),

        basis: window.basis,
        evidence_ids: [...window.evidenceIds],
        note: window.note,
      })),

      wait_assumptions: form.waitAssumptions.map((wait) => ({
        spot_id: wait.spotId,

        // 分→秒。1秒未満の端数は四捨五入する。
        wait_seconds: Math.round(
          Number(wait.waitMinutes) * 60,
        ),

        basis: wait.basis,

        observed_at:
          wait.observedDate !== ''
          && wait.observedTime !== ''
            ? toJapanDateTime(
                wait.observedDate,
                wait.observedTime,
              )
            : null,

        note: wait.note,
      })),
    },

    requested_stops: form.requestedStops.filter((stop) => !isOmakase(stop)).map((stop) => ({
      spot_id: stop.spotId,
      requirement: stop.requirement,

      locked_start_at:
        stop.lockedStartTime !== ''
          ? toJapanDateTime(
              form.date,
              stop.lockedStartTime,
            )
          : null,

      reservation_confirmed: stop.reservationConfirmed,
    })),

    intent_confirmed: confirmedContext.intentConfirmed,
  }
}