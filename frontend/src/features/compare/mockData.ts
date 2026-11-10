
// CFT-01の要件を満たす3案（Baseline / Time Shift / Place Shift）のモック
export const mockProposalResponse = {
  proposalId: "prop_2026_06_tokyo_01",
  tripId: "trip_12345",
  status: "success", // normal / time_shift / place_shift が揃っている状態
  baseline: {
    id: "plan_baseline",
    type: "baseline" as const,
    title: "元案（標準スケジュール）",
    description: "人気の定番スポットを王道の時間帯で巡る標準プランです。王道ならではの混雑が予想されます。",
    spotsCount: 4,
    totalWalkingDistanceKm: 4.2,
    returnMarginMinutes: 30,
    burdenOrNotice: "有名寺院周辺は11:00〜14:00に大変混雑します。",
    isMustMaintained: true,
    isDemoData: false,
    crowdRiskLevel: "HIGH" as const,
    changes: {
      fromSpotName: "浅草寺（本堂）",
      toSpotName: "浅草寺（本堂）",
      fromTime: "10:00",
      toTime: "11:30"
    }
  },
  alternatives: [
    {
      id: "plan_time_shifted",
      type: "time_shift" as const,
      title: "時間ずらし案",
      description: "訪問時間を早朝（8:00前）にずらすことで、mustの絶対行きたい場所をキープしつつピーク時の混雑を回避します。",
      spotsCount: 4,
      totalWalkingDistanceKm: 4.2,
      returnMarginMinutes: 60,
      burdenOrNotice: "早朝の門前町は店舗が閉まっている場合があります。",
      isMustMaintained: true,
      isDemoData: false,
      crowdRiskLevel: "LOW" as const,
      changes: {
        fromSpotName: "浅草寺（本堂）",
        toSpotName: "浅草寺（本堂・早朝参拝）",
        fromTime: "08:00",
        toTime: "09:30"
      }
    },
    {
      id: "plan_place_shifted",
      type: "location_shift" as const,
      title: "場所ずらし案（穴場追加）",
      description: "混雑する大寺院を少し離れた歴史ある静寂の古刹に一部置き換え、混雑ストレスを大幅に軽減します。",
      spotsCount: 5,
      totalWalkingDistanceKm: 5.1,
      returnMarginMinutes: 45,
      burdenOrNotice: "最寄り駅から徒歩10分の緩やかな坂道があります。",
      isMustMaintained: true, // mustスポットは保護されている
      isDemoData: false,
      crowdRiskLevel: "LOW" as const,
      changes: {
        fromSpotName: "仲見世通り・浅草寺",
        toSpotName: "今戸神社（隠れた名所・体験型）",
        fromTime: "10:00",
        toTime: "11:45"
      }
    }
  ]
};