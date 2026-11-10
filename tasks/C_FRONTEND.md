# C：比較・採用画面・地図

AGENTS.md、docs/PRODUCT.md、docs/ROADMAP.md、docs/ARCHITECTURE.md、docs/API.mdを読む。Bはdocs/PLANNER.md、C/Dはdocs/FRONTEND.md、環境はdocs/DEVELOPMENT.mdも参照。

所有：frontend/src/features/compare・tripとfeature CSS。共通router/hooks/lockはDと調整。

## 11/10の現在地

ユーザーの依頼でC/Dの画面実装をまとめて引継ぎ、比較・採用旅程・Why・再提案・日英・地図故障を仕上げた。名古屋実データと実HTTP/Auth/Firestore Emulatorの操作を検証済み。公開環境/実Gemini/有効なWebキーでの地図描画は別途確認する。実装と再現方法は[FRONTEND_HANDOFF.md](../docs/FRONTEND_HANDOFF.md)。以下は従来のタスク分解として読む。

## 次の作業
- C-01：既存previewを完成させ、元案null/unknown/不足/日英で指標と変更点を比較。
- C-02：時刻表、地図、Spot詳細。概略線と実経路を区別。
- C-03：Why→実API採用→GET Trip、再読込、409時の本人再確認。
- C-04：360px、keyboard、英語長文、発表の見せ方。

共通hooks/生成型を使い、採用正本を別storageに作らない。地図失敗でも一覧で操作できるようにする。

合格条件はdocs/ROADMAP.mdの該当AC。既存のmock成功と実サービスでの合格を区別し、変更・検証・未接続を報告する。

## AIへの依頼文
「AGENTS.mdとこのtasks文書を読み、現在の実装を確認して最初の未完了タスクを実装してください。担当境界・契約を守り、作成済みの土台を重複実装せず、検証結果と次担当への影響を報告してください。」
