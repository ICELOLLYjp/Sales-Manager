# 方式B 第5段階：POS互換性・移行条件・引継ぎ

確認日：2026-10-13。対象：Draft PR #123、`codex/stage-a-method-b-isolated-20261012`。開始時にGitHub headと取得したローカルheadがともに `8a0c57fda796198a4519a3123aa93b78a3bd88ca` であることを確認した。参照元はSales #121 `71ec1d77691aaa2e194d0eebb55ce207b546b200`。以下のソース位置は開始時headに対応する。

**第5段階の文書化は完了。既存POSと新APIは未接続で、工程Aは配備不可、工程Bは着手不可。** 今回は静的評価のみで、API・POS・Rules・設定を変更していない。第1〜4段階の成功済み作業は繰り返していない。

## 1. 証拠と評価の範囲

- 保存済みの[書込経路](METHOD_B_WRITE_PATHS.md)、[API契約](METHOD_B_API_CONTRACT.md)、[隔離検証](METHOD_B_VALIDATION.md)を基準に、SalesのPOS、キュー、認証、Service Workerと隔離APIのソースを照合した。他2アプリの評価は書込経路文書に固定されたPR headの調査に基づき、今回新しい端末試験・稼働環境調査はしていない。
- 新APIの25件は[既存JSON](evidence/method-b-2026-10-12.json)および[TAP](evidence/method-b-2026-10-12.tap)を再利用する。25成功、失敗0。今回の追加実行は0件であり、POS互換性25件合格という意味ではない。
- Sales #121の旧32件（安全要件26成功、C01/C02/S02の3失敗、R02/R09/R13の3危険許可）と旧43件の隔離モックはそのまま保持する。過去の診断・結果・期待値は変更していない。
- 以下では「ソース上の事実」「移行条件の提案」「未検証」を分ける。実機、実UID、稼働Rules/IAM、稼働Admin経路の安全性は未確認。

## 2. ソース上の互換性

新APIは単一SKUの手動数量変更だけを処理する。POSの業務操作を数量変更へ分解して代用できない。売上・取消・終了時の複数文書更新と既存IDの意味を維持する別契約が必要。

| 操作 | 現在の経路・意味 | 方式Bで未実装の部分と移行時の危険 |
| --- | --- | --- |
| 通常販売・Quick販売 | `transactionService.js:1054` commitQuickSale。既存transactionId、sale、lock、movement、sessionと必要な正本更新 | 販売APIなし。手動編集後に売上を書く分割処理は部分成功・二重減算を招く。S02の並列POS検証が必要 |
| 取消 | `transactionService.js:2581` voidSaleTransaction。元売上を参照し取消状態と必要な在庫戻しを処理 | 取消APIなし。元ID・取消冪等性を維持し、販売再送との競合を含め検証する。ローカルキュー削除は売上取消ではない |
| 通常終了精算 | `eventCloseService.js:1323` finalizeEventSession。正確に減算済みの販売と未反映分を区別 | 終了APIなし。既適用分の再減算禁止。事前保存と最終transactionの境界・販売との排他を再設計する必要がある |
| 保留・未特定終了 | closeWithPendingInventoryService / closeWithUnidentifiedService、仮終了経路 | APIなし。残未特定数・session状態・在庫反映状態を失わず、再送と後日確定の二重適用を防ぐ |
| 後日SKU確定 | `eventLateSkuResolutionService.js:377,484`。既存売上/未特定単位とSKUの対応、lock/movement/session/正本 | APIなし。売上を再作成しない。確定済み単位を再減算せず、並行確定・取消・終了との競合を検証する |
| 金額先行販売・配賦 | fastAmountSaleService、`fastAmountAllocationService.js:127,209`。カテゴリ分類とSKU確定は効果が異なる | APIなし。金額売上を重複計上せず、SKUへの配賦時だけ必要な在庫効果を適用する。再配賦時の制約も必要 |
| 棚卸・チェックポイント | inventoryCountService等、`tshirtPhysicalStockService.js:61`。複数行、不変baseline、棚卸日時/担当/sessionメタ情報を保存 | 単一SKU APIと非互換。1行ずつの置換では途中失敗時に棚卸全体が不整合になる。棚卸用の原子的契約が未実装 |
| 手動在庫編集 | 隔離APIは既存TシャツSKU・アクセサリーIDの数量だけを更新 | API自体のみ実装。製品UI未接続。新規SKU、null/欠損、名称変更、追加削除、派生shared同期には使えない |
| 制作・材料・入荷 | T-shirtsのcompleteProductionTask / applyFinishedPlusMode / receiveSelectedBodyOrders → saveMasterData | APIなし。完成品増・材料減・タスク/発注変更の一体性を維持する。手動数量APIの連打で代用禁止 |
| 商品・バリアント・session等 | productVariants/productsやsessionへの直接更新が残る（書込経路文書参照） | 正本だけ閉じても商品/価格/状態の改変から販売結果を汚染できる。関連文書の全writerを含め認可境界を決める |

