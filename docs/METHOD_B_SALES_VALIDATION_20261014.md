# 隔離販売API：実装・検証記録

2026-10-14 JST。ユーザーが[最小仕様](METHOD_B_SALES_MINIMUM_SPEC_20261014.md)の実装とEmulator試験を承認。開始head `dc8f14a`。第1保存点 `1d4cb44` は検証前の実装途中としてpushした。本書はその後の限定検証を記録する。

最終実装・試験・証拠は `96fb26b` に保存・push済み。最終ソースhashがJSONと一致することを確認。raw TAP内にSDKが出力するPERMISSION_DENIEDログの末尾空白があり、全ファイルのdiff --checkはその警告を出す。証拠は加工せず保持し、TAP以外のコード/文書差分チェックは合格。専用ポート8088/9099/9153/4403/4503はEmulator停止後にlistenなしを確認。

## 実装範囲と既存POSとの対応

新規 `isolated/method-b-sales/` のみで、POST `/v1/sales/commit` と `/v1/sales/result` を実装。JPY、割引0、exact SKU、manual支払、20行/32 KiB等の上限を維持。製品からのimport、デプロイentrypoint、実UID、旧キュー移行はない。

| 既存概念 | 今回の対応 |
| --- | --- |
| 売上ID/台帳 | 入力transactionIdをsalesTransactions/id、transactionLocks/idへ使用。再採番なし |
| movement | id__1等の既存ID、transactionId/sessionId/variantId、quantityとappliedInventoryDeltaを保持 |
| 売上・集計 | gross/net/割引、JPY換算、itemCount/lineCount、session salesSummary、event soldByVariantを原子的に更新 |
| SKU・商品表示 | productVariantsから正本キー/座標/表示フィールドを決定。入力の任意path/patchは不可 |
| 原価 | transactionService dc8f14aの723〜1053行をlegacy-cost.mjsへ固定コピー。productsとvariantの原価候補をtransactionで読む。元コード変更なし。実商品原価全ケースの互換試験ではない |
| 在庫 | 対象SKU数量を差分更新。同SKU複数行を累積し対象文書revisionは売上1件につき1増加。非対象metadataを保持。既存POSのSKU/色単位更新時刻の更新までは移植していないため製品置換不可 |
| fingerprint | 既存の項目順/JSON形を維持した生成処理と独立した期待値を照合。旧lockは自動成功としない。新しい意図全体のhashはserverSaleV1へ分離 |
| 再送 | 新証拠・sale・movement整合を照合し、保存結果を返す。後続売上/価格改定/終了後も二重減算しない。voidedは照合待ちとして拒否 |

serverSaleV1はcanonicalRequest、requestHash、contextHash、actorUid、result/effectsと照合用hashを保持。ハッシュはAdminによる完全な偽造を防ぐ署名ではない。Admin/IAM境界と旧writer停止は本番移行の未確認条件。

## 実行と証拠

実Firestore/Auth Emulator、Admin14.4.0、Web11.0.2、rules-unit-testing4.0.1、Node24.21.0。固定demo project `demo-icelolly-method-b-sales`、loopback Firestore8088/Auth9099。既存Java21/CLIを利用。実データコピーなし。

- 最初の通常sandbox起動はhub4403のタイムアウト。19ケースは共通setupのfetch失敗で業務処理へ未到達。結果をbootstrap-failureとして保持する。
- 固定demo/専用loopbackで起動後、初回19/19成功。その後active型/不正UTF-8の拒否、実行中照会・競合順序・境界条件を補い19/19成功。最後に売上明細の表示互換フィールドを補完し、最終ソースで2026-10-14 20:20:53〜20:21:32 JSTに19/19成功、fail/cancelled/skip/todoすべて0。期待失敗/skip化はしていない。
- npm通常取得は名前解決失敗、固定lockを用いた再取得で224 packagesを導入。node-domexception/globの既存deprecated警告あり。製品依存や元手動API依存は変更なし。
- 手動25件は再実行なし。P10だけ、元inventory.mjsとバイト一致するmanual-compat.mjsを販売demoのruntimeへ結び付けて実行する新規結合試験。元runtime/ファイル/ガードは変更しない。これは元手動HTTPサーバーや実POSの移行試験ではない。

