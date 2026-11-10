# D：入力・共通frontend・統合

AGENTS.md、docs/PRODUCT.md、docs/ROADMAP.md、docs/ARCHITECTURE.md、docs/API.mdを読む。Bはdocs/PLANNER.md、C/Dはdocs/FRONTEND.md、環境はdocs/DEVELOPMENT.mdも参照。

所有：frontend設定/生成型/api/auth/hooks/router、共通UI/i18n、setup/why/mock/E2E、仕様統合

## 11/10の現在地

ユーザーの依頼でC/Dの画面実装をまとめて引継ぎ、比較・採用旅程・Why・再提案・日英・地図故障を仕上げた。名古屋実データと実HTTP/Auth/Firestore Emulatorの操作を検証済み。公開環境/実Gemini/有効なWebキーでの地図描画は別途確認する。実装と再現方法は[FRONTEND_HANDOFF.md](../docs/FRONTEND_HANDOFF.md)。以下は従来のタスク分解として読む。

## 次の作業
- D-01：既存client/Auth/hooksと再送部品を実APIに接続。主体変更時のcache破棄。
- D-02：自由な条件入力、must/optional/固定時刻、回避窓/wait、日英のAI整理と本人確認。
- D-03：PlanningAttemptでcreate→generate→比較、Why/根拠、旅行前refine。
- D-04：実APIの日英完走、失敗/不成立/再送/競合の検証。
- D-05：地域/実演シナリオと提出の統合。情報収集/テスト/資料作業は全員へ分担。

A-00/D-00相当の型と土台は実装済み。本人確認前の解釈でTripを作らず、既存のmustを自動上書きしない。

合格条件はdocs/ROADMAP.mdの該当AC。既存のmock成功と実サービスでの合格を区別し、変更・検証・未接続を報告する。

## AIへの依頼文
「AGENTS.mdとこのtasks文書を読み、現在の実装を確認して最初の未完了タスクを実装してください。担当境界・契約を守り、作成済みの土台を重複実装せず、検証結果と次担当への影響を報告してください。」
