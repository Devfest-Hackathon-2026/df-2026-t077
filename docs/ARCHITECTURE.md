# 分担・アーキテクチャ

## 構成と現在の状態
React/TypeScript/Vite → Firebase匿名認証 → FastAPI → Firestore/provider。
実行基盤はFirebase Hosting/Cloud Runを計画し、GeminiはVertex AI経由を第一候補とする。
HTTP/認証/生成/採用/保存と、名古屋curatedのローカル結合は接続済み。公開環境・実Gemini・有効なWebキーでの地図描画は別途確認する。実装状況はROADMAP.mdとFRONTEND_HANDOFF.md。

| 担当 | 所有する主な範囲 |
|---|---|
| A | backend app/main・core・schemas・repositories・API orchestration・GCP・backend依存・OpenAPI/fixtures |
| B | domain portsのAとの合意、planner/intent/explainer、Gemini adapter、生成テスト |
| C | frontend features/compare・trip・地図/時刻表・採用操作・各feature CSS |
| D | frontend設定/依存・app/router・auth/api/hooks・共通UI/i18n・setup/why・mock/E2E・統合 |
| 全員 | 実施設情報と日英文確認、相互レビュー、操作テスト、提出資料 |

## A/B境界（コードはbackend/app/domain/ports.py）
- Planner.generate(context: PlanningContext) -> EngineResult：async。
- IntentInterpreter.interpret(request, allowed_spots, deadline_monotonic) -> IntentDraftResponse：async。
- Explainer.explain(ExplanationInput(locale,facts), deadline_monotonic) -> Explanation：async。
- contextはTrip/request/effective_constraints/spots/routes/evidence/deadline_monotonic/explainer。localeはeffective_constraints.locale。
- Aが本人確認済み入力、外部情報、uid/所有権、保存、採番、全体deadlineを扱う。
- Bは入力を変更せずDB/HTTP/Mapsを直接呼ばない。Bのengineから説明portを呼び、未接続/不正時は定型説明とpartialにする。
- RouteEstimateはfrom/to、duration/distance、source/evidence、PersistenceHintを持つ。保存条件や期限を失わない。
- effective_constraints()はnull/省略維持・[]クリア。remaining_seconds()は共通deadlineを延長しない。

## C/D境界
共通hooksはfrontend/src/api/hooks.ts、型aliasはtypes.ts。DTOを別定義しない。
useSpots、useInterpretIntent、useCreateTrip、useTrip、useGenerateProposal、useProposal、useSelectPlanを共有する。
ComparePage/TripPageがWhyPanelの開閉を管理。propsはplan/evidence/effectiveConstraints/onRefine/onClose。
WhyPanelはonRefineでページへ委譲し、ページが共通RefineFormへ切り替える。入れ子のmodalは作らない。採用旅程の入口はTripPageに配置し、旧ShellのTripRefineActionは削除。
RefineFormのpropsはtripId/effectiveConstraints（省略時は最新Trip）/expectedVersion（比較からはProposal.base_version）/onClose/onGenerated（任意）。取得・検証・生成・再送・成功遷移はD側で持つ。生成で採用は変更しない。
フォームはローカル状態、server資源はQuery、proposalIdはURL。採用正本はGET Trip。モックのbrowser storageはmocks/に閉じ込める。
認証主体の変更時には個人cacheを破棄する。401のtoken更新は1回、POSTの無条件自動retryをしない。
