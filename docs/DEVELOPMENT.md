# 開発手順

## 固定バージョンとプロファイル
Node 24.22.2/npm 11.19.1（package.jsonのVolta pin）、Python 3.13.5/uv 0.13.7、emulator用Java 21。
GitとVoltaを入れ、backend/fullではbootstrap用Python 3.11以上も準備します。Node/npmはglobal defaultを変更せずproject用の版で実行します。

Windows：
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup.ps1 -Profile frontend
```
frontend/backend/fullを選択。指定なしはfrontend。Mac/Linuxは `bash scripts/setup.sh frontend`。Windows以外は実機未検証。
frontendはnpm ciとfrontend/.envだけ。backendはuvとbackend/.venv/.env。fullは両方にFirebase CLIとSHA256確認済みローカルJavaを加えます。
既存.envは上書きしません。初回はネット接続とダウンロード時間が必要です。中断/チェックサム不一致は不完全ファイルを除去し、同じコマンドで再試行できます。

## 起動
- frontend：npm run dev:frontend → http://127.0.0.1:5173
- backend：npm run dev:backend → http://127.0.0.1:8000/health と /docs
- fullのemulator：npm run emulators → Auth9099/Firestore8080/UI4000（すべて127.0.0.1）。
それぞれ別terminalで起動しCtrl+Cで停止。別のサービスのportを勝手に終了しない。
確認は `npm run doctor -- frontend`（またはbackend/full）。

## 検証
frontendのみ：npm run check:frontend。backendも準備後：npm run verify:foundation。setup用：npm run test:setup。
ブラウザ：
```bash
npm exec --prefix frontend -- playwright install chromium
npm run test:e2e --prefix frontend
```
PCの既存Chromeで確認する場合はPLAYWRIGHT_CHROMIUM_EXECUTABLEを自分の実行ファイルへ設定できます。共通設定に個人のパスを固定しないこと。
E2Eは2並列、状態待機10秒、再試行0回。WindowsのViteキャッシュのロックを避け、テストごとに.tools/vite-e2eへ分離します。キャッシュはlint/git対象外。
ブラウザE2Eは専用port 5187（PLAYWRIGHT_PORTで変更可）を使い、既存サーバーを再利用しません。起動時に固定モック/normal/demo-areaを明示するため、各PCの.envにある実API設定に依存しません。CIもChromiumを用意してこのテストを実行します。実APIや有料APIの検査は含みません。
fullではnpm run verify:emulatorsで匿名Auth/client deny-allを確認。実際のAdmin SDK→API認証はemulator起動中にbackendのPythonでscripts/auth-api-probe.py。Firestore保存の検査は npm run test:firestore（emulatorを起動して終了まで実行、demo-zurashitabiのみ）。

### 実ローカルHTTP・認証・保存・生成・採用の確認
fullのsetupと上記のブラウザ準備後、project rootで実行します。
```bash
npm run verify:local-flow
```
Auth 9099 / Firestore 8080 / API 8008 / frontend 5188を使います。すべてローカル・demo-zurashitabiです。既存のサービスがportを使っている場合は起動に失敗するので、使用中のものを確認してください。テスト用に起動したプロセスは終了時に停止します。

mock=falseで実際のFirebase SDK→Admin token検証→FastAPI→planner→Firestore Emulatorを通します。既存.envは上書きせず、架空のdemo施設/経路を使い、外部Gemini/Maps/有料APIは呼びません。日英で手入力→確認→実生成→比較/Why→採用→再提案→再読込を検査します。日本語では時間案、英語では場所案を採用し、must保持と、再提案だけでは採用旅程が変わらないことも確認します。

最初の生成はserverで保存された後にブラウザー側だけ応答を失わせ、同UUIDの再送で同じProposalが返り、Tripが重複しないことを検査します。未認証401、他uid404、海外timezoneで日本時間保持、地図なし360pxも含みます。Vertex AIを設定しないので希望解釈APIは503を期待し、その後フォームで進めることを確認します。生成/採用APIは201/200の成功を期待します。

クラウド・実施設・実Geminiでの確認とは区別してください。保存の並列再送等は別途 `npm run test:firestore` で確認します。結果はROADMAPを参照してください。

## モックと実API

### キーなしで実APIを手動操作する
full環境を準備したPCでは、本物のFirebase/Gemini/Mapsのキーなしでも、ローカル実APIの入力→計算→採用→保存を操作できます。施設・経路は架空のdemoデータです。AI希望解釈は設定なしの503を返しますが、フォームで継続できます。地図もキーなしの代替表示になります。

`frontend/.env`（なければ同フォルダーの`.env.example`からコピー）の該当項目を次に揃えます。
```dotenv
VITE_USE_MOCKS=false
VITE_USE_FIREBASE_EMULATORS=true
VITE_API_BASE_URL=http://127.0.0.1:8000
VITE_AREA_ID=demo-area
VITE_FIREBASE_PROJECT_ID=demo-zurashitabi
VITE_FIREBASE_API_KEY=demo-only-not-a-real-key
VITE_FIREBASE_AUTH_DOMAIN=demo-zurashitabi.firebaseapp.com
VITE_GOOGLE_MAPS_API_KEY=
```
`backend/.env`はAPP_ENV=local、DATA_MODE=demo、GCP_PROJECT_ID=demo-zurashitabi、FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099、FIRESTORE_EMULATOR_HOST=127.0.0.1:8080、CORS_ORIGINS=http://127.0.0.1:5173に揃えます。

project rootから3つのterminalで、それぞれ `npm run emulators`、`npm run dev:backend`、`npm run dev:frontend` を起動します。http://127.0.0.1:5173 を開いてフォームから入力してください。設定を変えた後は各サーバーを再起動します。起動したterminalでCtrl+Cを押すと停止します。

クラウドのAPIを試す場合は、AからAPI URL・同一projectのFirebase公開Web設定・area_id・許可済みCORS originを受け取り、emulatorをfalseに切り替えます。Geminiは現在のbackend実装がVertex AI + ADCを使用するため、フロントにGeminiのキーを渡しません。ローカルで実Geminiも実行する場合は、backend側に実project/modelと権限のあるADCを用意します。[Google公式のADC設定](https://cloud.google.com/vertex-ai/generative-ai/docs/start/gcp-auth)を参照してください。

### 固定モック
初期値は開発モック。固定条件の確認→作成→比較→Why→採用→再読込を日英で試せます。実施設や任意入力の最適化ではありません。
モックはsessionStorageを仮のserver状態として使用し、同じタブのreloadで保持します。タブを閉じる/データ消去で失われます。実DBの永続性や認可/transactionの合格ではありません。
未対応の入力は422 DEMO_FIXED_INPUT_ONLY。同UUIDは成功再送、違うpayload/古versionは409。失敗で採用中の旅程を消しません。
VITE_MOCK_SCENARIO：normal/time_shift/place_shift/unknown/partial/no_feasible/conflict/intent_ambiguous。変更後はVite再起動。
実APIへはVITE_USE_MOCKS=falseとFirebase設定。本番ではemulatorもfalse。production buildからmock worker/fixturesを除外し、不適切な設定は起動時に拒否します。

採用旅程の地図は`@vis.gl/react-google-maps`で表示し、browser用キー`VITE_GOOGLE_MAPS_API_KEY`が設定された場合だけMaps JavaScript APIを読み込みます。キーはfrontend/.envに設定し、コミットしないでください。VITE値はブラウザーから見えるため、GCP側でMaps JavaScript APIだけに制限し、利用するWebサイトのHTTP referrer制限・予算/割当を設定してください。backend用MAPS_API_KEYとは分離します。P0の地図はSpot座標と訪問順の概略表示だけで、Routes APIや新たな経路取得は呼び出しません。キー未設定・API/ネットワーク失敗でも時刻表と採用操作は継続できます。

### 入力画面を試す（D担当実装）
1. /plan/newで「開発用サンプル条件を読み込む」。固定日付2026-11-05と架空の候補・仮定が入る。
2. 通常フォームから「条件を確認する」→内容と仮定を確認→「この条件で提案」。固定条件を変えた場合の生成はモックが明示的に拒否する。
3. 途中の編集で確認が解除される。希望文のAI整理は任意で、原文・未解決事項を見て選んだ項目だけ反映する。
4. Whyから「条件を変えて再提案」。モックでは説明言語だけ変更できる。実APIでは許可された条件変更を生成し、採用は別操作。
5. 標準カレンダーの日付表示はブラウザー言語に従う。保持する値はYYYY-MM-DD、日本時間で変換する。

実API結合時はfrontend/.envにVITE_AREA_ID（Aの設定したarea_id）、VITE_API_BASE_URL、同一projectのFirebase公開Web設定を指定して再起動する。既存.envを上書きしない。
他のPCのAPIを使う場合に127.0.0.1を指定しない。Cloud Runの入口認証/IAMとアプリのFirebase ID tokenは別で、Aと到達方法を確認する。秘密の鍵をVITE変数へ入れない。
実Auth/実DBでの所有権確認と任意入力の実生成はA/Bの接続後に検証する。モックの成功で代替しない。

追加テスト：npm run test:unit --prefix frontend、npm run test:e2e --prefix frontend -- setup-flow.spec.ts。

## 共通部品
- lib/japanTime.ts：フォームを日本時間へ変換。海外端末でも旅行日がずれず、offset無しや不正日付を拒否。
- api/attempts.ts：確認した入力1回につきPlanningAttemptを1つ作り、失敗時は同じrun(api)を再試行。Tripの重複作成を防ぎ、応答喪失時も同UUID。
- lib/singleFlight.ts：同時ログインを共有し、成功/失敗後にPromiseを解放して再試行可能にする。
- domain/constraints.py：条件mergeと共通deadline。ports.pyの呼び出し方はARCHITECTURE.md。
- 認証：無効tokenは401、資格情報・証明書取得など依存障害は503。token/provider例外は応答へ出さない。

## 契約更新とデータ
backend/.venvのPythonでscripts/export_contracts.py → npm run api:types --prefix frontend → npm run verify:foundation。
fixture変更はscripts/build_v3_fixtures.py → scripts/validate_fixtures.py。サンプルは架空と明示。
実施設の入力はdata/curated/README.md。実施設で動かすにはbackend/.envをDATA_MODE=curated、frontend/.envをVITE_AREA_ID=nagoya-centralにして再起動（DATA_MODE=demoの架空Spotはdemo-area）。検査は `npm run data:check -- data/curated/spots.json --visit-date 2026-11-05`。

## 配信（Cloud Run / Firebase Hosting）
実行者はproject zurashitabiの権限を持つA。コマンドはリポジトリ直下で実行。秘密鍵・.envはアップロードしない（.gcloudignore/.dockerignore）。
- backend：`gcloud run deploy zurashitabi-api --source . --project zurashitabi --region asia-northeast1 --service-account zurashitabi-api@zurashitabi.iam.gserviceaccount.com --allow-unauthenticated --max-instances 2 --memory 512Mi --timeout 60 --quiet --set-env-vars "^@^APP_ENV=production@DATA_MODE=curated@GCP_PROJECT_ID=zurashitabi@GCP_LOCATION=global@GEMINI_MODEL=gemini-3.8-flash@GENERATION_TIMEOUT_SECONDS=25@FIRESTORE_DATABASE=zurashitabi@EXPLANATION_PROVIDER=gemini@CORS_ORIGINS=<frontendのorigin,カンマ区切り>"`。EXPLANATION_PROVIDER=gemini で各案の要約をGeminiが作る（検証に失敗・timeoutすると定型文のままpartial＋EXPLANATION_FALLBACK）。templateに戻すと即座に定型文のみになる。URLは https://zurashitabi-api-445817048721.asia-northeast1.run.app
- Firestoreは名前付きDB「zurashitabi」（asia-northeast1）。FIRESTORE_DATABASEを省略するとstaging/productionは起動しない（"(default)"は別DB）。firebase.jsonにもDB名を明記済みで、`firebase deploy --only firestore:rules --project prod` はこのDBへ反映する
- frontend：frontend/.env.production.local（git管理外）にVITE_USE_MOCKS=false、VITE_USE_FIREBASE_EMULATORS=false、VITE_API_BASE_URL、VITE_FIREBASE_*（`firebase apps:sdkconfig WEB`の公開値）、VITE_AREA_ID=nagoya-centralを書き、`npm run build --prefix frontend`
- 確認用：`firebase hosting:channel:deploy preview --expires 7d --project prod`（期限付きURL、本番URLは変えない）。新しいoriginは `gcloud run services update zurashitabi-api --project zurashitabi --region asia-northeast1 --update-env-vars "^@^CORS_ORIGINS=..."` でCORSへ追加
- 本番：`firebase deploy --only hosting --project prod`（https://zurashitabi.web.app）。チームの確認後に実行
- CLIはプロジェクト内のもの：`node node_modules/firebase-tools/lib/bin/firebase.js ...`

## 困ったとき
- npm/voltaが見つからない：インストール後terminalを開き直し、project rootで実行。
- Pythonがない：frontendだけなら不要。backend/fullではPython 3.11以上を入れる。
- backendの503：意図解釈はGCP_PROJECT_ID/GEMINI_MODELが実値でないと503（フォームで続行可）。Trip/Spotで503ならFirestore emulator未起動。認証を無効化して回避しない。
- productionが起動しない：mock/emulatorの設定を確認し、実Firebaseの公開設定とAPI URLを用意。
- エラー共有：OS、profile、実行コマンド、秘密を除いたエラー、branch/commitを添える。

## 依存関係
外部パッケージのdeprecated/未承認install script警告があります。依存auditにはmoderateの間接依存警告が残るため、外部公開前に再確認します。npm audit fix --forceやinstall scriptの一括承認は通常手順にしません。

新規Javaを展開した直後、Firestoreの初回起動が60秒でタイムアウトする場合がありました。同じ設定で再実行して成功を確認。CLIの終了を待ってからnpm run verify:emulatorsを再実行し、継続する場合はfirestore-debug.logとJavaの起動を確認します。別のプロセスを勝手に終了しないでください。

## 名古屋実データ・地図故障のフロント検査（11/10）

- `npm run verify:curated-flow`：full setup後、実HTTP/Auth/Firestore Emulatorと `DATA_MODE=curated` / `nagoya-central` をセットで起動。既存の.envを変更しない。日英の通常操作・不成立・お任せを検査する。実Gemini・外部の地図APIは無効。portはverify:local-flowと同じなので同時実行しない。
- `npm run test:maps --prefix frontend`：専用port 5190で固定モックを使い、地図loaderのscript設定時に故障を注入する。有効な地図APIキーは不要。読み込み失敗/停滞/認証拒否でも一覧を使えることを検査。
- 詳細な設定と手動実演条件は[FRONTEND_HANDOFF.md](FRONTEND_HANDOFF.md)。test-resultsのe2e/maps/live/curated/unitを分離し、個人のChromeパスは環境変数だけに設定する。
