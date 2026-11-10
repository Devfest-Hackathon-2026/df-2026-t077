# 生成・制約・Gemini

## 入出力の責任
A：HTTP/認証/所有権/外部情報/保存/採用/共通deadline。B：意図抽出、baselineと候補、時刻化、制約、差分、Fact、説明。
BのengineはFastAPI/Firestore/Mapsの直接呼出をしない。Aが渡したPlanningContextを読み、EngineResultを返す。入力を書き換えない。

## 意図抽出
allowed_spotsと日英の情報、現在フォーム、希望原文、localeをGeminiへ渡す。許可IDとenumに制限した構造化出力。
「名古屋城に絶対行きたい」→must案、「カフェは変更してよい」→optional案。既に本人が指定したmustを曖昧な生成結果で落とさない。
「疲れやすい」→上限値の確認、「静かな場所」→quietの提案。距離や実混雑を推測して断定しない。
未知場所・曖昧な数値・相反する時刻はunresolved。本人が確認したフォームだけをTrip作成に使う。
Gemini timeout時はフォーム入力で続行可能。意図解釈の失敗を架空の成功へ変えない。

## baseline
requested_stopsの指定順を維持し、最も早く時刻化する。勝手にoptionalを除かない。avoid_windowsはsoftなのでbaselineの構造を歪めず、重複を計測して比較基準にする。
不成立ならbaseline=nullと違反理由。成立しない元案を採用可能にしない。代替案は同じTrip条件で計算する。

## 時刻化
legごとの移動余裕buffer初期120秒。Bが設定管理。実測で学習した値ではない。
next.arrival = previous.departure + leg.duration + leg.buffer。
各営業windowで、open_ready=max(arrival,opens_at)、earliest_start=open_ready+queue_secondsを計算。
- 通常baseline：start=earliest_start。
- 時間案の候補：start=max(earliest_start,candidate_start)。
- 固定時刻：earliest_start<=locked_start_atならstart=locked_start_at、満たさなければ不成立。
departure=start+stay_seconds、departure<=closes_atを満たすwindowだけ採用。
opening_wait_seconds=open_ready-arrival。
schedule_wait_seconds=start-earliest_start。
start-arrival=opening_wait_seconds+queue_seconds+schedule_wait_seconds。二重計上禁止。
予約があっても待ち時間0を自動仮定しない。本人が設定したqueueの前提と衝突する場合は理由を示す。
origin/destinationは瞬間地点。終点到着<=end_at、全leg距離<=max_walk_meters。帰路も必ず含める。
finish_slack_seconds=end_at-終点到着。余りを待機として旅程に水増ししない。

## 時間ずらし
visit集合とmust/optionalを保持し、順序・開始候補を探索。候補時刻は営業開始、earliest_start、避けたいwindowの終了など少数の境界を中心にする。単に各時刻を最速にするだけでは時間案の仕様を満たさない。
避けたいwindowと各visitの[start,departure)の重複秒を計測。windowは同一Spotで重複なし。空間的に別の施設に周辺人口を割り振らない。
全windowを避けられない場合は、残る重複と負担を示す。hard constraintより上位にしない。
変更の根拠がなく、順番変更による移動負担や入力した条件も改善しない案は出さない。時刻の違いだけを混雑削減と呼ばない。
本人希望の回避は「避けたい時間帯を外した」と説明し、「実際に空く」とは説明しない。

## お任せ枠
constraints.omakase_visitsの数だけ、生成の最初に訪問先を補う。候補は未選択・起終点以外・営業確認済み・予約不要・楽しみたい体験と1つ以上一致するSpot。各候補を全位置へ挿入して通常のschedulerで成立を確認し、体験の一致数→歩行距離→所要時間で選ぶ。補った訪問先はoptionalとして元案・時間案・場所案の計算に使い、含む案に「お任せで選んだ理由」のFact（kind=interest）を付ける。補えない枠は警告、訪問先が1件も無ければNO_CANDIDATEで不成立。Tripのrequested_stopsは採用まで変えず、採用時に採用Planの訪問先へ置き換えてomakase_visitsを0にする。

