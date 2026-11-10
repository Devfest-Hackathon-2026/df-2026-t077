# AI開発共通指示
対象：4人の開発チーム。企画・公開APIはv3。

## 読む順序と正本
README → docs/PRODUCT.md → docs/ROADMAP.md → 自分のtasks文書。
APIはdocs/API.md、内部境界はdocs/ARCHITECTURE.md、環境/共通部品はdocs/DEVELOPMENT.md。
schema変更後の型はbackend/app/schemas/contracts.pyと生成OpenAPI/TypeScriptを正本にする。手書きDTOを重複作成しない。
ユーザーの最新指示を優先。現在のbranchと差分、上位/下位AGENTSを確認し、他人の変更を取り消さない。

## 企画の中心
時間ずらし＋場所ずらしで観光の集中を和らげる選択肢と地域の魅力の発見を作る。
国内/訪日旅行者向けで、英語で情報を探す訪日個人旅行者を主要ペルソナとする。日本語・英語をP0に保つ。
must/固定時刻/帰着/歩行上限を守る。根拠・不利益・不確実性を比較し、本人が採用する。
混雑不明を空き扱いしない。本人希望/観測/仮定/demoを区別し、全案で同じ待ち時間条件を使う。
時刻や場所を変えただけで実混雑の改善と説明しない。本人が知らない場所と、客観的な低知名度を区別する。

## 実装
- mainから作業単位の短いbranchを作り、PRでmainへ。詳細はCONTRIBUTING.md。
- AはAPI/保存/GCP、Bは生成/Gemini、Cは比較/採用画面/地図、Dは入力/共通frontend/Why/統合。全員が各自checkoutで作業。
- schema/backend lockはA、frontend lock/router/生成型はD。変更は関係担当へ共有し、A/B・C/Dで相互レビュー。
- Geminiは希望の構造化と確定Factの説明。制約・時刻・距離はPythonが検証し、未確認のAI解釈でTripを作成しない。
- 提案生成と採用を分離。再送は同じUUID、生成失敗でTripを重複作成しない。採用/認可はserverが正本。
- 実backendにmock tokenの認証バイパスを追加しない。秘密をVITE変数/git/logへ入れない。
- 外部情報の再利用/保存/帰属を確認。有料混雑APIやスクレイピングをP0の必須条件にしない。
- P0に旅行中replan/GPS/投稿/追加言語/課金/予約実行を追加しない。
- 360pxとkeyboard、地図なし、日英、失敗/不成立/409を確認。デモを実サービスの動作と偽らない。
- 公開/push/deploy/他者への連絡は依頼された範囲で行う。実作業の日時や履歴を隠す操作をしない。

## 検証・報告
frontendはnpm run check:frontend、backend込みはnpm run verify:foundation、setup共通はnpm run test:setup。
ユーザーから見た変更、検証結果、担当間の影響、未接続事項、次の受渡しを報告する。未実施の検証を成功と書かない。
