# 第4段階：隔離安全検証

2026-10-12 19:30 JST、最終25件成功、失敗0、skip/todo0、exit0。初回22件成功後、匿名/失効/隔離ガードを追加し24件成功。上限revision到達後のreceipt再送を妨げないよう補正し、25件を最終実行。既存32件・期待値は変更せず、既存43モック/無関係CIは再実行しない。

環境：demo-icelolly-method-b、Auth127.0.0.1:9098、Firestore127.0.0.1:8087、Emulator1.22.0、firebase-tools15.33.0、Node24.21.0、Admin14.4.0、Web11.0.2、rules-unit-testing4.0.1。すべて架空fixture。実環境アクセスなし。

[結果JSON・ケース・ソースSHA256](evidence/method-b-2026-10-12.json)、[TAP](evidence/method-b-2026-10-12.tap)。TAPは行末空白だけ除去。新APIの受入れであり、既存POS/3アプリ移行の合格ではない。

| 必須条件 | 証拠 |
| --- | --- |
| 架空3 UID/verified許可、部外者等拒否 | B01〜03、B05、B23。実Auth Emulator tokenをAdmin verifyIdToken(true)で検証。期限/他project/disabled/実失効も拒否 |
| 関連文書直接write拒否 | B04。正本、receipt、売上、lock、movement、session、商品/派生/子文書等、3 UID各々のset/update/delete拒否 |
| 全体消去/任意patch/余分field拒否 | B06〜07。固定payloadのみ |
| 偽receipt | B08一致intentでも旧A1形式拒否、B21改ざんreceipt拒否。Adminによる完全偽造防止はIAMの境界で未検証 |
| 競合 | B10〜12、B20。並列同IDは1効果。同SKU/異SKUの古いrevisionは409。ABAも拒否 |
| 冪等/応答消失 | B09/10/13/25。同一意図再送、JSONキー順序の違い、上限版の再送。HTTP proxyが実commit後の応答を切断、後続編集後の再送でも巻戻しなし |
| 非対象保持/数量意味 | B14〜18、B22。Timestamp/metadata、他SKU、アクセサリー配列ID、0/負/unknown、欠落revision、dot入りSKU |
| 原子性 | B19。実Admin Transactionへ存在しない文書updateを注入し、commitを失敗させた。正本とreceiptの両方が未反映。モックcommitではない |
| 接続境界 | B24。指定loopback以外/credentials設定は拒否 |

## 旧試験との対応・限界

- C01：新APIは異SKUでも全revisionの競合を安全拒否。**双方成功という旧C01の完全解決ではない**。SKU別マージは今回未実装。
- C02：新APIでは競合を409で明示拒否。旧Web経路は未変更。
- S02：POSは未移植・未検証。手動編集の同ID並列試験をPOSの代替合格としない。
- R02/R09/R13：新API＋専用deny-write Rulesの範囲では拒否を検証。旧Rulesの危険再現は不変。
- Auth Emulatorはunsigned tokenを使うため、本番署名/実UID/IAMの確認ではない。AdminはRulesを迂回する。既存Admin経路/配備済コードも未監査。
- ブラウザCORS/実HTTPS/レート制限/負荷/地域/監視/本番費用、iPhone、旧クライアント、未送信キュー、SW、復旧は未検証。HTTPサーバーは試験内loopbackだけで起動。配備entrypointなし。

第5段階は利用枠対策で未着手。次回は互換性評価と最終引継ぎを整理する。実装済みは手動既存SKU数量編集のみ。販売/取消/終了/配賦/制作・材料/他2アプリの呼出移行は未実装。工程A配備不可、工程B着手不可。
