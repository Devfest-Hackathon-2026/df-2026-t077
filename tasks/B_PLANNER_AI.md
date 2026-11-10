# B：生成・Gemini

AGENTS.md、docs/PRODUCT.md、docs/ROADMAP.md、docs/ARCHITECTURE.md、docs/API.mdを読む。Bはdocs/PLANNER.md、C/Dはdocs/FRONTEND.md、環境はdocs/DEVELOPMENT.mdも参照。

所有：planner/intent/explainer、Gemini adapter、生成テスト。共有portsはAと調整。

## 次の作業
- B-00：AとVertex AI最小疎通、モデル/権限/期限を確認。
- B-01：baseline/scheduler/validator。営業・固定・帰路・帰着・歩行・待機内訳。
- B-02：time_shift/place_shift、探索上限と重複排除、公平な最大2案。
- B-03：日英希望の構造化、曖昧さ/未知ID/既存入力衝突、本人確認前はdraft。
- B-04：日英Fact、説明port、参照検証、定型fallback。

engineはDB/HTTPへ依存せず入力を変更しない。同一Spotのqueueを全案で揃え、unknownを短縮利益にしない。

合格条件はdocs/ROADMAP.mdの該当AC。既存のmock成功と実サービスでの合格を区別し、変更・検証・未接続を報告する。

## AIへの依頼文
「AGENTS.mdとこのtasks文書を読み、現在の実装を確認して最初の未完了タスクを実装してください。担当境界・契約を守り、作成済みの土台を重複実装せず、検証結果と次担当への影響を報告してください。」
