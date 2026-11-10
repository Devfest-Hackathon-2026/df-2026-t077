import { test, expect } from '@playwright/test'
import { ZodError } from 'zod'
import { autoOmakaseSlots, tripFormSchema } from '../../src/features/setup/formSchema'
import type {
  TripFormValues,
  TripInputContext,
} from '../../src/features/setup/formTypes'
import { toTripInput } from '../../src/features/setup/toTripInput'

// IDや条件は、このテスト専用の架空データ。
function createValidForm(): TripFormValues {
  return {
    date: '2026-11-05',
    startTime: '09:00',
    endTime: '17:00',

    startSpotId: 'station-start',
    endSpotId: 'station-end',

    maxWalkKm: '3.2',
    maxVisits: '3',
    partySize: '2',

    interests: ['history', 'food'],

    requestedStops: [
      {
        spotId: 'spot-history',
        requirement: 'must',
        lockedStartTime: '10:00',
        reservationConfirmed: false,
      },
      {
        spotId: 'spot-cafe',
        requirement: 'optional',
        lockedStartTime: '',
        reservationConfirmed: false,
      },
    ],

    avoidWindows: [
      {
        id: 'avoid-1',
        spotId: 'spot-history',
        startTime: '11:00',
        endTime: '12:00',
        basis: 'demo_assumption',
        evidenceIds: ['demo-evidence-1'],
        note: 'テスト用の仮定',
      },
    ],

    waitAssumptions: [
      {
        spotId: 'spot-cafe',
        waitMinutes: '15.5',
        basis: 'user_observed',
        observedDate: '2026-11-04',
        observedTime: '18:30',
        note: '前日に本人が確認した値',
      },
    ],
  }
}

const confirmedContext: TripInputContext = {
  areaId: 'test-area',
  locale: 'ja',
  intentConfirmed: true,
}

test('入力をAPI用の単位・項目名へ変換する', () => {
  const result = toTripInput(
    createValidForm(),
    confirmedContext,
  )

  expect(result.constraints).toMatchObject({
    area_id: 'test-area',
    timezone: 'Asia/Tokyo',
    start_at: '2026-11-05T09:00:00+09:00',
    end_at: '2026-11-05T17:00:00+09:00',
    max_walk_meters: 3200,
    max_visits: 3,
    party_size: 2,
    locale: 'ja',
  })

  expect(result.requested_stops[0]).toEqual({
    spot_id: 'spot-history',
    requirement: 'must',
    locked_start_at: '2026-11-05T10:00:00+09:00',
    reservation_confirmed: false,
  })

  expect(result.requested_stops[1].locked_start_at)
    .toBeNull()

  expect(result.intent_confirmed).toBe(true)

  // UUIDはPlanningAttemptが付けるので、ここには含めない。
  expect(result).not.toHaveProperty('client_request_id')
})

test('根拠・仮定・確認日時を失わず変換する', () => {
  const result = toTripInput(
    createValidForm(),
    confirmedContext,
  )

  expect(result.constraints.avoid_windows[0]).toEqual({
    id: 'avoid-1',
    spot_id: 'spot-history',
    starts_at: '2026-11-05T11:00:00+09:00',
    ends_at: '2026-11-05T12:00:00+09:00',
    basis: 'demo_assumption',
    evidence_ids: ['demo-evidence-1'],
    note: 'テスト用の仮定',
  })

  expect(result.constraints.wait_assumptions[0]).toEqual({
    spot_id: 'spot-cafe',
    wait_seconds: 930,
    basis: 'user_observed',
    observed_at: '2026-11-04T18:30:00+09:00',
    note: '前日に本人が確認した値',
  })
})

test('歩行距離の空欄を0として変換しない', () => {
  const form = createValidForm()
  form.maxWalkKm = ''

  expect(() => toTripInput(form, confirmedContext))
    .toThrow(ZodError)
})

test('本人の最終確認前は変換できない', () => {
  expect(() => toTripInput(createValidForm(), {
    ...confirmedContext,
    intentConfirmed: false,
  })).toThrow(ZodError)
})

test('日英切替で条件が変わらず、元の入力も変更しない', () => {
  const form = createValidForm()
  const before = structuredClone(form)

  const japanese = toTripInput(form, confirmedContext)
  const english = toTripInput(form, {
    ...confirmedContext,
    locale: 'en',
  })

  expect(english).toEqual({
    ...japanese,
    constraints: {
      ...japanese.constraints,
      locale: 'en',
    },
  })

  expect(form).toEqual(before)
})

test('日本時間の深夜を正しい日付とoffsetで変換する', () => {
  const form = createValidForm()
  form.startTime = '00:30'

  const result = toTripInput(form, confirmedContext)

  expect(result.constraints.start_at)
    .toBe('2026-11-05T00:30:00+09:00')

  // 日本の11月5日00:30は、UTCでは前日の15:30。
  expect(new Date(result.constraints.start_at).toISOString())
    .toBe('2026-11-04T15:30:00.000Z')
})
function expectFormError(
  form: TripFormValues,
  path: (string | number)[],
  message: string,
) {
  const result = tripFormSchema.safeParse(form)

  if (result.success) {
    throw new Error('不正な入力が検証を通過しました')
  }

  expect(result.error.issues).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        path,
        message,
      }),
    ]),
  )
}
test('終了が開始より前なら終了時刻にエラーを付ける', () => {
  const form = createValidForm()
  form.endTime = '08:00'

  expectFormError(
    form,
    ['endTime'],
    'validation.endMustFollowStart',
  )
})

