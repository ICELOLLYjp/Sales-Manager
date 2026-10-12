# 第1段階：書込経路と責任範囲

2026-10-12。静的ソース調査。実環境アクセスなし、他repo変更なし。動的外部Admin経路を監査済みとはしない。

## 取得基準

| repo | 参照PR head | 最新main |
| --- | --- | --- |
| Sales #121 | 71ec1d77691aaa2e194d0eebb55ce207b546b200 | 1c44320108f3db95dc13fe432899568bfdc57ab8 |
| Website #22 | b9028f5b9e801aee9699f1a50f6482d01c6a6df7 | 6d5971d75712b58baf73005a38cb13f79012c36e |
| T-shirts #41 | 4f87a7d61c6acd6e496f3324474d6d4a38201548 | d39c818fccd57de304812d8188a51a068ab68a36 |
| Accessories #22 | cd7107db45c1abe3ed8450cea72402b5a73f84b3 | 366205b677e6997c5e1a6a3852e0ef44fd336d9b |

指定診断/Emulator報告、Website方式比較/RFC、各PROJECT_HANDOFFとWORKFLOWを参照。mainとの差分は既存工程A＋診断で、今回の変更は専用ブランチに追加。3共通moduleはblob 1f4dda4a6d1700f4961a30f83e24ae3d60c4909dのまま。

## 共通認可の現状

Sales/T-shirtsのUIは3確認済みemail制限、AccessoriesはGoogle認証とRulesに依存。リポジトリRulesのallowedUserはsignedInのみ。UI制限はDB認可ではない。以下の「Web」はこの不十分なDB認可下にある。FunctionsはAdmin SDK経路でRulesを迂回し、各関数のスタッフ認可と実IAMは別境界。実UID/稼働Rules/IAMは不明。

## 経路一覧

| 文書/操作 | ソース・現在の書込主体 | 冪等性/原子境界・方式B依存 |
| --- | --- | --- |
| Tシャツ正本 tshirtStock/master | T-shirts index.html saveMasterData→saveInventoryEdit（Web）。手動数、masters、材料、発注、customer_orders、制作タスク等を同文書へ保存 | 不変baseline＋receipt。材料/制作はstrict revision。手動数量だけを今回API化し、他フィールド保存は移行対象外 |
| 制作/材料 | completeProductionTask、applyFinishedPlusMode、receiveSelectedBodyOrders→saveMasterData | 完成品増・材料減・タスク/発注変更を同時反映。手動編集APIで代用禁止 |
| 派生 tshirtStock/shared | syncSharedFromMasterのTransaction、index.htmlの旧互換shared設定/初期化（3797/4080/9324付近） | 正本と別Transactionで遅延あり。逆輸入禁止。移行時は既存分岐も棚卸し。今回同期は実装しない |
| アクセサリー正本 accessoryStock/shared.designs | Accessories index.html flushDesigns→saveInventoryEdit（Web） | ID別/field別merge＋receipt。数量以外の名称/追加/削除も現UIは扱う。今回APIは既存IDの数量だけ |
| inventoryWriteReceipts | 3アプリ共通saveInventoryEdit（Web） | path/intent/revision/createdAt。A1 receiptはクライアント作成可能だったためサーバー証明とみなさない。ID衝突は拒否、黙って信頼/上書きしない |
| salesTransactions / transactionLocks / inventoryMovements / 正本 / salesSessions | transactionService.commitQuickSale、voidSaleTransaction（Web adapter） | 既存ID、fingerprint/lock。全効果のTransactionを維持。販売exact SKUのみ即時減算、取消一度だけ。今回移行しない |
| 通常終了 | eventCloseService.finalizeEventSession（Web） | session/lock/movement/必要正本をTransaction。exact売上の再減算禁止。事前状態更新の別経路も存在 |
| 保留/未特定終了 | closeWithPendingInventoryService、closeWithUnidentifiedService（Web） | lock/session/特定済調整/正本を原子的更新。unknownは推測配賦しない |
| 後日SKU | eventLateSkuResolutionService（Web） | session解決記録、movement/lock/正本を結合。事前編集経路と確定経路を区別 |
| 金額売上/配賦 | fastAmountSaleService、fastAmountAllocationService（Web） | 売上/session/lock/movement/配賦時正本。正本未更新の未特定売上も保護対象 |
| 実数棚卸 | tshirtPhysicalStockService→saveInventoryEdit（Web） | baseline全revision＋operationId。今回のSKU単位編集と混同しない |
| session開始/終了入力/途中計数 | inventoryCountService、eventDailyCloseService、eventCheckpointReuseService/V2、eventUnregisteredItemService、provisionalWithoutCountService、unidentifiedQuickService（Web） | 状態/版比較のTransactionと単独updateが混在。すべてを既存POSの安全入力として無検証に信用しない |
| session入出庫/差分確定 | inventoryFlowService、inventoryFlowFinalizeService（Web） | flowEntries、session版、確定lock。イベント持参数は正本減算ではない |
| sessionライフサイクル | sessionService、sessionLifecycleService（Web） | set/update/delete。安定sessionIdはあっても全操作にoperation receiptなし。削除/状態遷移の別APIが必要 |
| 旧/互換終了処理 | eventCloseServiceCompat、eventCloseFlowCompatService、closeWithUnidentifiedFlowCompatService（Web） | session直接updateあり。新API導入時に迂回路を閉じる必要。今回変更なし |
| 外部計数 session | T-shirts/Accessories event-count-v2.js saveDraft/confirmCount/saveCheckpoint（Web） | draftは単独update、confirm/checkpointはTransaction。正本数量は書かないが終了処理の入力。権限制約必須 |
| productVariants/products | Sales catalogService/productAdminService/priceBookService/pinkoiCatalogService、T-shirts index.html 6917〜7889（Web set/batch/delete） | 安定SKUと価格/原価マスタ。任意変更をサーバーPOSが信用しない。書込制約/固定操作の別設計が必要 |
| products配下原価履歴 | costHistoryService、T-shirts screenPlateCostHistory（Web） | ID付きset。正本とは別だが取引の価格/原価入力となる。今回変更なし |
| stripePayments | functions/index.jsのpaymentDoc等（Admin） | 支払証拠で売上正本ではない。Functionsソースでは正本2パスへの直接writeは見当たらない。実配備・動的経路は未確認。触らない |
| 経費/Gmail等 | 独立業務機能/Functions | 在庫編集APIの入力/更新対象外。外部Admin監査の完了は主張しない。隔離Rulesは既定denyのためこれらも許可しない |

検索：Web SDK setDoc/updateDoc/addDoc/deleteDoc/writeBatch/runTransaction、Transaction set/update/delete、共通saveInventoryEdit/saveMasterData、Admin collection/doc/set経路を照合。単なる「正本を閉じれば全体が安全」とはしない。

## 今回の境界

新APIは手動数量編集だけ。既存POS/他2アプリへの呼出置換をしない。隔離Rulesは全client writeをdenyとする（必要なら架空許可者readだけ）。そのため既存POSをこのRulesへ接続すると失敗するのが意図した非互換であり、移行完了ではない。

実UID/IAM不明でも架空Auth Emulator・Firestore Emulator内の限定実装は進められる。本番適用や既存Admin統合が必要になったら停止する。次：METHOD_B_API_CONTRACT.mdに固定業務payloadとreceipt信頼境界を定義。
