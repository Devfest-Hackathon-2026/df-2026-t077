# API契約

## 状態と優先
DTO、実routeからのOpenAPI、25サンプル、TypeScript生成は検証済み。listSpots（DATA_MODE=demoは架空Spot（demo-area）、DATA_MODE=curatedは実施設（nagoya-central、data/curated/spots.json）。基準日の営業時間を対象日へ展開し、closures.jsonの定休日はclosedで返す）・createTrip・getTrip・getProposalは所有権付きでFirestoreへ接続済み（A-02）。createProposalはBのplannerとFirestoreへ接続済みで、同key再送・処理中409・uid別lease・保存直前のversion再確認を持つ（A-03）。interpretIntentはBのinterpreterへ接続済みで、GCP_PROJECT_ID/GEMINI_MODELが実値でない環境では503（A-03）。selectPlanはFirestoreへ接続済みで、同key成功再送をversion比較より先に判定し、Trip未変更を条件にactive_selection/constraints/version+1と再送記録を原子的に書く（A-04）。未設定areaのlistSpotsは404、候補外のspot/area/evidenceを参照するTrip作成は422。ブラウザ開発モックでは固定入力の作成・生成・採用・再読込を確認できる。担当者レビューはこれから。現在の進捗はROADMAP.md。
JSONはsnake_case、日時はoffset付きISO 8601（計画日はAsia/Tokyo）、時間秒、距離m。余分な入力は422。ja/enの表示文以外で数値・ID・計算を変えない。
health以外はFirebase ID token必須。uidをclient入力から決めず、すべてのTrip/Proposal操作で所有権を確認。他人のIDは404。

## Endpoints
| method/path | operationId | request→response |
|---|---|---|
| GET /health | health | なし→HealthResponse |
| GET /api/v1/spots | listSpots | area_id/visit_date/locale必須、q任意→SpotListResponse |
| POST /api/v1/intent/interpret | interpretIntent | IntentInterpretRequest→IntentDraftResponse |
| POST /api/v1/trips | createTrip | TripCreateRequest→TripResponse |
| GET /api/v1/trips/{trip_id} | getTrip | path→TripResponse |
| POST /api/v1/trips/{trip_id}/proposals | createProposal | ProposalRequest→ProposalBundle |
| GET /api/v1/trips/{trip_id}/proposals/{proposal_id} | getProposal | path→ProposalBundle |
| POST /api/v1/trips/{trip_id}/proposals/{proposal_id}/selection | selectPlan | SelectionRequest→SelectionResponse |

GETとintent/selectionは200、Trip/Proposal作成は201。不成立はProposalの正常な計算結果として201。HTTP障害と分ける。
P0にreplan/progress更新/投稿/取消集計endpointはない。

## 共通型
Identifierは1〜128文字の英数字/underscore/hyphen。Interestはhistory/photography/nature/food/art/quiet。Localeはja/en。
Evidenceはid/source_kind/provider/title/source_url/checked_at/confidence/is_demo/note。source_kindはmeasured/estimated/curated/user_observed/user_assumption/user_preference/demo/unknown。観測と希望・仮定を同一視しない。confidenceは情報品質区分で確率ではない。
source_urlはhttp/httpsのみ。checked_atは確認日時、予測対象日時ではない。Evidenceのtitle/noteは応答localeの文。引用・保存条件は内部PersistenceHintへ持つ。

## Spot
| field | 定義 |
|---|---|
| id/area_id/google_place_id | 独自ID、所属、外部参照null可 |
| name_ja/name_en | 日本語名、公式英語名または人が確認した表記 |
| description_ja/description_en | 独自に整理した魅力の説明 |
| visitor_info_ja/visitor_info_en | 確認済み料金・利用方法・ルール、不明事項の説明 |
| reservation_required | true/false/null。不明を不要扱いしない |
| location | lat/lng。入口位置を確認 |
| tags | Interest配列、重複なし |
| stay_seconds | 目安の滞在。根拠またはチームの仮定をEvidenceへ |
| opening_status | verified/closed/unknown |
| opening_windows | 対象日のopens_at/closes_at（最大8区間） |
| evidence_ids/is_demo | 根拠参照、架空Spotラベル |

name/descriptionの単一言語フィールドはv3では使わない。SpotListResponseはitems/evidenceを持ち、上限12候補を初期設定とする。API最大値を変える場合はA/B/Dで同期。
営業時間は対象日へserverが展開。外部APIからの名前/写真/営業情報等を無条件で独自データとして永続化しない。

## 希望の構造化
IntentInterpretRequest：
- client_request_id：UUID。同一再送で維持。
- area_id/visit_date/locale：対象範囲と応答言語。
- text：希望文1〜2000文字。原文は日本語/英語をP0対象とする。
- current_input：PartialTripInput。現在のフォームのconstraints/requested_stopsを任意項目で持つ。未知field不可。未入力は省略。完全なTripの成立検証はこの段階で要求しない。

