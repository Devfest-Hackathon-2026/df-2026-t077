// Deterministic planner messages (main 95d838a). Keep both languages together.
// Display localization only; the API response and stored facts remain unchanged.
export const plannerTextPairs = [
  [
    "営業時間内に滞在を完了できません。",
    "The visit cannot be completed within opening hours."
  ],
  [
    "訪問順、開始時刻、または訪問先を変更してください。",
    "Change the visit order, start time, or requested spot."
  ],
  [
    "確認した訪問順と必須条件を保つ元案です。",
    "This baseline preserves the confirmed order and required conditions."
  ],
  [
    "「体験が合えば別の場所でもよい」訪問先と入れ替えられる、楽しみたい体験に合う候補が、営業時間・終了時刻・歩行上限などの条件の範囲で見つからず、場所案は作れませんでした。",
    "No candidate matching the experiences you enjoy could replace a flexible visit within the opening hours, end time and walking limit, so there is no place-shift option."
  ],
  [
    "固定時刻を維持した旅程を作れません。",
    "The itinerary cannot preserve the locked start time."
  ],
  [
    "固定時刻、営業時間、移動条件を確認してください。",
    "Review the locked time, opening hours, and travel conditions."
  ],
  [
    "待ち時間が未入力の訪問先は計算に含めていません。空いているという意味ではありません。",
    "Unspecified waits are not included; this does not mean those spots are empty."
  ],
  [
    "訪問先を保ち、順序または開始時刻を変更した時間案です。",
    "This time option keeps every visit while changing order or start time."
  ],
  [
    "mustを保ち、optionalを希望する体験に関係する候補へ交換した場所案です。",
    "This place option keeps every must and replaces an optional with a relevant experience."
  ],
  [
    "元のoptionalの体験は失われ、移動と営業時間の条件も変わります。",
    "The original optional experience is lost, and travel and opening constraints change."
  ],
  [
    "元の順序は不成立でしたが、訪問先とmustを保った順序変更で成立する時間案です。",
    "The original order was infeasible, but this reordered time option keeps every visit and must."
  ],
  [
    "明示なし",
    "none stated"
  ],
  [
    "営業時間・終了時刻・歩行上限などの条件の範囲で、避けたい時間帯との重なりを減らせる時刻や順序が見つからず、時間案は作れませんでした。",
    "No start time or visit order within the opening hours, end time and walking limit reduces the overlap with the times you prefer to avoid, so there is no time-shift option."
  ],
  [
    "すべての訪問先が「必ずこの場所に行く」のため、場所案（訪問先を入れ替える案）は作れません。1か所以上を「体験が合えば別の場所でもよい」にすると提案できます。",
    "Every visit is marked \"I must visit this place\", so there is no place-shift option (swapping a visit). Mark at least one visit \"A similar experience elsewhere is welcome\" to get one."
  ],
  [
    "提案の基準versionが旅行データと一致しません。",
    "The proposal base version does not match the trip."
  ],
  [
    "旅行データを再取得してから再提案してください。",
    "Reload the trip before generating another proposal."
  ],
  [
    "訪問件数が現在の上限と一致しません。",
    "The requested visit count conflicts with the current limit."
  ],
  [
    "訪問先と上限を確認してください。",
    "Review the requested visits and visit limit."
  ],
  [
    "訪問先の重複またはmust件数が不正です。",
    "Requested visits are duplicated or contain too many required stops."
  ],
  [
    "確認済みの訪問条件を修正してください。",
    "Correct the confirmed visit requirements."
  ],
  [
    "起終点を訪問先として重複指定できません。",
    "Origin and destination cannot also be requested visits."
  ],
  [
    "起終点または訪問先を変更してください。",
    "Change the endpoints or requested visits."
  ],
  [
    "待ち時間または回避時間帯が訪問先以外を参照しています。",
    "A wait assumption or avoid window refers to a non-visit spot."
  ],
  [
    "条件を現在の訪問先に合わせてください。",
    "Align the preferences with the current requested visits."
  ],
  [
    "訪問先を保ったまま、入力された経路条件で移動負担を減らす時間案です。",
    "This time option keeps every visit and reduces travel burden under the supplied route assumptions."
  ],
  [
    "避けたい時間帯の指定がなく、訪問順を変えても移動の負担が減らないため、時間案は作れませんでした。詳細条件で避けたい時間帯を指定すると提案できます。",
    "No time to avoid was given and no other visit order reduces travel, so there is no time-shift option. Add a time you prefer to avoid under Details to get one."
  ],
  [
    "元案はすでに避けたい時間帯と重なっていないため、時間案は作りませんでした。",
    "The original plan already stays out of the times you prefer to avoid, so no time-shift option was needed."
  ],
  [
    "お任せ枠に合う場所が、楽しみたい体験と条件の範囲で見つかりませんでした。",
    "No place for your \"leave it to us\" slot matches your interests within the conditions."
  ],
  [
    "楽しみたい体験・終了時刻・歩行上限を変えるか、行きたい場所を選んでください。",
    "Change your interests, end time or walking limit, or choose a place yourself."
  ],
  [
    "旅程生成に必要な施設情報がありません。",
    "Required spot information is unavailable to the planner."
  ],
  [
    "対象エリアの施設情報を確認してください。",
    "Confirm the spot data for the selected area."
  ],
  [
    "施設のエリアまたは根拠参照が入力条件と一致しません。",
    "The spot area or evidence references conflict with the input."
  ],
  [
    "施設データと根拠を確認してください。",
    "Review the spot data and evidence."
  ],
  [
    "選択日の営業が確認できない施設です。",
    "This spot is closed on the selected date."
  ],
  [
    "別の施設または日付を選択してください。",
    "Choose another spot or date."
  ],
  [
    "予約要否または予約確保を確認できません。",
    "Reservation requirements or confirmation are unresolved."
  ],
  [
    "予約条件を確認するか訪問先を変更してください。",
    "Confirm the reservation or change the visit."
  ],
  [
    "必要な徒歩経路を確認できません。",
    "A required walking route is unavailable."
  ],
  [
    "経路情報を確認してから再提案してください。",
    "Confirm route data before generating again."
  ],
  [
    "確認した訪問順を維持した元案です。",
    "This baseline keeps the confirmed visit order."
  ],
  [
    "帰路を含む歩行距離が上限を超えます。",
    "Walking distance including the return leg exceeds the limit."
  ],
  [
    "歩行上限または訪問先を変更してください。",
    "Change the walking limit or requested visits."
  ],
  [
    "帰路を含めると終了時刻を超えます。",
    "The itinerary finishes after the time limit when the return is included."
  ],
  [
    "終了時刻、訪問先、または滞在条件を変更してください。",
    "Change the end time, visits, or stay conditions."
  ],
  [
    "訪問先が1か所で、避けたい時間帯の指定もないため、時間案（順序や時刻を変える案）は作れません。詳細条件で避けたい時間帯を指定すると提案できます。",
    "With one visit and no time to avoid, there is no time-shift option (changing order or start times). Add a time you prefer to avoid under Details to get one."
  ],
  [
    "探索上限内で検証できた案だけを返しました。",
    "Only candidates validated within the search limit are returned."
  ],
  [
    "営業時間が未確認の施設です。",
    "Opening information for this spot is unconfirmed."
  ],
  [
    "営業時間を確認してから再提案してください。",
    "Confirm opening information before generating again."
  ],
  [
    "経路の根拠参照を解決できません。",
    "Route evidence references cannot be resolved."
  ],
  [
    "経路情報と根拠を確認してください。",
    "Review the route data and evidence."
  ],
  [
    "元の訪問順を保つ架空サンプルです。",
    "Synthetic sample preserving the requested visit order."
  ],
  [
    "時間の変更には待機や順序変更が伴います。",
    "Changing time can add waiting or change visit order."
  ],
  [
    "混雑は不明です。未入力の待ち時間は計算に含めていません。",
    "Crowding is unknown. Unspecified queue times are not included."
  ],
  [
    "必須の訪問先を保ち、本人が避けたい時間帯を外す架空サンプルです。",
    "Synthetic sample retaining required visits and avoiding the requested time window."
  ],
  [
    "任意のカフェを庭園に交換する架空サンプルです。",
    "Synthetic sample replacing the optional cafe with a garden."
  ],
  [
    "カフェの体験を失います。",
    "The cafe experience is lost."
  ]
] as const
