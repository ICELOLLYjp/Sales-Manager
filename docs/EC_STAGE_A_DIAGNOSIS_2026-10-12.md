# 工程A 原因切分け・隔離検証

2026-10-12 JST。**診断完了、製品の不具合は未修正。工程A配備不可・工程B着手不可。方式選択待ちで停止。**

## 範囲と基準

最新ユーザー指示とWebsite Draft #22の再開指示に従い、製品コード・Rules・3アプリ共通契約を変更せず、隔離検証と設計比較だけを実施した。RFCは未承認の提案として扱う。

| 対象 | 開始時に再取得したhead / main |
| --- | --- |
| Sales #121 | `e386f206b13baeeb5a03d7e7ed024119ae1dfd86` / `1c44320108f3db95dc13fe432899568bfdc57ab8` |
| T-shirts #41 | `4f87a7d61c6acd6e496f3324474d6d4a38201548` / `d39c818fccd57de304812d8188a51a068ab68a36` |
| Accessories #22 | `cd7107db45c1abe3ed8450cea72402b5a73f84b3` / `366205b677e6997c5e1a6a3852e0ef44fd336d9b` |
| Website #20（参照のみ） | `6993008abff894984f887576cb421536059c6727`（baseはPR #19） |
| Website #22 | `bde91a7dfa5d780b6e50b7f4e0de3e2ef22dca65` / `6d5971d75712b58baf73005a38cb13f79012c36e` |

各引継ぎ・Website WORKFLOW・RFCを確認。3アプリの共通モジュールは再照合でもGit blob `1f4dda4a6d1700f4961a30f83e24ae3d60c4909d` で一致。**同じ未解決契約が一致しているのであり、安全性の合格ではない。** T-shirts / Accessoriesには変更なし。

## VERIFIED：再実行

前回の[報告](EC_STAGE_A_EMULATOR_2026-10-12.md)・[JSON](evidence/stage-a-emulator-2026-10-12.json)は上書きせず正本として保持。

- 既存32件を19:00 JSTに再実行：安全合格26、失敗3、危険許可再現3、exit 1。C01/C02/S02の安全要件は今回も失敗。R02/R09/R13は危険を再現。skip/期待失敗への変換なし。
- [再実行JSON](evidence/stage-a-emulator-rerun-2026-10-12.json)、[TAP](evidence/stage-a-emulator-rerun-2026-10-12.tap)。通常POS・取消・終了・後日配賦・TCP断/復旧などの既存代表ケースも同じ結果。
- 既存モック43件・構文21件は製品ソース不変につき記録を再利用。無関係CIは実行しない。
- 追加：11条件の最小競合実験、3件の設計プローブ。これは14件の安全合格という意味ではない。
- Windows、Node 24.21.0、Java 21.0.12.1、Firebase 11.0.2、rules-unit-testing 4.0.1、Emulator 1.22.0。JAR SHA256は `9b6498b7f62714d67f48f59b3818883cd682dbcd46b9f59511de81c97bb5166c` と再照合。
- 固定 `demo-icelolly-stage-a` / `127.0.0.1:8085`。架空データだけ。危険な対照RulesはこのEmulator内だけにロードし、診断後はリポジトリRulesへ戻す。実環境設定・利用者UID・IAMは取得していない。

## VERIFIED：競合の最小再現

[スクリプト](../tests/emulator/diagnose-concurrency.mjs) / [11条件のJSON](evidence/stage-a-diagnostic-2026-10-12.json)。SDKに直接接続し、アプリadapter・receipt・売上・mergeEditを使わない。2つのTransactionに同じ版を読ませ、先行commitの完了後に後着をcommitする。通常ケースと同じSDKのupdateTime preconditionを使う。

| 条件 | callback回数（先行,後着） | 結果 |
| --- | --- | --- |
| D01 元のRules | 1,1 | 後着permission-denied、revision 1 |
| D02 update許可のみ / D03 write許可のみ | 1,2 | SDKが後着を再試行、revision 2 |
| D04 updateでrevision比較のみ | 1,1 | 後着permission-denied |
| D05 writeでrevision比較 / D06 resource nullガード / D07 明示get比較 | 各1,1 | いずれも後着permission-denied |
| D08 protocolのみ確認 | 1,2 | SDK再試行、revision 2（安全な修正ではない） |
| D09 updateのrevision比較＋create許可 | 1,1 | 後着permission-denied。create拒否だけが原因ではない |
| D10 D02と同じ、SDK maxAttempts=1 | 1,1 | 後着failed-precondition、stored versionとbase version不一致 |
| D11 revision比較、順次処理 | 1,1 | 両方成功、revision 2 |