## 場所ずらし
mustは維持。optionalを1件以上、未選択の確認済みSpotへ置き換える。
候補の体験タグ/説明から本人の希望との対応を示す。「日本の歴史」が共通でも、城と商店街で何が異なるかをFactへ。
同件数を保つ交換を先に探索。除外・訪問短縮だけで高評価にしない。optionalの交換/削除を数え、失う体験を表示。
移動・営業時間・予約条件・受入条件を確認。予約必要で本人の確保が確認できないSpotを勝手に確保済みにしない。
口コミ数、星の少なさ、英語情報の少なさだけで低混雑・魅力・受入余力を推定しない。候補の知名度が低いと客観的に証明したとは言わない。

## 比較の公平性
同一Spotには全案で同じWaitAssumptionを使う。user_observedでも、将来到着時刻では仮定として扱う。
時刻だけ後ろへずらしてqueueを減らさない。確認済み時刻別データが将来導入される場合も、全案で同一関数/日付/尺度を使う。
WaitAssumption未入力は不明。計算に入れていないSpotを配列で返し、0分待ち/空き表示は禁止。
交換先の待ち時間不明によって算入秒が減っても「待ち時間短縮」を利益にしない。未知を含む案のqueue差は比較不可とする。
avoid_overlap_secondsは希望/根拠窓との重複時間であって、観光客数・混雑度・削減率ではない。
元案と代替案は同じ起終点/帰着条件/滞在目安/ルート根拠/仮定で評価。削除したoptionalの損失を隠さない。

## 選定順
hard constraintsを通った案だけを比較する。学習済み総合スコアや成功確率は作らない。
time_shiftは回避窓重複の減少、過度な時刻変更/待機の少なさ、歩行負担の順で比較する。回避根拠がなければ同visit集合で移動負担等に説明可能な改善がある案だけ。
place_shiftは希望する体験の保持、交換/削除の説明可能性、歩行負担・時間余裕・情報品質を比較。小さなタグ一致だけで極端な迂回を推薦しない。
初期のタグ尺度やtie-breakはBがconfigにまとめ、Dと実演例で確認。必須条件や体験喪失を単一の恣意的点数で打ち消さない。
最大2代替案（原則time_shiftとplace_shift各1）。同内容を戦略名だけ変えて重複表示しない。同visit順で開始差15分未満は初期の重複基準。
候補8〜12、visit<=6、探索時間上限2秒、最大展開3000を初期値とする。2秒は目標上限で実測値ではない。必要なら上限内でbeam探索を使う。OR-Tools導入は必須でない。
上限で打ち切る場合も、validatorを通った案だけ返し警告する。案数不足は正常。起終点だけの旅行案を作らない。

## validator
must/固定時刻/営業全滞在/予約条件/終点/歩行上限/visit件数とID所属/重複/leg連続性/時刻の式/待機内訳/metrics合計/Fact-Evidence参照を検証。
入力正規化後と候補出力前に検証し、API境界でも契約を確認。避けたい時間帯の重複は不成立ではなく説明事項。
closed/unknownのvisitは採用可能にしない。起終点は入館を伴わない地点として区別。
ルート取得不能はunknown/503等で返し、直線距離を確認済み徒歩ルートとして使わない。

## Factと説明
Pythonでchange/interest/travel/timing/opening/tradeoff/uncertaintyのFactを作る。ja/enのテンプレートを揃え、値と根拠は共通にする。
Geminiは本人の好み、候補概要、確定Fact、localeだけからsummaryとFact参照を作る。token/uid/不要な正確位置/秘匿情報を渡さない。
モデルからの数値・固有名詞の創作、不明なFact ID、DTO不正、根拠にないマナーや営業時間は拒否。summaryの数値列挙は避け、詳細はFact表示。
説明失敗時はlocale別定型へfallbackしpartial＋EXPLANATION_FALLBACK。有効な旅程は維持。モデル失敗と旅程不成立を分ける。
最大2案の説明を原則1回でまとめ、説明timeout初期8秒、API全体deadline25秒を超えて再試行しない。

## 必須の破壊ケース
must削除、固定時刻変更、閉店跨ぎ、帰路忘れ、歩行超過、予約未確認、避けたい時間と予約の衝突、unknownの0分表示、交換先unknownによる偽の短縮、代替案だけ仮定変更、同じ案の水増し、説明未知参照、日英で数値が変わること。
