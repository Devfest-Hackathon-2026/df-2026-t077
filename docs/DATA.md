# 実施設データ・認証・GCP

## 今回の接続方針
frontend=Firebase Hosting、backend=Cloud Run、保存=Firestore、本人確認=Firebase匿名認証。
Geminiは配布クレジットの案内に合わせVertex AI経由を第一候補とする。Google Gen AI SDKを採用時に公式資料で確認する。Cloud Run実行サービスアカウントで必要権限を付与し、秘密鍵ファイルを配布しない。モデル名・地域・quotaはA/Bで実際に確認して固定。
GCP project/billing/IAMはAが中身を担当、Dが共有手順を整理。全員のbackend環境をDが代わりに構築する計画にしない。
有料混雑APIは必須依存から外す。配布クレジットでGoogle Maps等のすべての費用が賄えると推測しない。

## 情報源
実施設の候補は名古屋観光公式・施設公式・公開の地域/商店街情報から発見する。一般公開されていることと、文章/画像/データの再利用許諾は別。
Spot8〜12件を初期対象。独自の短い紹介文を人が確認し、出典と確認日を残す。利用許諾のない写真は使わず、写真数を完成条件にしない。
名前（日英）、入口座標、体験タグ、営業/休業/最終入館、料金、予約条件、訪問目安、確認日、注意点を整理。英語名は公式または確認済み表記。
名古屋城周辺は候補。施設同士の距離と魅力の違いを確認してからDがエリアを固定。城と大須等を無条件に同一の狭い徒歩エリアへまとめない。

## 知られていない魅力
「本人が知らなかった」「未選択の候補」と、客観的な知名度の低さを区別。受入施設の魅力と本人の希望の対応を説明する。
静けさのタグは施設の性質/確認済み紹介の情報であり、現在の混雑保証ではない。住宅地/私有地/受入条件不明の場所へ大量誘導しない。
P0に口コミスクレイピング、ユーザー投稿審査、未知Spotの自動公開はない。

## 時間帯・待ち時間
本人の避けたい時間帯と、本人確認した待ち時間/仮定を使う。serverに確認済みで登録したguidanceがあれば出典・適用日・地域を検証して利用。
Googleの混雑グラフ表示とbackendの数値取得は別。WebページのグラフやDOMを自動取得してprovider完成としない。
名古屋城公式の待ち時間は候補情報源であり、再利用/取得条件は未確定。自動接続を必須にしない。未許可データを再配布しない。
京都のデータ提供は参考候補で、今回名古屋で使用できるデータではない。フォームの存在だけで無料利用・再配布を確定しない。
未入力waitはunknown、現在観測値を将来値として断定しない。架空の時刻別曲線を実測・学習予測と称さない。

## モード
| mode | 用途と表示 |
|---|---|
| UI mock | v3固定サンプル、mock auth、開発バナー。backend不要 |
| local demo | 実HTTP、Auth/Firestore emulator、架空Spot/仮定を明示 |
| staging demo | 実認証/DB/API、demo dataまたは仮想条件を明示、Gemini接続の検証 |
| curated pilot | 確認済み実施設/経路と本人の条件。混雑不明/仮定のラベルを保持 |
live障害からdemoへ自動fallbackしない。モード・source_kind・is_demoをUIまで保持。実施設の利用と混雑仮定の使用をそれぞれ個別に表示し、全部実データと称さない。

## 保存と認可
Firestore collectionsはspots、evidence、trips/{id}、trips/{id}/proposals/{id}、idempotency、generation_leases。Proposalはimmutable。
Trip/Proposalの公開DTOと保存モデルを分離し、内部owner_uid/期限/保存条件をserver側で保持。
すべての資源取得/採用で検証済みuidとownerを比較。他人は404。clientからowner_uidを受け取らない。
Firestore client読み書きはdeny。Admin SDKはsecurity rulesを迂回するため、API/repositoryでの所有権検証が必須。
raw希望文・token・秘密鍵・不要な位置履歴を永続保存/ログ出力しない。アンケートの連絡先をTripデータと結合しない。

