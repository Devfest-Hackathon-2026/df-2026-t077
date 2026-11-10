# 画面・日英・状態

## P0画面
| URL | owner | 役割 |
|---|---|---|
| /plan/new | D | 入力、希望整理、本人確認 |
| /trips/:tripId/compare?proposalId=:proposalId | C | 元案/最大2案、Why、採用 |
| /trips/:tripId | C | 採用旅程、地図、時刻表、再提案導線 |
| / | D | /plan/newへ |
| その他 | D | NotFound |
旅行中routeはP0で作らない。Whyはdrawerで、新しい独立画面を増やさない。

## 日英
ja/en切替を常時見つけられる位置に置く。国旗で言語を表現しない。固定UI、入力ラベル、エラー、不成立、確認文、根拠ラベル、Why、主要Spot説明を両言語で揃える。
Tripの数値・時刻・ID・mustを言語切替で変えない。locale以外の条件変更を勝手に行わない。
既存Proposalの原文は生成時のlocaleのまま保存。既知の定型警告/FactはUI言語に合わせて表示し、保存する文章・数値・IDは変えない。翻訳できないAI文章は原文を開ける形で残し、使える場合は保存Factに基づく要約であることを明示。「この言語で再提案」は本人操作と条件確認で実行し、単なる切替で自動再生成しない。
Spotは日英両フィールドを取得して表示。英語未確認のSpotはP0の主要推薦対象へ入れない。
日時は日本時間と明示。海外端末のtimezoneで旅行日がずれないよう、フォーム→API変換を1か所にする。

## 入力と本人確認
日付、開始/終了、起終点、歩行上限、好み、訪問候補、must、固定時刻を入力。本人が行きたい場所自体と、体験だけ満たせばよいoptionalを区別する。
初期の数値はチームの便宜的な値と分かるUIにする。本人が未確認のAI提案を確定値として送らない。
自由文は任意。「AIで希望を整理」ボタンでinterpret。原文と読み取り結果を並べ、編集・確認できる。既存の手入力と矛盾するものは自動上書きしない。
曖昧な「少ししか歩けない」は距離入力へ案内。不明場所は候補から選び直す。AIがない場合もフォームで継続できる。
wait_assumptionsは最大2施設。本人確認値/仮定の選択、分入力、本人確認値には確認日時を表示。未入力でも進める。未知と0分を区別。
avoid_windowsは対象施設/開始/終了と、本人希望またはdemoを区別。確認済みguidanceはserverの許可した根拠から選び、任意URLを確認済みにしない。
入力が多くならないよう、基本条件を先にし、時間帯/待ち時間/固定時刻は必要時に開く。サンプル条件の読み込みと通常入力を明確に分ける。
訪問数の上限と行きたい場所（お任せ行を含む）の件数を入力中に比べる。上限を超えたら件数入りの案内を場所一覧の下と上限欄の下に出し、「条件を確認する」で場所一覧の下の案内へフォーカスする。上限に足りない分は本人の選んだ行を変えずにomakase_visitsへ加え（お任せは合計最大3件）、入力中の案内・右の要約・確認画面で「お任せ（自動で追加）」と示す。要約の「/ 6」はシステムの最大件数で、本人の上限ではない。
submit前に「この条件で提案」を確認してintent_confirmed=true。raw自由文はTripへ永続保存しない。

## 比較カード
元案＋時間案＋場所案、最大3枚。同じ単位・指標順で表示。
必須保持、訪問先、時刻変更、交換した場所、徒歩距離、帰着余裕、失う体験、根拠/仮定/不明、Why、採用を表示。
crowd不明を緑の空き表示にしない。口コミの少なさで穴場認定しない。場所以外の魅力の一致を具体的に示す。
待ち時間未算入施設がある場合、queue差の短縮表示は比較不可。元案nullなら元案不成立理由を表示し、不正な改善率・元案採用ボタンを出さない。
時間変更の理由が本人の回避希望ならその通り表示し、実混雑が減ったと翻訳しない。
送信中は同期ロックとボタン無効化で二重採用を抑止。同じ採用操作の再試行は同じbody/keyを使い、別案を送らない。採用成功後はGET Trip→採用画面。VERSION_CONFLICT/MODE_CONFLICTは最新Tripを取得して本人が再確認し、REQUEST_IN_PROGRESSは同一操作を再送可能にする。IDEMPOTENCY_KEY_REUSEDはpayload不一致として再送せず、404はアクセス不可として内容を推測しない。

## 地図と時刻表
マーカー番号/stop ID/時刻表を一致。arrival（到着）、start（訪問開始）、departure（退場）、移動、余裕、待機内訳を分ける。
polyline未取得なら点線の訪問順と「経路の概略」を表示。道路に沿った経路と誤認させない。
Maps失敗でも時刻表/Spot詳細/採用を継続。情報源の帰属を隠さない。
Spot詳細は日英の魅力、料金/予約/利用ルール、出典と確認日。不明をAIで補完しない。

## Whyと再提案
WhyPanel propsはplan/evidence/effectiveConstraints/onRefine/onClose。ComparePage/TripPageが開閉とRefineFormへの切替を管理し、同時に開くdrawerは1つ。採用旅程の操作はTripPageに置き、Shellに重複入口を作らない。
理由、不利益、不確実性、Factの出典と確認日を表示。Fact IDは表示側でも解決し、不明参照は警告・省略。
比較からはRefineFormへexpectedVersion=Proposal.base_versionも渡す。最新Tripと異なる古い案の条件は、最新状態を再取得して本人確認する。
変更可能項目は歩行上限、好み、終了時刻、回避窓、待ち時間、説明locale。必須の解除や予約移動を裏で行わない。
再提案失敗・却下で現在の採用旅程を保持。初回のTrip作成後に生成が失敗したら、Tripを再作成せず生成だけ再試行。

## 状態とAPI境界
TanStack QueryがSpot/Trip/Proposalの正本取得を管理。フォームはReact Hook Form、ページの選択/Why開閉はlocal state、proposalIdはURL。localStorageに別の採用正本を作らない。
所有者が変われば個人cacheをclear。POSTを無条件自動再試行しない。再試行は同key。401のtoken更新は1回まで。
loading/empty/no_feasible/partial/error/offline/409を日英で扱う。架空の進捗%は出さない。
http/https外部リンクのみ、noopener/noreferrer、HTMLの危険な挿入をしない。主要ボタン44px程度、360px幅、keyboard/focus/drawer復帰を確認。

## mock
A-00後のv3サンプルを使いnormal/time_shift/place_shift/unknown/partial/no_feasible/conflict/intent_ambiguousを日英で表示する。
MSWの固定fixtureが任意入力の最適化を実行しているように見せない。未処理APIを実環境へ流さない。実backend一巡後に結合完了とする。

## 11/10 C/Dフロント引継ぎ
実装・検証結果・名古屋実データの操作手順・公開前の確認は[FRONTEND_HANDOFF.md](FRONTEND_HANDOFF.md)。表示言語はUI設定だけをlocalStorageへ保持し、採用正本は引き続きGET Trip。

公開版の言語混在・実操作検査の記録：[FRONTEND_DEBUG_20261110.md](FRONTEND_DEBUG_20261110.md)。
