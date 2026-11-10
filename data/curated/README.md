# 実施設データの共同作業

spots.json に名古屋中心部（area_id=nagoya-central、名古屋城・栄・大須）の12地点を登録済み（2026-11-09、AI調査のうえチーム確認）。営業時間は通常の平日（基準日2026-11-05）の値で、臨時休業や工事は各visitor_infoに記載。DATA_MODE=curatedでbackend/app/repositories/spots.pyのCuratedSpotCatalogが読み込む。曜日・年末年始の定休日はclosures.jsonに置き、その日はclosedとして返す（祝日の例外や臨時休業は扱わず、visitor_infoに記載）。
形式はSpotListResponse（items/evidence）です。手書きの別schemaを作らず、backend/app/schemas/contracts.pyを正本にします。

入力前に決める項目：独自ID、1徒歩エリア、起終点、必須候補・任意候補・交換候補。
各Spotは日英の名称/独自紹介/利用上の注意、入口座標、体験タグ、滞在目安、対象日の営業区間、予約条件、is_demo=false、根拠IDを持ちます。
Evidenceには出典URLと実際の確認日を記録します。コピーする文章/写真/APIデータの利用条件は人が確認してください。
名称の知名度、現在の混雑、徒歩経路の正確さ、再利用権はこのスクリプトでは検証できません。

検査：
```powershell
npm run data:check -- data/curated/spots.json --visit-date 2026-11-05
```
最初の少数候補での確認には --min-spots 4 などを追加できます。完成時の目安は8〜12件です。
定義を調べる場合：
```powershell
npm run data:check -- --schema
```
検査は別日付、架空データの混入、根拠/日英fieldの欠落、営業や予約の未確認を発見します。日時とJSONの形式確認を、実際の営業確認の代わりにしないでください。
徒歩経路はA/BのRouteEstimate/PersistenceHintで別途扱い、直線距離を実際の徒歩経路と表示しないこと。

## 徒歩経路
route-points.json の地点IDは spots.json のIDと一致させます。地点や入口座標を変えたら、ADC でログインした A が `backend/.venv/Scripts/python.exe scripts/fetch_route_matrix.py` を再実行して routes.json を作り直します。
routes.json は Google Maps の推定値（デモ用、大会後に削除）です。直線距離で代用しないでください。