既存POSのfingerprintは`transactionService.js:370`の業務項目JSON。既存IDを渡さなければ同`:1146`で採番する。lockの照合は同`:1364`でfingerprintが存在するときだけ不一致を拒否するため、旧lockのfingerprint欠損を新APIで無条件成功扱いしてはいけない。一方、機械的な再採番・新台帳へのコピー・fingerprintの上書きも禁止。旧データを扱う照合契約と隔離fixture試験が未実装である。

新手動APIは別schemaのreceiptとcanonical intentのSHA-256を使用する。旧A1 receiptを信頼してスキップせず409とする。同一ID・同一内容の再送結果は**操作時点の結果**であり、現在在庫の表示値として無条件上書きしない。旧POS lock、旧receipt、新手動receiptを同じ冪等性証拠として混用できない。

## 3. キュー・端末・通信の確認

### ソース上の事実

- `offlineQueueService.js`はlocalStorageの`icelolly-sales-offline-queue-v1`へ元transactionIdとsaleを保存する。enqueueの保存失敗はエラーとなる。同じIDがある場合は既存行を返し、異なるpayloadかの照合はしていない。
- 同ファイルのreadJsonは読取/JSON異常時にfallbackを返し、cleanQueueは必要項目のない行を除外する。画面上0件だけでは元データが空と証明できない。removeOfflineSaleとupdateOfflineSaleErrorはwriteJsonの成功値を確認していないため、画面上の削除/更新と永続化が食い違う可能性がある。
- `app.js:480`のsyncOfflineSalesQueueはcommitQuickSaleへ元saleを渡し、成功後にローカル行を削除する。エラー時は記録してループを停止する。新APIは呼ばない。online、visibility、ログイン後のタイマーが再送の契機になる。navigator.onLineはAPIの健全性を保証しない。
- `app.js:23180`以降の会計では同じsalePayloadをネットワーク系エラー時にもキューへ保存する。SKUのオフライン販売には開始在庫に関する制限がある。画面の保留数反映は共有正本の予約を保証しない。
- `app.js:22835`以降の待機列取消UIはローカルremoveOfflineSaleを行うだけで、サーバー照合・売上取消を行わない。通信断でサーバーcommit済みの場合、待機列削除はサーバー売上の取消にならない。
- キューは端末/ブラウザoriginの保存領域にあり、利用者別台帳ではない。ページ内のsyncフラグはあるが、キューのread-modify-writeにタブ間排他は見当たらない。複数タブでの取りこぼしはリスク推論であり、今回の実再現結果ではない。
- `sw.js`はGETをネットワーク優先で取得しキャッシュへfallbackする。POST再送・background syncの実装はない。installの個別cache.add失敗を無視し、skipWaiting/clients.claimを使用、activateで旧shellキャッシュを削除する。ignoreSearch付きfallbackもあるため、URLクエリ変更だけで古い直接writerの消滅は証明できない。
- `auth.js`はGoogleログイン、browserLocalPersistence、3メールとemailVerifiedで制限する。新APIの3 UID照合との対応は未確認。Web SDKのFirestore認証から、独自HTTP APIのAuthorization付与が自動で行われるわけではない。
- `isolated/method-b/http.mjs`はPOST手動編集のみで、OPTIONS/CORS対応はない。ID TokenをverifyIdToken(token,true)で確認するが、その例外は401へまとめる。検証基盤の障害と利用者の無効化の区別はこのHTTP応答だけではできない。runtimeは固定demo project・localhost Emulator限定であり、本番起動方式はない。

