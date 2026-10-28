# 実PHP/HPOS全明細proofの隔離接続

Website #34 の `isolated/ec-purchase/woo-order-evidence.php` を `isolated/method-b/woo-order-php-reader.mjs` から読み、既存 `createWooOrderBridge` のread contractへ接続した。bridge本体・固定operationId・receipt・intent・mode fence・inventory ledger/authority規約は不変更。新規HTTP endpoint/本番設定なし。

readerはserver指定の絶対パス、固定fixture site、orderId、fresh challengeだけを受理。PHPは実WP/Wooランタイム＋隔離fixtureのコピーSQLite HPOS DBで署名する（実店舗DBコピーではない）。PHPネットワーク関数を無効化し、Nodeは既存loopback-only launcher、Firestore/Authは `demo-icelolly-method-b`。test stock数量7は合成値。180枚は不使用。

`woo-order-php.test.mjs` は実PHP proofを使い、混在3行/同SKU2行の原子的hold、永続同ID replay、明細追加/削除/数量/mapping/ABA、postflight ABA、署名challenge再利用、異サイト、commit応答消失lookup、旧mode fence、両停止gate、request上書き拒否を検証。購入・決済・確定許可は常にfalse、要対応true。Woo+Firestore間の原子性は保証せず、不明結果はholdを残す。自動release/reholdやStripe呼出しは追加しない。

最終接続14 PASS + 既存回帰79 PASS = Node93、Website PHP25を合わせ118 PASS / FAIL0 / SKIP0。初回93の新規14は欠落検出補強後の最終14に置換し二重計上なし。構文6 PASS。旧SQLite158は50ファイルhash一致の証拠再利用で再実行なし。raw logs/source hashes/初期起動失敗は `docs/evidence/woo-hpos-order-20261029/`。既存依存220ファイルを最新GitHubと照合、27 worktree/未保存97/同意6は保全・不変更。

再現：Websiteの `docs/EC_WOO_ORDER_ISSUER_20261029.md` に従ってコピーruntimeを準備し、`WOO_PHP_BIN` / `WOO_WP_ROOT` / `WOO_FIXTURE_RUNTIME` / `WOO_ORDER_RUNNER=<Website>/tests/run-woo-order.cjs` を絶対パスで設定。既存固定loopback Emulator下で `node --test --test-concurrency=1 --test-timeout=60000 --test-reporter=tap woo-order-php.test.mjs`。証拠local-launcherは実行時ローカル配置を示す。

本番source revisionは未完成。SQLite trigger counterとfinished policyは明示的な隔離fixtureだけ。本番全writer、restore/epoch、旧offlineキュー、実認証/署名鍵/transportは未接続で、本番modeは提供しない。MySQL HPOS/実店舗DB/別process競合・負荷/実ブラウザ/POS/Staging/実Rules IAMは未検証。MTO枠・材料・制作タスク・同梱納期・Stripe・確定/期限/取消/返金接続は残工程。production-readyではない。

10/30–11/1イベント中および終了後の未同期POS/売上/取消/棚卸/保留照合・手動承認まで購入停止を維持。実環境変更、deploy、購入解禁、mergeなし。次はコピーDBでwriter別revision coverageとrestore/epoch検証を追加する。
