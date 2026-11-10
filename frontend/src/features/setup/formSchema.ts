import { z } from 'zod'
import { MAX_OMAKASE_VISITS, MAX_REQUESTED_STOPS, OMAKASE_SPOT } from './formTypes'
import { toJapanDateTime } from '../../lib/japanTime'
import type { TripFormValues } from './formTypes'

/**
 * 行きたい場所の行数（お任せ枠を含む）が、有効な訪問数の上限を超えるときだけ件数を返す。
 * 入力中の案内と「条件を確認する」時の検査で同じ判定を使う。
 */
export function visitLimitExcess(count: number, maxVisits: string | undefined) {
  const text = (maxVisits ?? '').trim()
  if (!/^\d+$/.test(text)) return null
  const max = Number(text)
  return max >= 1 && max <= 6 && count > max ? { count, max } : null
}

/**
 * 行きたい場所が訪問数の上限より少ないとき、残りをお任せ枠で自動的に埋める件数。
 * 本人が選んだ行は変えず、送信時のomakase_visitsにだけ足す。APIの上限（お任せ最大3件）を超えない。
 */
export function autoOmakaseSlots(stops: { spotId: string }[] | undefined, maxVisits: string | undefined) {
  const text = (maxVisits ?? '').trim()
  const rows = stops ?? []
  if (!/^\d+$/.test(text) || !rows.length) return null
  const max = Number(text)
  if (max < 1 || max > 6 || rows.length >= max) return null
  const gap = max - rows.length
  const room = Math.max(0, MAX_OMAKASE_VISITS - rows.filter((stop) => stop.spotId === OMAKASE_SPOT).length)
  const added = Math.min(gap, room)
  return { gap, added, capped: added < gap }
}

// APIで使えるIDの形式。
const identifierSchema = z.string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/)

  const dateSchema = z.string().refine((value) => {
  try {
    toJapanDateTime(value, '00:00')
    return true
  } catch {
    return false
  }
}, {
  message: 'validation.invalidDate',
})


// 00:00〜23:59の時刻。
const timeSchema = z.string().regex(
  /^([01]\d|2[0-3]):[0-5]\d$/,
  { message: 'validation.invalidTime' },
)

// 数字として入力された文字列をチェックする。
// この段階では数値へ変換せず、文字列のまま返す。

function numericText(
  min: number,
  max: number,
  integer = false,
) {
  const pattern = integer
    ? /^\d+$/
    : /^\d+(?:\.\d+)?$/

  return z.string()
    .trim()
    .regex(pattern, {
      message: 'validation.invalidNumber',
    })
    .refine((value) => {
      const number = Number(value)

      return Number.isFinite(number)
        && number >= min
        && number <= max
        && (!integer || Number.isInteger(number))
    }, {
      message: 'validation.numberOutOfRange',
    })
}


