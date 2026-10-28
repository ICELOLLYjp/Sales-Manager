# 注文一括確保：完成品の隔離サーバー実装（2026-10-29 JST）

Draft #127 の `95720dc9cec053bec3d4b44525e255e1f79692b3` を基準に、完成品の全明細検証→固定注文intent→複数canonical stock/ledger/checkpoint/receiptの単一Firestore transaction→照会・同ID復旧までを実装。**本番利用不可。HPOS全明細issuer・受注制作・決済は未接続であり、一括API全体の完成ではない。** HTTP route/hooksやデプロイ設定は追加していない。

## 今回の完成範囲

- `isolated/method-b/woo-order.mjs` の `createWooOrderBridge(rt,{sites,clock})`。公開メソッドは `hold(token,{siteId,orderId})` とread-only `lookup` のみ。callerのoperationId、明細指定、SKU、数量、署名を受け付けない。
- 専用fixture actor、Auth失効確認、site/key allowlist、HMAC、fresh challenge、30秒以下の署名有効期間、完全な注文snapshot、安定したsite/order identityと単調source revisionを検証。最大50明細。署名readerはサーバー構成専用。現在の全明細readerは合成fixtureのみで、Websiteの旧PHP issuerは1明細仕様のまま。
- 完成品Accessories＋販売選択済みTシャツの混在、同一SKU複数行に対応。各行を検証して累積確保下限を計算。各canonical documentを1回だけ更新し、物理数量は変えずledger/revision/checkpoint/注文receiptを原子的に書く。途中で1SKUでも不正・不足・競合ならすべて無更新。
- 既存checkpoint必須。missing/unknown数量やledgerを推定補完しない。在庫・制作枠の初期化処理なし。購入停止gateが欠落または停止中なら新規確保は拒否。fixtureでのみ明示的にgateを設定する。実購入停止を制御するコードには未接続。
- site/order由来のoperationIdを永続化し、在庫revisionは再計画しない。同じIDのreceiptを歴史的ledger/authorityから再構成して検証する。応答消失後は同じ注文のlookup/retryで復旧し、別IDは入力できない。不明状態を成功や決済許可と扱わない。
- 注文変更・ABA・再読取不能時はreviewをラッチして保持。Woo/Firestoreの分散原子性は保証できない。返却のpurchaseAuthorized/paymentAuthorized/reservationConfirmedは常にfalse、reviewRequiredは常にtrue。過去receiptの照会は現在の購入許可ではない。
- 旧1明細bridgeに注文mode fenceを追加。新経路は旧intentを注文全体で検索し、削除済み明細の旧intentでも拒否する。旧modeの注文を自動移行・再確保しない。単明細APIを並列呼出しする実装ではない。

## 実行証拠

`docs/evidence/woo-order-20261029/manifest.json` とrawログを参照。

- 初回: 既存producer20＋event release12＋Woo20＋新規order22 = **74 PASS / 0 FAIL / 0 SKIP**。
- receipt歴史再構成と追加ケース後: 新規order **27 PASS / 0 FAIL / 0 SKIP**。初回order22は置き換え、二重計上しない。最終有効な実行証拠は **79件（既存52＋最終27）**。既存52の対象ソースはその後変更なし。
- 構文検査3件PASS。PHP新規試験はなし。既存W01の実PHP/HPOS→旧1明細bridge接続は今回実行したが、全明細PHP接続の証拠ではない。
- SQLite158 PASSは**再利用のみ**。50ファイルLF正規化hashを再照合して一致。今回の新規79に加算しない。
- 初回sandboxのEmulator hub起動失敗を保存。固定loopback・demo project・認証情報除外・既存Node loopback guard付きlauncherで実行成功。JVMのOSレベル通信隔離は主張しない。起動時metadata警告をrawに保存。終了後8087/9098/4402/4502にlistenなし。
- Accessories index.htmlの最初のraw blob比較はCRLF差異で不一致。remote読戻し＋LF正規化でHEADとの一致を確認。実装変更やテスト失敗ではない。

## 保全と基準HEAD

開始時GitHubで以下の4 HEADが指定SHAと一致し、Draft/未マージを確認。

| PR | 開始時HEAD |
|---|---|
| Sales-Manager #127 | `95720dc9cec053bec3d4b44525e255e1f79692b3` |
| Website #34 | `de537bb1843fbad2d6762635cd5b0cdad22acb56` |
| T-shirts-Stock #42 | `64d935d48df433c66a393e9aff02f7d0a0ded9b6` |
| Accessories #23 | `b3badb712e0b36d42aa475f49da0c2e83348e996` |

27ローカルworktreeを確認（従来26＋accessory-ui-20261028）。従来26のHEADと未保存97ファイルは旧manifestと一致。97ファイルを別コピー＋index/worktree patchで保全し、実装後もhash一致。同意6ファイルは一致・未統合。変更は新規隔離作業ディレクトリのみ。sources/は変更なし。

## 未接続と次のゲート

1. **HPOS注文全体issuer**：Websiteの `woo-reservation-evidence.php` を全明細/商品/Bridge/販売選択の安定snapshotへ拡張し、productionの単調revisionをすべての関連writerに接続。現在の署名fixtureを実Woo検証の代用にしない。PHP→新サーバー統合、明細削除/追加/商品変更/ABA、停止設定の全経路を試験する。
2. **受注制作と同梱**：Accessories全商品は在庫ゼロでも受注制作可能、目安10営業日、10日30点、超過時は納期延長して継続受注、完成品と制作枠は別。混在は遅い商品の予定に合わせ同梱。今回 `fulfillment=made-to-order` を含む注文は全体拒否し、完成品だけ確保しない。この拒否は未接続中の安全措置で、最終販売仕様ではない。営業日カレンダー、10日枠の計算方式、制作負荷の単位、優先順位、予約時点/支払時点の枠消費、延長通知・同意、再計算条件は別途仕様化が必要。
3. **制作/材料writer**：HEAD一致のT-shirts-Stock index.html `completeProductionTask` はblank_stock/print_sheets/production_tasksと在庫を旧saveMasterDataで保存する。Accessories index.htmlのcomplete-task/complete-visible-tasksはtaskPiercing/taskEarringを数量へ移しsaveDesignsを呼ぶ。共通API移行モードではこれら旧保存が停止するため、新receipt/注文紐付け・材料消費・制作完了との原子性を満たす移植が必要。今回の接続試験は既存manual writerが新ledgerの下限を守るところまで。
4. **legacy/POS**：旧全量保存、古いブラウザ/SW、未同期キュー、イベント販売/取消/返金/Sessionを閉じる。production用Rules/IAM/実認証、照合checkpointの発行、独立restoreと停止手順は未完成。
5. **決済/ライフサイクル**：Webhook、支払確定、取消・返金、期間切れ、release/confirm、材料消費、制作タスク生成・延長を未実装扱いとする。別operationIdによる再引当や日付/Session closeによる自動解除は追加しない。

10/30–11/1台北Pinkoi Design Fest中は全商品購入停止。終了後も実売上・取消・未同期端末・棚卸の照合と手動再開が必要。10/27 20:23の180枚は過去参考値のみでseed/販売可能数量に使用しない。実Firestore/実在庫/POS/WordPress Staging・本番/Stripe/Rules IAM変更、デプロイ、購入解禁、PRマージは実施していない。
