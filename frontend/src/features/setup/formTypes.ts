//
import type { Locale,TripCreateRequest } from "../../api/types";

type Constraints = TripCreateRequest['constraints']
type RequestedStop = TripCreateRequest['requested_stops'][number]
type AvoidWindow = Constraints['avoid_windows'][number]
type WaitAssumption = Constraints['wait_assumptions'][number]

export type Interest=Constraints["interests"][number]

// 訪問先の「お任せします」。送信時は訪問先から外し、constraints.omakase_visits の件数としてbackendが場所を選ぶ。
export const OMAKASE_SPOT = '__omakase__'
// APIのrequested_stops（お任せ枠を含む）の最大件数。PRODUCT.md / API.mdの「最大6訪問」。
export const MAX_REQUESTED_STOPS = 6
// APIのconstraints.omakase_visitsの最大件数（お任せ枠）。
export const MAX_OMAKASE_VISITS = 3
export const isOmakase =(stop: { spotId: string }) => stop.spotId === OMAKASE_SPOT

//行きたい場所1つ
export interface RequestedStopFormValues{
    spotId:string

    //行くのは任意？必須？
    requirement:RequestedStop["requirement"]

//行く固定の時間
 // 未指定は空文字。指定する場合は日本時間のHH:mm。
  lockedStartTime: string

  // 本人が予約を確保しているか。アプリで予約する機能ではない。
  //その時間に確実に行く理由となる
  reservationConfirmed: boolean
}

// 避けたい時間帯1件分。
export interface AvoidWindowFormValues {
  id: string
  spotId: string
  startTime: string
  endTime: string
  basis: AvoidWindow['basis']
  evidenceIds: string[]//避けたい理由
  note: string //eg.混んでるから
}

// 計算に使う待ち時間の条件1件分。
export interface WaitAssumptionFormValues {
  spotId: string

  // 分単位の入力文字列。空文字と「0」は区別する。
  waitMinutes: string

  basis: WaitAssumption['basis']

  // 本人が確認した日時。旅行日とは別に持つ。
  // 確認日時がない場合は空文字。
  observedDate: string
  observedTime: string

  note: string
}


// 入力画面全体で保持する値。
export interface TripFormValues {
  // YYYY-MM-DD。時刻もすべて日本時間として扱う。
  date: string
  startTime: string
  endTime: string

  startSpotId: string
  endSpotId: string

  // 入力途中の空欄を扱うため、数値欄も文字列で保持する。
  maxWalkKm: string
  maxVisits: string
  partySize: string

  interests: Interest[]
  requestedStops: RequestedStopFormValues[]
  avoidWindows: AvoidWindowFormValues[]
  waitAssumptions: WaitAssumptionFormValues[]
}

// フォーム外から、API変換時に渡す情報。
export interface TripInputContext {
    //対象地域・現在の言語・最終確認の有無
  areaId: string
  locale: Locale
  intentConfirmed: boolean
}