### 次に承認が必要な互換性試験・設計条件（未実装・未検証）

| 条件 | 必要な確認と安全な取り扱いの提案 |
| --- | --- |
| iPhone / 旧ブラウザ | Safariとホーム画面起動を分け、保存領域、バックグラウンド停止、再起動、容量不足、複数タブ、日付/数量表現を確認する。今回実機試験なし |
| Service Worker / 旧タブ | 旧shell、部分cache、更新途中、長時間開いたタブからの書込を隔離再現する。新バージョン表示だけに頼らず、最終的にはサーバー/Rules境界で旧writerを拒否する |
| 認証期限切れ・切替 | 有効なID Tokenの付与、期限切れ時の限定的refresh、再認証待ち、UID切替を設計する。401/403でIDを再発行・キュー削除しない。permission-deniedの無条件再試行は禁止 |
| API停止 / timeout / 応答消失 | 503/通信断時は成否不明として同じID・同じ内容を保全。回数/間隔を制限した再送と操作結果の照合を設計する。Firestore直接書込へのfallbackは禁止 |
| 業務競合409 | 元のbaselineを保存し、現在値と差を提示して判断する。同じIDの内容を変えない。競合した絶対数量を最新revisionへ自動載せ替えしない |
| HTTP互換性 | HTTPS、CORS/同一origin、認証障害の分類、最大payload、停止表示、監視を別途設計・試験する。現在のlocalhost HTTP成功はブラウザ接続の証拠ではない |
| キューの移送 | 自動送信を止めた状態でraw localStorage・元ID・payload・件数を保全し、正規化後との差や同ID異内容を隔離する。エクスポート/移行ツールは未実装。新しい台帳やIDを作らない |
| commit後に応答が消失 | 新手動APIではB13で検証済み。POSでは未検証。既存売上/lock/movement/sessionを照合し、未反映だけを元IDで再送する契約が必要。待機列取消で解消しない |

## 4. 未解決の安全要件

| 識別子 | 保存済み証拠と現在の結論 |
| --- | --- |
| C01 | B12は異SKUでも同じ正本文書revisionが競合すれば片方409。データを壊さず拒否するが、旧C01の「異SKU両方保存成功」は未達。安全拒否を受入要件とするか、SKU単位競合契約を追加するか承認が必要 |
| C02 | 新手動APIの同SKU競合は409として安全拒否。旧Web経路のpermission-deniedは変更しておらず、3アプリの解決を意味しない |
| S02 | 並列POS販売の欠落/二重減算防止は未解決。B10の手動API同ID試験で代替できない。販売APIと元IDを使った並列・再送・取消・終了の隔離試験が必要 |
| R02 | 架空3 UID＋確認済メールのみの隔離APIは検証済み。実メールとUIDの対応・稼働認可は未検証。ログイン済み全員への正本許可は認めない |
| R09 | 新APIは全体置換/任意patchを拒否し他SKUを保持する。既存直接writerには適用されていない |
| R13 | 新APIは旧/偽receiptでスキップしない。既存receipt/lockの信頼性、他Admin writerの改変可能性は別途確認が必要 |

3アプリの旧共有モジュールの一致は書込経路文書に記録済みだが、**新しい方式B契約を3アプリ全体へ適用した状態ではない**。Sales製品も未接続、T-shirts/Accessoriesも未移行。残存する直接書込を許したままでは方式Bの安全境界は成立しない。

## 5. 安全な移行の必須条件（将来の提案、今回実施なし）

