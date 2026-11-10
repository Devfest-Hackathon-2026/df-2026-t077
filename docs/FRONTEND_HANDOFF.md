# フロント完成・確認メモ（2026-11-10）

ユーザーの依頼によりC/D範囲をまとめて引き継いだ。作業ブランチは `feat/cd-frontend-finish`、開始時のmainは `dfb9910`。backendの業務コード、データ、契約・生成型、依存lock、個人の.envは変更していない。

## 追加デバッグ（11/10）

最新main `95d838a` を既存の変更を保持して取り込み、公開版の日本語混在を再現・修正。詳細・公開版の実操作・残るMaps設定は[FRONTEND_DEBUG_20261110.md](FRONTEND_DEBUG_20261110.md)。以下の表は最終の検査件数へ更新した。

## 実装した導線

- 通常入力・AI読み取りの本人確認 → 提案生成 → 元案/時間ずらし/場所ずらしの比較 → 理由・不利益・不確実性 → 明示採用 → 保存旅程 → 条件変更による再提案。既存のお任せ枠も保持。
- 採用旅程にWhyと再提案、元の比較へのリンク、旅行日、徒歩距離・帰着余裕・訪問数を配置。Shellの旧再提案入口は削除し、二重表示を防いだ。
- 比較カードの距離・帰着余裕は同じ位置へ配置。説明の重複を整理し、partialの違反理由が表示されない不具合を修正。成立する案だけを表示する。
- 待ち時間が不明な施設は「未算入」と表示。本人の回避希望との重なり、推定経路、実測混雑を区別する。実際に経路から参照したEvidenceがGoogle Mapsなら帰属を表示。
- 表示言語はブラウザへ保存し、再読み込みで維持。旅程の数値・採用状態や保存済み説明の言語は勝手に変えない。標準カレンダーを維持。
- 地図のキー未設定・スクリプト失敗・10秒の読み込み停滞・認証拒否は一覧へ切り替える。地図と時刻表の選択を連動し、地図がなくても操作可能。
- Why→再提案をページ側で接続。入れ子dialogを作らず、Escape/閉じるで元のボタンへフォーカスを戻す。画面移動で本文先頭へ戻り、本文へ移動リンクも用意。
- 採用応答が失われても同じplan/version/UUIDで再送。異なるproposal URLへ移動した際は古い送信状態を引き継がない。
- 古い比較案からの再提案は最新バージョンの本人確認を要求。生成だけで既存の採用・条件は変えない。再提案の入力エラーは該当欄へ表示・移動する。

## ローカルで成功した検査

| コマンド（repo root） | 結果・範囲 |
|---|---|
| `npm run check:frontend` | 型/lint/単体38件/本番ビルド |
| `npm run test:e2e --prefix frontend` | 40件。固定モック、日英、360px、確認解除、AI下書きの保護、失敗・409・応答喪失・採用・再読込 |
| `npm run test:maps --prefix frontend` | 4件。地図loaderの故障注入、日英の一覧/keyboard継続、停滞、キー拒否。検査はscript URL設定前に遮断し、有効なAPIキーを使わない |
| `npm run verify:local-flow` | 2件。実Firebase SDK/Admin・HTTP・planner・Firestore Emulator、架空のdemo施設。生成応答喪失後の同UUID再送、他uid404・未認証401も検査 |
| `npm run verify:curated-flow` | 6件。実Firebase SDK/Admin・HTTP・planner・Firestore Emulator、名古屋12地点/Google Maps推定経路。日英の比較→採用→再提案→再読込、休業必須の不成立、お任せ |

WindowsのChromeで実施。海外端末のtimezoneでもAPIに日本時間+09:00が送られることを確認。mock/live/curated/maps/unitは成果物保存先を分け、互いのtraceを消さない。CIにはモックE2Eと地図故障検査を設定したが、GitHubでの今回の実行はpush後に確認する。

初回はfull setupとPlaywright Chromiumの準備が必要。既存Chromeを使う場合のみ、PowerShellで `PLAYWRIGHT_CHROMIUM_EXECUTABLE` に自分のChromeの絶対パスを設定する。個人パスをコードへ固定しない。

## 名古屋実データを手動で試す

両方をセットにして変更し、各サーバーを再起動する。

```dotenv
# backend/.env（他の認証・Emulator設定は保持）
DATA_MODE=curated

# frontend/.env（Firebase公開Web設定等は保持）
VITE_USE_MOCKS=false
VITE_AREA_ID=nagoya-central
VITE_USE_FIREBASE_EMULATORS=true
```

別々のterminalで `npm run emulators` → `npm run dev:backend` → `npm run dev:frontend`。full setupが必要。手動起動と自動live検査はAuth/Firestoreのportが重なるため、同時には起動しない。検査コマンドは.envを上書きせず、自分で起動したサーバーを終了時に停止する。

再現条件：2026-11-12、09:00〜17:00、栄駅発着、徒歩上限8km、訪問上限4、1人、歴史、名古屋城must・大須商店街optional。名古屋城の回避希望09:00〜11:00、待ち時間は未入力。元案と時間・場所の両案を確認した。数値はテスト時の推定値で、現在の混雑を表さない。

地図なしでも動く。表示する場合はfrontend用Maps JavaScript APIキーを `VITE_GOOGLE_MAPS_API_KEY` へ設定する。backendの経路取得キーやGemini認証情報を渡さない。

## 公開前にA/Bと確認するもの

1. **公開環境での一巡**：正しいFirebase公開Web設定、Auth、Cloud Run API URL、CORS、`nagoya-central`を使い、同じブラウザで入力→生成→採用→再読込。今回確認したFirestoreはローカルEmulatorであり、本番Firestoreの確認ではない。
2. **実Gemini**：UIの希望整理・確認・説明表示は接続済み。今回の実ローカル検査ではVertexを無効にし、意図APIの503でも手入力を継続できることを確認。最新mainでは説明providerが接続済み。公開版の英語希望整理・選択反映と、一部説明のfallbackを画面で確認した。全ケースの実Gemini検査は別。詳細は追加デバッグ記録を参照。
3. **実地図**：有効かつHTTP referrer/API制限済みのWebキーでマーカー/概略線を確認。ここで成功したのはキーなしと故障時の動作であり、有効キーでのクラウド地図の描画試験ではない。
4. **本番ビルド**：Aと公開用の値を確定し、`VITE_USE_MOCKS=false`、`VITE_USE_FIREBASE_EMULATORS=false`、本番API/area/Firebase設定でビルドしてHostingへ反映する。ビルド成功だけでは稼働確認にならない。公開・push・deployは今回行っていない。

CFT-06/07の画面実装とローカル検査は完了。上の公開環境の結合確認を残す。frontendだけで実混雑の取得・推定や効果の実証を補わない。