## 外部情報の保存
徒歩経路（A-05）：data/curated/route-points.json（12地点の入口/代表点、座標の出典つき）→ scripts/fetch_route_matrix.py（ADC、APIキーなし）→ data/curated/routes.json（全順序対132件）。backend/app/repositories/routes.pyがRouteEstimateへ変換する。出典はGoogle Maps Routes API（2026-11-09取得、source_kind=estimated、帰属表示「Google Maps」）。Googleの規約は経路結果のキャッシュを制限しており、チームの判断でハッカソンのデモ用に限り1回分を保存する。PersistenceHint.persistable=false、大会終了後に routes.json を削除する。著作物利用シートに記載し、画面に「経路：Google Maps」を表示する。
生成したProposal（trips/{id}/proposals/{id}）は、各legの徒歩時間・距離としてこの経路結果を含んだままFirestoreへ保存される（再読込・採用・採用旅程の表示に必要なため）。これもハッカソンのデモ用に限った保存とし、大会終了後に routes.json と併せて、Firestoreのtrips（proposals含む）・idempotency・generation_leasesを削除する。
DATA_MODE=demoの架空Spotには、backend/app/repositories/routes.pyのDemoRouteCatalogが架空座標の直線距離×1.3・秒速1.2mの仮定legを全順序対で作る。source_kind=demo、根拠は架空Spotのdemo-evidenceで、実際の徒歩経路ではない。実Spotには使わない。
PersistenceHintはpersistable/expires_at/required_attribution/provider/reference。
APIからの生responseを丸ごと保存しない。計算した旅程や時刻表も元情報の条件を確認する。保存許諾を満たせないadapterはその保存用途へ有効化しない。
期限切れの情報は採用前に確認し、新しい条件なら新Proposalを作る。保存した過去Proposalを黙って更新しない。
source_urlは根拠へのリンクで、外部コンテンツ自体を再配布する権利を意味しない。
全Spotの全組合せを毎回照会しない。必要な経路対を絞り、並列数/timeout/再利用条件を管理。直線を徒歩経路と偽らない。

## 環境設定（雛形を準備済み、実クラウド未接続）
.env.exampleとsetupを準備済み。現在はdemo projectとlocalhostのみ。docs/DEVELOPMENT.mdとDEVELOPMENT.mdを参照。以下はアプリ実装時に読み込み・検証を揃える。
backend：APP_ENV、DATA_MODE、GCP_PROJECT_ID、GCP_LOCATION、GEMINI_MODEL、CORS_ORIGINS、GENERATION_TIMEOUT_SECONDS、PORT、FIREBASE_AUTH_EMULATOR_HOST、FIRESTORE_EMULATOR_HOST、必要なserver用MAPS_API_KEY。
Vertex AIはGCP_PROJECT_ID/GCP_LOCATION/GEMINI_MODEL（backend/app/core/settings.py）をSDKへ明示的に渡す。GOOGLE_CLOUD_*は使わない。認証はlocalがADC、Cloud Runが実行サービスアカウントで、鍵JSONは作らない。Developer API（APIキー）と混同しない。
location=global、model=gemini-3.8-flash（2026-11-09にB-00 probeで疎通確認。asia-northeast1は同モデル未提供で404、gemini-2.5-proは提供終了で404）。Firestoreのasia-northeast1とは別設定。
実project：zurashitabi（Firestore asia-northeast1）。Cloud Run実行SA：zurashitabi-api@zurashitabi.iam.gserviceaccount.com。リポジトリの既定値はdemo/emulatorのままにし、実値は各自のbackend/.envとCloud Runのenvにだけ置く。Firebase CLIの実projectはalias prod。
frontend：VITE_API_BASE_URL、VITE_USE_MOCKS、VITE_MOCK_SCENARIO、VITE_USE_FIREBASE_EMULATORS、VITE_FIREBASE_*、VITE_GOOGLE_MAPS_API_KEY。
VITEは公開値。server秘密情報を置かない。Mapsのbrowser用/server用キーを分離・制限。
productionでemulator指定があれば起動失敗。任意Bearerの認証バイパス禁止。

## 配信・費用・障害
初日に最小のCloud Run/Hosting疎通とGemini疎通を行う。その後機能を結合する。全機能完成まで配信確認を待たない。
Cloud Runは0.0.0.0:$PORT、SPAはindex.htmlへのrewrite、CORSは正確なfrontend origin。Firebase ID tokenとCloud Run IAM tokenを区別。
予算通知とprovider quota、max instances等を使い、予算通知を強制停止上限と誤解しない。残額と審査期間の稼働を確認。
生成の目標15秒、共通deadline初期25秒。intentも期限と同時実行数を制限。説明失敗で有効Planを捨てない。
uid別の共有生成leaseとidempotencyを設計し、プロセス内dictを全instance共通の永続正本にしない。外部呼出をFirestore transaction内で行わない。
CIは外部課金呼出なしで契約/制約/認可/日英一巡を確認。最終提出先の運営repositoryではActionsが使えない可能性があるため、開発repoで検証し最終成果物を指定先へ反映する計画。
