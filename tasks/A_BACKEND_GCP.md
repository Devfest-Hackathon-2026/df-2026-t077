# A：API・保存・GCP

AGENTS.md、docs/PRODUCT.md、docs/ROADMAP.md、docs/ARCHITECTURE.md、docs/API.mdを読む。Bはdocs/PLANNER.md、C/Dはdocs/FRONTEND.md、環境はdocs/DEVELOPMENT.mdも参照。

所有：backend/app/main.py・core・schemas・domain・repositories、backend依存、contracts/、配信

## 次の作業
- A-01：既存の起動/認証/共通エラーを確認し、最小Cloud Run/Hosting疎通。
- A-02：Spot/Trip/Proposalの所有権付き保存・取得。別uid404。
- A-03：Bのports接続、intent/生成HTTP、deadline、永続的な再送/lease。
- A-04：明示採用transaction、version、同key成功再送、expiry。
- A-05：実施設/経路provider、保存/帰属、backend検証。

Bの探索/意図処理をroute内に重複実装しない。外部APIをtransaction内で呼ばない。Admin SDKはrulesを迂回するためownerをAPI側で確認。

合格条件はdocs/ROADMAP.mdの該当AC。既存のmock成功と実サービスでの合格を区別し、変更・検証・未接続を報告する。

## AIへの依頼文
「AGENTS.mdとこのtasks文書を読み、現在の実装を確認して最初の未完了タスクを実装してください。担当境界・契約を守り、作成済みの土台を重複実装せず、検証結果と次担当への影響を報告してください。」