**確定した因果範囲**：このEmulator/SDK組合せでは、古い版のcommitに対するrevision制約のRules拒否が、SDKが再試行できるprecondition失敗より先に表面化する。receipt・POS固有コードがなくても再現し、正常な順次更新は成立する。SDKが競合を再試行できない一般的な基盤障害ではない。

固定npm SDKの `@firebase/firestore/dist/index.node.cjs.js` を確認：`Transaction.preconditionForUpdate` は読取updateTimeを指定（26940行付近）。`TransactionRunner.isRetryableTransactionError`（27062行付近）はaborted/failed-precondition/already-exists等を再試行。`isPermanentError`（7809行付近）はpermission-deniedを恒久エラーとする。したがって実際に受けたpermission-deniedを再試行しないのはSDKの定義どおり。

**未確定**：Rules評価時のNull value errorの内部生成過程、本番サービスで同じ評価順・同じエラーになるか。ログにはRules `DefaultEmulatorRulesAuthorizer.checkCommit` と、対照の `FirestoreEmulatorConverters.checkMutation` による版不一致があるが、Emulator内部をソースデバッグした証拠ではない。Firebase本番のバグ、SDKのバグと断定しない。

**採用しない対応**：revision条件の除去、無条件permission-denied retry、元baselineの更新、売上ID再採番。revision変化の観測だけでも、同時に権限剥奪や別文書の拒否が起きた場合の原因識別にはならない。限定retryも今回実装・採用しない。

## VERIFIED：認可・更新内容

[プローブ](../tests/emulator/diagnose-security.mjs) / [結果JSON](evidence/stage-a-security-diagnostic-2026-10-12.json)。3プローブともassertionは成立したが、P01/P03は危険の再現である。

| 項目 | 原因と今回の確認 |
| --- | --- |
| R02 | allowedUserはsignedInのみ。Sales/T-shirtsのUIの3確認済みメール制限はSDK直呼出を制約しない。AccessoriesはGoogle認証とRules拒否に依存。mainの広い許可も確認 |
| P02 | 架空のbusiness/personal/backup 3 UID＋verified条件で3名とも更新成功。部外者・未確認・匿名claimの3コンテキストは正本/receipt/売上/子文書のread/writeを拒否。これは方式の成立例のみ。実UIDへの対応・稼働統合の証明ではない |
| R09 | revision/protocolは公開値。正しい次revisionを添えたsetによる全体消去が通る。RulesはTransactionや正しいUIを使ったことを証明しない |
| P01 | affectedKeysをinventory_v2/revision/protocolだけに制限しても、inventory_v2={}が通る。masters保護とSKU全消去防止は別条件 |
| R13 | receiptは任意64文字intentを許可し、実際の差分との対応・1更新対1receiptを証明しない。複数receiptを付けられる |
| P03 | 既知operationIdと予定入力から正しいSHA256を計算し、別SKU更新にそのreceiptを添付。後続saveInventoryEditは意図一致と判断して本来の編集を適用せず正常終了した。a=5のまま（予定4）、別SKU b=7、revision1。ランダムIDの推測成功を主張する試験ではない |

receiptの必須化だけで解決しない。POSは既存transactionLocks等による冪等性でreceiptを使わない。無条件必須化すると既存販売・取消・終了・配賦を壊す。現在の広いRulesでは売上・lock・movement等も信頼済みとはみなせない。

## PROPOSED / OPEN：次の判断

方式比較の詳細はWebsite #22の `docs/EC_STAGE_A_DESIGN_REVIEW_20261012.md` に記録する。**操作別サーバーAPI＋クライアントから正本および効果関連文書への直接書込禁止を推奨するが、未承認・未実装。** 単なる任意patch受信API、receipt署名追加、在庫だけを後追いするtriggerは推奨しない。

3つの実UID・確認状態、稼働Rules/IAM、Admin書込主体、既存Functionsの配備状態/地域/費用、旧ブラウザ/iPhone/未送信キュー、隔離復元はOPEN。本人の3アカウント同等権限を維持し、推測の許可者設定を行わない。

工程Aの配備は不可。工程B着手も不可。新方式の限定実装は方式承認後の別作業。本番・実在庫・POS・注文・決済・WordPress/WPVibe・配備・マージは未操作。

## 再現手順

既存READMEの専用Emulatorを起動し、他テストと同時実行しない。すべてリポジトリrootで実行する。

```powershell
$env:FIRESTORE_EMULATOR_HOST='127.0.0.1:8085'
node tests/emulator/run.mjs                    # 未修正なのでexit 1を維持
node tests/emulator/diagnose-concurrency.mjs   # 観測記録。exit 0は安全合格ではない
node tests/emulator/diagnose-security.mjs      # 危険再現＋架空認可案のみ
```

JSONはtests/emulator/artifactsへ生成。証拠保存前に元試験と診断プローブを区別する。外部ホスト指定はスクリプトが拒否する。