IntentDraftResponse：
- draft：IntentDraft（確定したTripではない）。
- unresolved：配列。field/question/source_quoteを持つ。曖昧な値・未知の場所・矛盾を本人へ確認する。
- warnings：locale別の説明。
- generation_mode：gemini/template。
- requires_confirmation：常にtrue。

IntentDraftはinterests（null可）、requested_stops（候補ID/requirement/locked_start_at/reservation_confirmedの提案）、max_walk_meters/end_at（null可）、avoid_windows、wait_assumptionsを持つ。提案項目と原文を対応させるためfield_notes[{field,source_quote}]も持つ。
既に本人がフォームで固定したmust/固定時刻/数値と異なる解釈は自動上書きしない。該当fieldを未解決として返す。
具体的数値は原文かフォームに明示されたものだけを提案。曖昧表現から勝手にkm/時刻/混雑値を作らない。候補リスト外IDは返さない。複数の同名候補なら確認する。
このendpointはTripを作成・採用・変更しない。modelのtimeout/解釈不正は200で空draft、unresolved、INTENT_UNAVAILABLE警告、generation_mode=templateを返し、フォームでの継続を案内する。API自体の依存設定/通信不能は503も扱う。本人の入力を捏造したtemplateへ変換しない。

## Trip作成
TripCreateRequest：client_request_id、constraints、requested_stops、intent_confirmed。
intent_confirmedは本人が最終フォームを確認したことを表すtrue必須。AI未使用時もフォーム確認でtrueにする。これはclient側の確認記録であり、内容の安全性を保証する認可機構ではない。
raw希望文はP0で永続保存しない。

constraints：
| field | ルール |
|---|---|
| area_id/timezone | configured area、Asia/Tokyo |
| start_at/end_at | 同日内、offset必須、end>start |
| start_spot_id/end_spot_id | 候補内の起終点。同じID可 |
| mode | walking |
| max_walk_meters | 100〜30000 |
| max_visits | 1〜6、初期UIは3〜4訪問を想定 |
| interests | Interest配列、1〜6、重複なし |
| party_size | 1〜10。P0で人数の分散集計に使ったと主張しない |
| locale | ja/en、両方P0 |
| avoid_windows | AvoidWindow配列、最大6。空配列可 |
| wait_assumptions | WaitAssumption配列、異なる最大2Spot。空配列可 |
| omakase_visits | 0〜3（既定0）。「お任せ」枠の数。requested_stopsの件数と合わせて1〜max_visits。requested_stopsは0件可（お任せのみ） |

RequestedStop：spot_id、requirement=must/optional、locked_start_at=null可、reservation_confirmed=false初期値。
1〜6件、ID重複不可、must最大3、訪問先を起終点へ重複させない。固定時刻または予約確保済みはmustにする。予約確保の真偽は本人申告と明記し、予約を実行したと表示しない。

AvoidWindow：id、spot_id、starts_at、ends_at、basis、evidence_ids、note。
basis=user_preference/curated_guidance/demo_assumption。starts<ends、対象日・旅行時間内、既知のvisit候補ID、同一Spotのwindowは重複なし。
user_preferenceは本人が避けたい時間帯で、実混雑の証拠ではない。curated_guidanceのEvidenceはserver側に存在し、時期/曜日/地点/再利用条件の適合を検証する。clientがURLを付けただけで確認済みに昇格させない。
demo_assumptionは入力例/検証の仮定。実測表示は禁止。すべてsoft preference。

WaitAssumption：spot_id、wait_seconds=0〜10800、basis=user_observed/user_assumption/demo_assumption、observed_at=null可、note。
user_observedは本人の確認時刻必須。生成する旅程の未来の待ち時間を保証するものではない。計算には「その値を仮に使う」と表示し、将来時刻へ自動減衰させない。
wait未入力はunknown。計算上queue_secondsを0として時刻化する場合も、wait_not_included_spot_idsと警告を必ず持ち、「空き/0分」と表示しない。
同じSpotのWaitAssumptionは元案と代替案で同じ値。交換先に未設定ならunknownのまま。

Tripはid、constraints、requested_stops、version、active_selection、created_at、updated_atを持つ。v2のprogressはv3 P0から除外。
作成時version=1、active_selection=null。TripResponseはtrip/active_plan（未採用null）/evidence。

