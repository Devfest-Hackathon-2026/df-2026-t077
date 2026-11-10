# 4人の共同開発

## ブランチ方針
mainから作業単位の短いbranchを作り、PRでmainへ戻します。今回の期間/人数ではdevを常設せず、二段階マージと同期作業を減らします。
mainは全員が動作確認できる統合先。未完成の画面を残す場合は明示的なstub/mockを使い、既存の経路を壊しません。

```text
main
 ├─ feat/a-trip-storage    → PR → main
 ├─ feat/b-planner         → PR → main
 ├─ feat/c-compare         → PR → main
 └─ feat/d-setup-form      → PR → main
```
人ごとの永続branchではなく、タスク単位で作り直します。
```bash
git switch main
git pull --ff-only
git switch -c feat/a-trip-storage
# 作業・検証後
git add <変更したファイル>
git commit -m "feat: add trip storage"
git push -u origin feat/a-trip-storage
```
GitHubでbase=mainのPRを作成。別の1人が確認し、チェック成功後にマージします。A/Bがbackend、C/Dがfrontendを相互レビューします。
他担当の変更を取り込む場合はcommit後に `git fetch origin` → `git merge origin/main`。未commit変更を失うreset/force pushは通常手順にしません。

## 共有ファイルの扱い
初回はSHARE_FILES.txtのファイルだけを登録します。以降は実装に必要な変更をPRへ含め、初回リストを恒久的な追跡制限にしません。
.env、鍵、token、依存フォルダー、生成されたdist/ログ/テスト結果はgitへ入れません。.env.exampleとlockfileを共有します。
schema/生成型/lockの変更は担当者と調整し、API意味の変更を単独で進めません。

## PRに書くこと
タスクと変更後の動作、検証コマンド/結果、他担当へ影響する契約、未接続の部分。
CIは実Google project/秘密キーを使わず型・テスト・buildを検査します。ブラウザ/実API/外部接続の確認は別途結果を記載します。
mainのPR必須/承認1人をGitHub上で設定できる場合は利用します。プラン上使えない場合も同じ運用をチームで守ります。

## 共有と提出
repository：https://github.com/mijumaru310/zurashitabi
Settings→Collaboratorsから他3人を招待し、各人が承認。これは所有者が行います。
運営の提出repositoryとは区別し、締切時の提出commitと資料をROADMAPに従って確定します。
