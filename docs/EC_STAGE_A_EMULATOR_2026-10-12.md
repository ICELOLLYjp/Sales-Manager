# 工程A追加検証 — 実Firestore Emulator

2026-10-12 JST。**導入不可・工程Bへ進行不可。3アプリ共通の競合/認可契約に残件があり、今回の範囲で片方だけを修正せず停止する。** 実環境操作、Rules配備、マージ、他リポジトリ変更は行っていない。

## 基準と今回の変更

- Sales-Manager main: `1c44320108f3db95dc13fe432899568bfdc57ab8`。
- [Draft PR #121](https://github.com/ICELOLLYjp/Sales-Manager/pull/121) 開始head: `8ed78d88e812d012b424b877de16d83f26ab42ca`。指定headから変更なし。
- Website main: `6d5971d75712b58baf73005a38cb13f79012c36e`。docs/WORKFLOW.mdの品質優先方針を確認。
- 参照のみ: T-shirts-Stock #41 head `4f87a7d61c6acd6e496f3324474d6d4a38201548`、Accessories #22 head `cd7107db45c1abe3ed8450cea72402b5a73f84b3`。
- 3アプリ共通モジュールのGit blobはすべて `1f4dda4a6d1700f4961a30f83e24ae3d60c4909d`。共通契約を再確認した。他リポジトリのコードは変更しない。
- 追加: `firebase.emulator.json`、`tests/emulator/` の固定依存・loader・実SDK試験・実行/証拠保存スクリプト、結果JSON、本報告。PROJECT_HANDOFF.md、工程A報告、.gitignoreを更新。
- **firestore.rules、アプリ/共通モジュール/サービスの本体は変更なし。** 特定の再試行/認可方針をSalesだけへ導入すると3アプリ共通契約と既存利用者へ影響する。広域修正へ独断で拡大しないという今回の停止条件を適用。

## 環境・証拠

Windows / Node 24.21.0 / Temurin Java 21.0.12.1 / firebase-tools 15.33.0 / Firestore Emulator 1.22.0 / Firebase JS SDK 11.0.2 / rules-unit-testing 4.0.1。

Emulator JAR SHA-256は公式CLIの期待値と実ファイルが一致: `9b6498b7f62714d67f48f59b3818883cd682dbcd46b9f59511de81c97bb5166c`。

固定 `demo-icelolly-stage-a`、`127.0.0.1:8085`。TCP断試験だけ8086から8085へ中継。架空SKU/売上/ユーザーのみ。通常firebase.jsonや実Firebase設定を読み込まず、Rulesだけ実Emulatorへロードした。Admin権限相当のfixture操作はEmulator内だけ。

実サービスのコードはそのまま実行し、DBの取得とgstaticのSDK importだけをテスト環境へ接続した。Node/npm版とブラウザCDN版の実行環境差は残る。業務ロジックのコピーやモックTransactionではない。[実行方法と注入箇所](../tests/emulator/README.md)。

最終実行 **2026-10-12 12:53 JST、32件中29 pass / 3 fail、exit 1**。29 passには危険な挙動の再現3件を含み、安全要件の成功は26件。失敗をskip/todo/期待成功に変換していない。[各ケース・ソースハッシュ・実行時刻JSON](evidence/stage-a-emulator-2026-10-12.json)。失敗の詳細は[診断抜粋](evidence/stage-a-emulator-2026-10-12.txt)。

旧CLI 14.22.0 / Emulator 1.19.8でも競合3件が失敗。最新公式CLIへ更新後も再現した。通常文書の対照試験C04は2要求・callback計3回で成功し、試験基盤がTransaction再試行自体を妨げていないことを確認した。既存隔離モック43件・構文21件はソース不変の既存記録として再利用し、今回成功した実認可試験と混同しない。無関係CIは再実行しない。

## Rulesの必須12項目

| 項目 | 判定 | 実測・限界 |
| --- | --- | --- |
| 1 未認証アクセス拒否 | 成功 | R01: 正本、receipt、業務文書、子文書の読書き拒否 |
| 2 認証済みの許可/拒否ユーザー区別 | **不合格** | R02: 無関係email・未確認email・匿名認証claimでも許可。UI許可リストをRulesが参照しない |
| 3 旧クライアント全体保存拒否 | 限定成功 | R03: protocol/revisionなしのset/updateを拒否。R09: 正しい次revisionを付けた全体上書きは許可 |
| 4 新Transaction更新 | 成功 | R04、C03、S01等。正本+receipt、実POS adapterが通常時に成功 |
| 5 revision不一致/飛び越し/再利用 | 成功 | R05、R11: 旧値、+2、負、文字、少数、誤protocol、不正な保存済revisionを拒否。欠落revisionは0→1 |
| 6 正本create/delete拒否 | 成功 | R06: master/shared両方。正本が存在しないときのcreateも拒否 |
| 7 receipt条件・重複・改ざん拒否 | 一部成功・欠陥あり | R07: 単独create、path/長さ/時刻/revision/余分field不正、既存receiptのset/update/delete拒否。R13: 任意64文字intent・複数新規receiptの同時付与は許可 |
| 8 正本とreceiptの原子性 | 成功（限定） | R07/R08: どちらかが拒否されるbatchは売上も含め全体不反映。R04: 正常な両方の保存を確認。receipt必須ではない |
| 9 競合時Transaction再試行 | **失敗** | C01: 同revisionを読む2要求のうち1要求はpermission-denied、callback総数2で再試行なし |
| 10 異SKU同時/同SKU競合 | **失敗** | C01: 異SKU両方保存の期待未達。C02: 一方拒否で上書きは防ぐがinventory-conflictではなくpermission-denied。S02: 2売上ID+重複IDの並列販売で1売上のみ成功 |
| 11 他matchによる抜け道 | 正本は成功・子文書は許可 | R03/R06/R10: 汎用matchは正本/receipt本体を許可しない。子文書には広いallowが残り任意書込可。子文書作成では親は更新されない |
| 12 既存認証/権限互換 | リポジトリ比較済・稼働版未検証 | mainもsignedInのみ。PRでその条件は維持。Sales/T-shirtsのUIは確認済emailの3アカウント制限。Accessoriesは認可拒否をRulesに依存。実稼働Rulesとの一致は未確認 |

R12はEmulatorのRules無効化操作がゲートを迂回することの確認。実Admin SDK/IAM/コンソールの経路を検査した証拠ではない。サーバーライブラリがRulesを迂回する点は[Firebase公式説明](https://firebase.google.com/docs/firestore/security/test-rules-emulator)を参照。

## Sales Manager結合試験

| 既存業務 | 結果・実関数の範囲 |
| --- | --- |
| 通常POS販売・売上取消 | S01成功。commitQuickSale/voidSaleTransaction、同ID重複、売上・lock・在庫revisionを確認。S12はTシャツとアクセサリー混在の販売/取消 |
| 同時販売・同一売上二重減算 | S02失敗。通常の連続再送ではS01成功。並列ではpermission-deniedにより未反映売上が残る。成功していない売上を消失扱いせず同IDで照合する必要あり |
| イベント終了精算 | S05成功。exact SKU販売済分を再減算せずlossのみ減算、再終了でも不変 |
| 保留状態での終了 | S06成功。closeEventWithPendingInventory、特定済lossだけ反映、未計数SKU ID保持、二重終了防止 |
| 未特定を残す終了・後日確定 | S07成功。closeEventWithUnidentified→resolveClosedQuickGroupToSku、特定前はそのSKUを減算せず、後日1回だけ減算し未解決数0、重複要求拒否 |
| 金額売上からSKU配賦 | S08成功。classifyFastAmountToSkuと同配賦の再送。金額売上作成は架空fixtureであり実作成UIは対象外 |
| 実数棚卸と販売の競合 | S03成功。古いbaselineのsaveTshirtPhysicalStock拒否。S11は正常保存後に販売し、receipt再送で巻き戻さない |
| opening/closing/resetと販売 | S09の3件成功。各実関数の検証後・Transaction開始前に実POS売上を入れ、session変更を検出して拒否 |
| 通信断・応答消失・再送 | S10成功。TCP断前後の未反映/復旧後同ID一度だけ反映。S04成功。実コミット後の応答エラー注入+後続売上+同receipt再送で巻戻しなし。iPhone/ブラウザの保存キューは未検証 |
| 不正な正本状態での原子性 | S13成功。正本不在の販売が売上/lockを残さない |

各サービスの代表経路を通した結果であり、全カテゴリ・全未登録SKU・大量SKU・全閉店分岐を網羅したとは扱わない。実ブラウザ/キューUI、棚卸入力開始前からの全操作、Authログイン、実稼働IAMは未検証。

## 発見事項と必要な修正方針

### A-EMU-1: 競合時の拒否がSDKの自動再試行にならない（導入阻害）

同じ正本を読んだ2更新で後着がpermission-denied。EmulatorログにはinventoryStepのresource.data評価のNull value errorを含む。C01は2要求・callback計2回、revision1で止まる。C04の一般文書ではcallback計3回で両方保存される。Firebase 11.0.2のTransactionRunnerはpermission-deniedを再試行しない。**エミュレーターの詳細な内部原因や本番で同一エラーになることまでは確定していない**が、この組合せで工程Aの必要条件を満たさない事実は確定。

必要な次作業: 最小再現とRules/precondition評価順を切り分け、3アプリ共通saveInventoryEditとSales adapterの両方で安全な対応を設計する。もし限定的な再試行を採るなら、最新revisionの変化を確認し、元の不変baseline・operationId/売上IDを保持し、最大回数を制限し、真の権限拒否を無限再送しない。異SKU両保存・同SKU競合通知・同ID重複・権限剥奪の試験を3アプリで通す。単にRulesを緩める、permission-deniedを無条件retry、baselineを最新値へ差し替える変更は禁止。

### A-EMU-2: 利用者の認可がリポジトリRulesにない（導入阻害）

allowedUser()はsignedInのみ。Sales/T-shirts UIの許可メール+emailVerified制限はAPI呼出を防げない。Accessoriesを含む稼働利用者/Rulesの一覧が未確認なので、Salesの3メールを推測で全コレクションへ強制する修正はしていない。稼働Rulesを別途承認された読取で取得・保存・比較し、既存のユーザー/役割条件を落とさずA1を統合し、実際の許可/拒否ケースをEmulatorへ移す必要がある。

### A-EMU-3: A1はクライアント版・処理内容の認証ではない

R09はsetDocにprotocol1/次revisionを付けるだけでinventory_v2を空にしmastersも消せた。revisionは秘密でもクライアントの署名でもなく、RulesはTransaction使用や三者比較を証明しない。**変更していない旧版**は遮断できるが、書込権限を持つ想定外クライアントの不正内容は防げない。

receiptなしの正本更新は許可され、既存POS/取消/終了/配賦はtransactionLocksや既存解決記録によって冪等化している。receiptを今すぐ一律必須にするとそれらを壊す。receiptは任意intentの真正性をRulesが検算しておらず、R13で1回の正本更新に複数receiptを添付できる。ランダムIDは衝突を減らすが認可の代わりではない。

必要な判断: A1を信頼済み操作者の競合対策として限定するか、想定外の書込主体まで防ぐためにサーバー側更新経路/検証済み操作との結合を導入するかを明確にする。後者は3アプリ契約の変更となり今回の範囲外。receiptの形だけを厳しくしてA-EMU-3を解決済みにしない。

### Admin等の残る境界

今回確認したfunctions/index.jsに正本パスの直接書込は見当たらないという前回の調査と矛盾なし。ただし動的パス・他リポジトリ・外部ジョブ・Cloud Functions配備済コード・IAM・コンソール・復元は未監査。RulesではAdmin SDKを止められない。正本を更新する全主体の登録、同一契約、復元時のrevision/receipt/売上整合確認が必要。

## 旧版遮断・3アプリ切替の手順案（今回は実行しない）

**開始条件**: A-EMU-1/2/3の対応と許容範囲を確定し、対象Rules・3配布物のSHAを固定、実稼働Rules/IAMとの差分、実機試験を完了、別途導入承認を取得。現時点では開始不可。

1. 全端末・古いブラウザタブ・iPhoneホーム画面アプリ・担当者・自動ジョブを台帳化。全販売/取消/棚卸/制作/終了/配賦を運用停止。正本2文書だけのwrite denyでは金額/未特定販売やsession編集まで止まらないため、承認済み停止Rulesは関連業務書込も対象とし、Admin主体は別途停止する。
2. 端末ごとに未送信POSキュー `icelolly-sales-offline-queue-v1` と未保存編集を退避。transactionId、sessionId、数量、確定状態を一覧化し、既存salesTransactions/transactionLocksと照合。未確認キューが1件でもあれば再開不可。退避前にキャッシュ・サイトデータを削除しない。
3. 制御できる端末だけで必要な旧キュー同期を終え、全書込停止ゲートを適用・拒否を確認する。取り残したオフライン端末は隔離を維持。旧クライアントの自動再送が起きない状態を確認してから3アプリを一括切替する。
4. 停止ゲート中に承認済み3配布物と最終Rulesを用意し、停止を解除しないまま更新/読取検査。Sales SWのcache名だけで完了としない。全タブの再読込、Service Workerのactive/controller、依存module、配布SHAを照合。skipWaiting/clients.claimは既存ページ内のJavaScriptを置き換えない。
5. 端末・キューの照合が済んだ範囲で最終Rulesへ切替え、承認された最小受入れ操作を行う。成功済売上IDは再作成しない。未反映分を同じIDで再送し、売上・lock・movement・正本revisionを照合してから運用再開。利用者全員の更新が確認できなければ停止を維持。
6. permission-denied増加、revision/数量差異、版不一致、未確認キュー、解釈不能なreceipt、Admin更新を発見したら全書込を再停止。受付済売上と未反映売上をIDで照合し、二重会計を作らない。

**復旧**: 認可・停止ゲートを維持して修正版へ進む。旧版を表示用へ戻す場合も書込を再開しない。revision条件だけを外して旧版を通さない。snapshot復元は売上・receiptと不整合になるため独断で実施せず、対象更新を照合した補正計画を承認後に実行する。データ復元・実在庫補正は今回の範囲外。

## 実機で残る試験

| 対象 | 手順と合格条件 |
| --- | --- |
| 開いたままの旧タブ | 独立した非本番環境に旧版を置き、新Rules適用後に旧set/updateを試す。正本不変・エラー表示・未保存値退避・新版再読込を確認 |
| iPhoneホーム画面 | 旧版をインストールしオフライン入力→切替→復帰。タブ/ホーム画面双方の版・同ID再送・一度だけ反映を確認 |
| Service Workerキャッシュ | module取得失敗、途中更新、オフライン起動を試す。cache.add失敗が握り潰され、ignoreSearchで旧キャッシュが使われ得るため、キャッシュ名だけで合格にしない |
| POSキュー | 成功応答消失/未送信/業務拒否を混在させ、失敗項目を残して後続同期が止まること、更新後に元IDで照合・再送できることを確認 |
| 利用者エラー | Salesの現状は「未同期会計を同期できませんでした: permission-denied」等。3アプリで「保存されていない・販売停止・再読込・管理者へ連絡」が理解できるか確認 |
| 旧T-shirtsの案内 | 接続拒否時に「Firestoreルールで読み書きを許可してください」と案内するコードが残る。この案内に従ってRulesを緩めない運用説明が必要。別リポジトリのUI修正は次の許可範囲で行う |

ブラウザ実機、Googleログイン、稼働Rules/IAM、Accessories SDK12.18.0、外部Admin経路は成功扱いしない。Emulatorは本番のすべての制限や索引等を再現しない。[Firebase公式Emulator説明](https://firebase.google.com/docs/emulator-suite/connect_firestore)。

## 次回の入口と工程B条件

次回はPR #121の最新head、本書と結果JSON、C01/C02/S02の3失敗から再開する。全履歴や成功済み無関係CIを調べ直さない。次の修正対象を3アプリ共通契約まで広げる承認を得てから、共通再試行・認可/信頼境界を確定し、影響するEmulator/実機検証を通す。

工程Bへ進む条件は、工程Aの阻害事項解消、稼働Rules/IAMと全書込主体の確認、旧端末/キュー/切替/復旧の実機受入れ、工程A導入の別途承認と導入結果確認、工程B着手の別途承認。今回、工程Aの実環境反映も工程Bの実装も行わず停止する。