## Proposal
ProposalRequest：client_request_id、base_version、mode=initial/refine、constraint_overrides。
v2のtravel_context/replanは廃止。initialは未採用Trip、refineは旅行前の条件変更。overrideはmax_walk_meters/interests/end_at/avoid_windows/wait_assumptions/localeだけ。型はconstraintsと同じ。null/省略は維持、配列[]は明示クリア。mustの削除は許さない。訪問先や起終点の作り直しはP0では新しいTripへ。
生成でTrip/version/採用状態を書き換えない。正規化したeffective_constraintsをProposalに保持。生成完了前にversionが変われば409。
status=complete/partial/no_feasible_plan。partialは説明fallback等で有効なPlanがある。不成立時baseline=null、alternatives=[]、violations必須。
ProposalBundleはid/trip_id/base_version/request/effective_constraints/baseline/alternatives/evidence/status/violations/warnings/created_at。
alternativesは0〜2件。strategyはbaseline/time_shift/place_shift。balanced/trip_complete/effective_progressはv3 P0から除外。

## Plan・Stop・Metrics・比較
Planはid/strategy/stops/legs/metrics/facts/explanation/changes/warnings。
Stop：id/spot_id/role（origin,visit,destination）/requirement/arrival_at/start_at/departure_at/locked_start_at/opening_wait_seconds/queue_seconds/schedule_wait_seconds/evidence_ids。
origin/destinationはarrival=start=departure、待機各値0。visitのqueue等の定義はdocs/03。
Legはfrom_stop_id/to_stop_id/mode/duration_seconds/buffer_seconds/distance_meters/source_kind/evidence_ids。stop.idを連続参照。
Metrics：
- walk_meters、travel_seconds、total_seconds、finish_slack_seconds。
- modeled_queue_seconds、schedule_wait_seconds。
- avoid_overlap_seconds（避けたい窓と訪問区間の重複。実混雑量ではない）。
- optional_kept_count/optional_replaced_count/optional_removed_count。
- wait_not_included_spot_ids。unknownを空き表示しないための必須配列。
crowd_index/混雑削減率/成功確率はP0に置かない。
changesは[{kind: time_shift/place_replacement/removal, original_spot_id, replacement_spot_id（null可）, before_start_at（null可）, after_start_at（null可）, reason_fact_ids}]。
明確な事実比較のみ。baseline=nullでは差分・改善率を作らず、original requested_stopsからの変更はchangesで説明。

Factはid/kind/text/evidence_ids/is_demo。kind=change/interest/travel/timing/opening/tradeoff/uncertainty。textはPythonが応答localeで組み立てる。
Explanationはsummary、reason_fact_ids、tradeoff_fact_ids、uncertainty_fact_ids、generation_mode。モデルが距離や新施設を創作しない。Fact参照はPlan内、Evidence参照はBundle内で解決。
Violationはcode/spot_id（null可）/message/suggested_action。codeはMUST_UNREACHABLE/CLOSED/OPENING_UNKNOWN/TIME_LIMIT/WALK_LIMIT/LOCKED_TIME/NO_CANDIDATE/ROUTE_UNKNOWN/RESERVATION_REQUIRED/CONSTRAINT_CONFLICT。

## 採用・再送・競合
SelectionRequest：plan_id、expected_version、idempotency_key（UUID）。
SelectionResponse：trip/active_plan/evidence。
同じuid/Trip/action/keyの成功再送をversion比較より先に判定。payload不一致は409 IDEMPOTENCY_KEY_REUSED。
Trip.version==expected_version==proposal.base_version、有効Planの所属・期限・確認済みのhard constraintsを検証。採用transactionでactive_selection/constraints/requested_stops/updated_at/version+1と再送成功記録を原子的保存。requested_stopsは採用Planの訪問順・訪問先にする（場所案の交換先はoptional・予約未確認、残った訪問先は予約確認を維持）。訪問先でなくなったSpotのavoid_windows/wait_assumptionsは削除する（残すと次の再提案がCONSTRAINT_CONFLICTになるため）。次の再提案は採用旅程を元案とする。
外部API照会はtransaction外。必要情報が期限切れなら黙って同一Proposalを変更せず再提案へ。採用後はGET Tripで正本再取得。
Trip作成/intent/生成もclient_request_idで再送を識別し、不必要な多重資源作成・Gemini多重呼出を避ける。処理中409+Retry-After。失敗後は同key再試行可。

## エラー
ErrorResponseはerror{code,message,details[{code,message,field}],request_id}。localeが取得できればその言語、取得不能な401等は固定codeからUI辞書で訳す。
401 UNAUTHENTICATED、404 NOT_FOUND、409 VERSION_CONFLICT/MODE_CONFLICT/REQUEST_IN_PROGRESS/IDEMPOTENCY_KEY_REUSED、422 VALIDATION_ERROR、429 RATE_LIMITED、503 DEPENDENCY_UNAVAILABLE、504 GENERATION_TIMEOUT。
401のtoken更新は1回まで。同一POSTの再試行ではUUIDを維持。別keyで古いversionを自動再採用しない。