1. 全writerを棚卸しする。正本、salesTransactions、transactionLocks、inventoryMovements、receipt、session、productVariants/products、派生文書と子文書を含む。既知ソース以外の稼働Admin/IAM経路は、別途承認された読み取り確認が必要。AdminはRulesを迂回するためdeny Rulesだけでは十分でない。
2. 3実UIDと確認済メールの対応を運用責任者が確認し、同等権限の許可リストと失効手続きを決める。架空UIDを本番へ流用せず、役割管理を追加しない。
3. 各業務APIと旧ID/lock/receiptとの互換契約、複数文書の原子性、派生文書同期を隔離で実装・承認する。C01の受入判断とS02等の実試験が未解決なら切替を認めない。
4. 全端末の未送信・成否不明データを保全し、旧writerを止める切替手順を用意する。停止後の新規販売、旧タブ、SW、別ユーザーの自動送信を含む制御が必要。現時点では停止・照合の運用ツールも未実装。
5. 関連文書のクライアント直接書込禁止とAPI利用を同じ移行計画で扱う。先にdenyだけを配備すると既存POS/制作等が停止し、旧許可を残すと安全境界を迂回できる。稼働Rulesへ隔離deny-allファイルを丸ごと適用しない。他業務への影響を個別に評価する。
6. 端末試験、Auth障害、API停止、応答消失、複数POS、終了/取消/後日確定を合格させ、監視・課金上限・障害対応・復旧リハーサルを整える。運用費用は実測していない。API実行、認証/失効確認、Firestore再試行、ログが追加コスト要因となるため、実負荷と予算の承認が必要。

## 6. 次の承認対象と再開地点

推奨する次の承認は、**製品接続を伴わない販売APIの互換契約設計と隔離fixture試験計画**。元transactionId、fingerprint欠損lock、成否不明キュー、S02、取消/終了との競合を対象にする。実装へ進む範囲・成功条件はその設計を確認後に決める。併せてC01の安全拒否を最終要件とするかを判断する。

別枠で必要な承認は、実UID・稼働Rules/IAM/Admin writerの読み取り確認、実機での非破壊確認、キュー保全/照合手順の設計。実在データの隔離環境へのコピーは許可しない。POS接続、他2アプリ変更、Rules変更、配備・移行は今回の承認に含まれず、独立した審査が必要。

再開時はGitHub #123の最新headと[METHOD_B_PROGRESS.md](METHOD_B_PROGRESS.md)を確認し、第1〜5段階を再実行しない。次の承認がなければ実装を開始しない。新API/Rules/依存を変更するときだけ影響する試験を再実行し、既存32件の結果を書き換えない。

## 7. 復旧方法と完了条件

今回の変更は文書だけで実環境の復旧操作は不要。文書の訂正・取り消しは専用ブランチの第5段階コミットに対する追加訂正またはrevertコミットで行い、既存ブランチのreset/force-pushや過去の証拠削除はしない。隔離実装・25件の証拠は開始時head `8a0c57f` に保存されている。

将来の切替失敗時は新規操作と自動送信を停止し、rawキュー・元ID・サーバー側結果を保全する。結果が不明な操作を再採番/削除せず照合待ちにする。クライアント直接書込の許可を戻すことは復旧策にしない。安全なAPI版への復帰または停止継続を選ぶ。数量だけを巻き戻す、commit済みreceiptだけを消す、再減算を誘発する再送は禁止。この復旧運用は提案で、実装・リハーサルとも未完了。

第5段階の完了条件は、操作別互換性、端末/キュー/通信、残存writer、C01/S02等、承認事項、復旧方法を文書化し、専用ブランチへcommit/pushしてDraft PR #123に記録すること。実機や既存POSの安全性合格を完了条件に読み替えない。文書以外の差分がないこととdiffチェックを確認し、25件は再実行しない。

今回の保存前確認：`git diff --check`合格。変更対象は本報告とMETHOD_B_PROGRESS.mdの2文書だけ。既存JSONに記録された実装・試験・Rules・設定・依存lockの8個のSHA-256はすべて一致し、開始時headに対するAPI、製品JS、SW、証拠、旧診断文書の差分はない。これは証拠の保持確認であり、試験の再実行ではない。

**判定：第5段階の静的評価・引継ぎは完了。工程A配備不可。工程B着手不可。次の承認待ちで停止。**