test('訪問上限以内でもmustが4件あれば拒否する', () => {
  const form = createValidForm()
  form.maxVisits = '4'

  form.requestedStops = [
    'spot-history',
    'spot-cafe',
    'spot-extra-a',
    'spot-extra-b',
  ].map((spotId) => ({
    spotId,
    requirement: 'must',
    lockedStartTime: '',
    reservationConfirmed: false,
  }))

  expectFormError(
    form,
    ['requestedStops'],
    'validation.tooManyMustStops',
  )
})

test('同じ場所を二重に訪問候補へ入れたら拒否する', () => {
  const form = createValidForm()
  form.requestedStops.push({
    ...form.requestedStops[0],
  })

  expectFormError(
    form,
    ['requestedStops', 2, 'spotId'],
    'validation.duplicateSpot',
  )
})

test('固定時刻のある場所をoptionalにしたら拒否する', () => {
  const form = createValidForm()
  form.requestedStops[0].requirement = 'optional'

  expectFormError(
    form,
    ['requestedStops', 0, 'requirement'],
    'validation.fixedVisitRequiresMust',
  )
})

test('固定時刻が旅行終了時刻と同じなら拒否する', () => {
  const form = createValidForm()
  form.requestedStops[0].lockedStartTime = form.endTime

  expectFormError(
    form,
    ['requestedStops', 0, 'lockedStartTime'],
    'validation.fixedTimeOutsideTrip',
  )
})

test('同じ場所の回避時間帯が重なったら拒否する', () => {
  const form = createValidForm()

  form.avoidWindows.push({
    ...form.avoidWindows[0],
    id: 'avoid-2',
    startTime: '11:30',
    endTime: '12:30',
  })

  expectFormError(
    form,
    ['avoidWindows', 1, 'startTime'],
    'validation.overlappingAvoidWindows',
  )
})

test('本人確認の待ち時間に確認日がなければ拒否する', () => {
  const form = createValidForm()
  form.waitAssumptions[0].observedDate = ''

  expectFormError(
    form,
    ['waitAssumptions', 0, 'observedDate'],
    'validation.observationDateRequired',
  )
})
for (const [km, meters] of [
  ['0.1', 100],
  ['30', 30000],
] as const) {
  test(`歩行距離の境界値${km}kmを受け付ける`, () => {
    const form = createValidForm()
    form.maxWalkKm = km

    const result = toTripInput(form, confirmedContext)

    expect(result.constraints.max_walk_meters)
      .toBe(meters)
  })
}

for (const km of ['0.099', '30.001']) {
  test(`範囲外の歩行距離${km}kmを拒否する`, () => {
    const form = createValidForm()
    form.maxWalkKm = km

    expectFormError(
      form,
      ['maxWalkKm'],
      'validation.numberOutOfRange',
    )
  })
}
test('お任せ枠は訪問先として送らず、件数としてbackendへ渡す', () => {
  const form = createValidForm()
  form.requestedStops.push(
    { spotId: '__omakase__', requirement: 'optional', lockedStartTime: '', reservationConfirmed: false },
    { spotId: '__omakase__', requirement: 'optional', lockedStartTime: '', reservationConfirmed: false },
  )
  form.maxVisits = '4'
  const result = toTripInput(form, confirmedContext)
  expect(result.constraints.omakase_visits).toBe(2)
  expect(result.requested_stops.map((stop) => stop.spot_id)).not.toContain('__omakase__')
  expect(result.requested_stops).toHaveLength(createValidForm().requestedStops.length)
})

test('お任せ枠も訪問数の上限に数える', () => {
  const form = createValidForm()
  form.maxVisits = String(form.requestedStops.length)
  form.requestedStops.push({ spotId: '__omakase__', requirement: 'optional', lockedStartTime: '', reservationConfirmed: false })
  expect(() => toTripInput(form, confirmedContext)).toThrow(ZodError)
})

test('上限と同じ件数を選んでいれば、お任せ枠は0件として送る', () => {
  const form = createValidForm()
  form.maxVisits = String(form.requestedStops.length)
  expect(toTripInput(form, confirmedContext).constraints.omakase_visits).toBe(0)
})

test('上限に足りない分は、選んだ行を変えずにお任せ枠として送る', () => {
  const form = createValidForm()
  form.maxVisits = '4'
  const result = toTripInput(form, confirmedContext)
  expect(result.constraints.omakase_visits).toBe(2)
  expect(result.constraints.max_visits).toBe(4)
  expect(result.requested_stops.map((stop) => stop.spot_id)).toEqual(['spot-history', 'spot-cafe'])
})

test('自動のお任せ枠は、本人のお任せ枠と合わせてAPIの最大3件を超えない', () => {
  const form = createValidForm()
  form.maxVisits = '6'
  expect(toTripInput(form, confirmedContext).constraints.omakase_visits).toBe(3)
  form.requestedStops.push({ spotId: '__omakase__', requirement: 'optional', lockedStartTime: '', reservationConfirmed: false })
  expect(toTripInput(form, confirmedContext).constraints.omakase_visits).toBe(3)
  expect(autoOmakaseSlots(form.requestedStops, form.maxVisits)).toEqual({ gap: 3, added: 2, capped: true })
  form.requestedStops.push(
    { spotId: '__omakase__', requirement: 'optional', lockedStartTime: '', reservationConfirmed: false },
    { spotId: '__omakase__', requirement: 'optional', lockedStartTime: '', reservationConfirmed: false },
  )
  expect(autoOmakaseSlots(form.requestedStops, form.maxVisits)).toEqual({ gap: 1, added: 0, capped: true })
  expect(toTripInput(form, confirmedContext).constraints.omakase_visits).toBe(3)
})

test('上限が未入力・範囲外なら自動追加しない', () => {
  for (const unset of ['', '0', '7', '2.5']) expect(autoOmakaseSlots(createValidForm().requestedStops, unset)).toBeNull()
  expect(autoOmakaseSlots([], '4')).toBeNull()
})