最終証拠は `docs/evidence/method-b-sales-2026-10-14.json` / `.tap`、全ケースの合成前後snapshotは `method-b-sales-2026-10-14-observations.json`。JSONのsha256が試験対象ソースを識別する。起動失敗と中間成功は同prefixのbootstrap/first/secondファイルへ保存する。各ファイルは同じ試験の実行履歴であり、件数を足して57件成功などと数えない。

## 試験適用範囲

P01〜P17/P23/P24の**19項目について限定版のケースを実行**。24項目全体や既存POS全体の合格ではない。

- P01：3架空UID・両routeの認証、未確認/無認証/部外者/期限切れ/別project/無効化/失効、認証内部障害fail closed。
- P02/P03：正本と関連文書のWeb SDK作成/変更/削除拒否、任意patch/偽receipt/支払申告/余分キー/重複JSONキー/不正UTF-8拒否。各拒否前後の状態保持。
- P04/P05：ID/数量/行/body上限、複数行・両正本、同SKU累積、fingerprint、売上/session集計、非対象SKU/metadata保持。
- P06/P07：同ID再送は操作時点の結果、後続売上後も追加書込なし。旧fingerprint外のlineId変更を含む異意図拒否。
- **P08/S02**：a/b/aの並列HTTP要求3件が成功（うち1件replay）、売上2・movement2・在庫5→3・revision0→2・session取引+2。
- P09：実DB読取後のABORTED故障注入で試行1→2、上限試行1→2→3後503。これを自然発生したSDK衝突と混同しない。実transactionの先行読取保持/解放と競合要求、同/異SKU販売も確認。
- P10：販売後の古い手動baselineは拒否、並列時は合法な直列結果または手動拒否。絶対数量の自動再baseなし。
- P11/P12/P14：実commit後にproxyで応答消失、API停止/再起動、transaction中の通信障害注入、実Emulator commitへの存在しない文書updateによる故障。部分更新なし。
- P13/P17：終了/価格変更後の再送、policy版のABA、SKU対応変更、値引き/他通貨拒否、価格上限、負在庫警告、不明数量とrevision overflow拒否。
- P15/P16：旧lock fingerprint有/無、旧sale、偽receipt、孤立movement、改変証拠でスキップ/補修しない。
- P23：実行中commitに対するread-only照会、not-foundからcommitへの遷移、voided照合待ち、再送で販売復活なし。
- P24：project/credential/hostガード、入力深度制限。ログ/保存証拠にtokenを出さない。

**未実施**：P18〜P22（旧キュー、取消API、終了API、Quick/後日配賦、旧SW/実機）。P17の他通貨/割引の正規成功、P23の取消確定成功照合は未実装。fixtureの終了状態変更は終了APIの検証ではない。Auth Emulatorのunsigned token試験は本番署名/IAMの実証ではない。

## 危険再現との照合・次の判断

新API限定ではR02は3 UID＋verifiedと両route認証、R09は固定操作とサーバー差分、R13は新証拠整合と旧記録の拒否で対応。旧32件の結果・旧Webの危険経路は未変更。C01は承認済み安全拒否を維持。S02の新API限定結果を既存POS修正済みと扱わない。

実運用前に、価格/割引/通貨、旧lock・成否不明キュー、監査/負荷/費用/HTTPS/CORS、商品版供給、取消/終了/配賦、3アプリ契約・稼働Rules/IAM・実UID・実機が必要。ECイベント確保/注文引当、staging復旧、Bridge接続は未実装。週末のPOSは変更していない。

復旧は専用branchの追加revertで行う。元売上IDやキュー・証拠を削除しない。作業用Emulatorだけを停止し、本番の直接書込を復活させる復旧は行わない。新API成功後も工程A配備不可、工程B着手不可。次は限定結果をレビューし、後続の契約/実装範囲を別承認する。

## 2026-10-15 保存証拠の再確認

PR head 96fb26bの最終JSON/TAPを確認し、19成功・失敗0・cancelled/skip/todo 0と対象ソース11ファイルのSHA-256一致を確認した。ローカル75e09c8は文書引継ぎのみ。試験実行0件で、結果やraw証拠は変更していない。これは追加試験成功ではなく保存状態の照合。[後続計画](METHOD_B_POST_SALES_PLAN_20261015.md)でP18〜P22と次の取消実装の承認範囲を分離した。