export const tripFormBaseSchema: z.ZodType<TripFormValues> =
  z.object({
    date: dateSchema,
    startTime: timeSchema,
    endTime: timeSchema,

    startSpotId: identifierSchema,
    endSpotId: identifierSchema,

    // 歩行距離はkm。APIの100〜30000mに対応する。
    maxWalkKm: numericText(0.1, 30),

    maxVisits: numericText(1, 6, true),
    partySize: numericText(1, 10, true),

    interests: z.array(z.enum([
      'history',
      'photography',
      'nature',
      'food',
      'art',
      'quiet',
    ])).min(1).max(6),

    requestedStops: z.array(z.object({
      spotId: identifierSchema,

      requirement: z.enum([
        'must',
        'optional',
      ]),

      // 固定時刻は未指定でもよい。
      lockedStartTime: timeSchema.or(z.literal('')),

      reservationConfirmed: z.boolean(),
    }).strict()).min(1).max(MAX_REQUESTED_STOPS),

    avoidWindows: z.array(z.object({
      id: identifierSchema,
      spotId: identifierSchema,
      startTime: timeSchema,
      endTime: timeSchema,

      basis: z.enum([
        'user_preference',
        'curated_guidance',
        'demo_assumption',
      ]),

      evidenceIds: z.array(identifierSchema),
      note: z.string().max(1000),
    }).strict()).max(6),

    waitAssumptions: z.array(z.object({
      spotId: identifierSchema,

      // 入力単位は分。APIへの秒変換は別ファイルで行う。
      waitMinutes: numericText(0, 180),

      basis: z.enum([
        'user_observed',
        'user_assumption',
        'demo_assumption',
      ]),

      observedDate: dateSchema.or(z.literal('')),
      observedTime: timeSchema.or(z.literal('')),

      note: z.string().max(1000),
    }).strict()).max(2),
  }).strict()

  export const tripFormSchema = tripFormBaseSchema.superRefine(
  (values, ctx) => {
    // エラーを、画面上のどの入力欄に表示するか指定する。
    const addError = (
      path: (string | number)[],
      message: string,
    ) => {
      ctx.addIssue({
        code: 'custom',
        path,
        message,
      })
    }

    // ① 開始・終了時刻の前後関係
    const validTimeFormat =
      timeSchema.safeParse(values.startTime).success
      && timeSchema.safeParse(values.endTime).success

    const validTripWindow =
      validTimeFormat
      && values.startTime < values.endTime

    if (validTimeFormat && !validTripWindow) {
      addError(
        ['endTime'],
        'validation.endMustFollowStart',
      )
    }

    // ② 本人が設定した訪問数の上限
    if (visitLimitExcess(values.requestedStops.length, values.maxVisits)) {
      addError(
        ['requestedStops'],
        'validation.tooManyVisits',
      )
    }

    // ③ mustは最大3件
    const mustCount = values.requestedStops.filter(
      (stop) => stop.requirement === 'must',
    ).length

    if (mustCount > 3) {
      addError(
        ['requestedStops'],
        'validation.tooManyMustStops',
      )
    }

    // ④ 好みの重複
    if (
      new Set(values.interests).size
      !== values.interests.length
    ) {
      addError(
        ['interests'],
        'validation.duplicateInterests',
      )
    }

    const visitedSpotIds = new Set<string>()

    values.requestedStops.forEach((stop, index) => {
      // お任せ枠は場所が未定なので、重複・起終点の確認の対象外。
      if (stop.spotId === OMAKASE_SPOT) return
      // ⑤ 訪問先の重複
      if (visitedSpotIds.has(stop.spotId)) {
        addError(
          ['requestedStops', index, 'spotId'],
          'validation.duplicateSpot',
        )
      }

      visitedSpotIds.add(stop.spotId)

      // ⑥ 起終点と訪問先の重複
      if (
        stop.spotId !== ''
        && (
          stop.spotId === values.startSpotId
          || stop.spotId === values.endSpotId
        )
      ) {
        addError(
          ['requestedStops', index, 'spotId'],
          'validation.endpointCannotBeVisit',
        )
      }

      // ⑦ 固定時刻・予約確保済みならmust
      const requiresMust =
        stop.lockedStartTime !== ''
        || stop.reservationConfirmed

      if (requiresMust && stop.requirement !== 'must') {
        addError(
          ['requestedStops', index, 'requirement'],
          'validation.fixedVisitRequiresMust',
        )
      }

      // ⑧ 固定時刻が旅行時間内か
      if (
        validTripWindow
        && timeSchema.safeParse(stop.lockedStartTime).success
        && (
          stop.lockedStartTime < values.startTime
          || stop.lockedStartTime >= values.endTime
        )
      ) {
        addError(
          ['requestedStops', index, 'lockedStartTime'],
          'validation.fixedTimeOutsideTrip',
        )
      }
    })
        // ⑨ 避けたい時間帯のチェック
    const avoidWindowIds = new Set<string>()

    values.avoidWindows.forEach((window, index) => {
      const path = ['avoidWindows', index]

      // 時間帯を識別するIDの重複
      if (avoidWindowIds.has(window.id)) {
        addError(
          [...path, 'id'],
          'validation.duplicateAvoidWindowId',
        )
      }
      avoidWindowIds.add(window.id)

      // 対象は、今回の訪問候補に含まれる場所に限る。
      if (!visitedSpotIds.has(window.spotId)) {
        addError(
          [...path, 'spotId'],
          'validation.spotNotRequested',
        )
      }

      // 確認済みの案内を使う場合は根拠IDが必要。
      if (
        window.basis === 'curated_guidance'
        && window.evidenceIds.length === 0
      ) {
        addError(
          [...path, 'evidenceIds'],
          'validation.evidenceRequired',
        )
      }

      const validWindowFormat =
        timeSchema.safeParse(window.startTime).success
        && timeSchema.safeParse(window.endTime).success

      // 形式のエラーは基本schemaが担当する。
      if (!validWindowFormat) return

      if (window.startTime >= window.endTime) {
        addError(
          [...path, 'endTime'],
          'validation.endMustFollowStart',
        )
        return
      }

      // 旅行時間の外には設定できない。
      if (validTripWindow) {
        if (window.startTime < values.startTime) {
          addError(
            [...path, 'startTime'],
            'validation.avoidWindowOutsideTrip',
          )
        }

        if (window.endTime > values.endTime) {
          addError(
            [...path, 'endTime'],
            'validation.avoidWindowOutsideTrip',
          )
        }
      }

      // 同じ場所の時間帯は重複させない。
      // 今の項目より前にある時間帯だけを調べる。
      const overlaps = values.avoidWindows
        .slice(0, index)
        .some((other) => {
          const validOther =
            timeSchema.safeParse(other.startTime).success
            && timeSchema.safeParse(other.endTime).success
            && other.startTime < other.endTime

          return validOther
            && other.spotId === window.spotId
            && window.startTime < other.endTime
            && other.startTime < window.endTime
        })

      if (overlaps) {
        addError(
          [...path, 'startTime'],
          'validation.overlappingAvoidWindows',
        )
      }
    })

    // ⑩ 待ち時間のチェック
    const waitSpotIds = new Set<string>()

    values.waitAssumptions.forEach((wait, index) => {
      const path = ['waitAssumptions', index]

      // 同じ場所の待ち時間を二重に設定しない。
      if (waitSpotIds.has(wait.spotId)) {
        addError(
          [...path, 'spotId'],
          'validation.duplicateWaitSpot',
        )
      }
      waitSpotIds.add(wait.spotId)

      if (!visitedSpotIds.has(wait.spotId)) {
        addError(
          [...path, 'spotId'],
          'validation.spotNotRequested',
        )
      }

      // 本人確認値には、確認した日付と時刻が必要。
      // 仮定でも日時を入力するなら、両方を揃える。
      const requiresObservationTime =
        wait.basis === 'user_observed'
        || wait.observedDate !== ''
        || wait.observedTime !== ''

      if (requiresObservationTime) {
        if (wait.observedDate === '') {
          addError(
            [...path, 'observedDate'],
            'validation.observationDateRequired',
          )
        }

        if (wait.observedTime === '') {
          addError(
            [...path, 'observedTime'],
            'validation.observationTimeRequired',
          )
        }
      }
    })
  },
)