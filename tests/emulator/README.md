# 工程A 実Firestore Emulator検証

本番設定・実在庫を使用しないテスト。**現状は競合試験3件が失敗する。終了コード1を成功へ変更しない。** `SECURITY GAP` は不適切な許可の再現テストであり、passでも安全要件の合格ではない。

## 実行

Node 24.21.0、Java 21、npmを使用。依存はこのディレクトリだけに固定し、アプリやFunctionsの依存を変更しない。

リポジトリルートから:

```powershell
npm.cmd ci --prefix tests/emulator --ignore-scripts --no-audit --no-fund
# JAVA_HOME/binにJava 21があることを確認
$env:CI = 'true'
node tests/emulator/node_modules/firebase-tools/lib/bin/firebase.js emulators:start --only firestore --project demo-icelolly-stage-a --config firebase.emulator.json
```

別ターミナルで:

```powershell
$env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085'
node tests/emulator/run.mjs
```

通常のfirebase.json、.firebaserc、Firebaseログイン、実プロジェクトID、export/importは使用しない。データ削除は固定demoプロジェクトのEmulator内だけ。8085とTCP遮断試験用8086を空ける。終了後、起動側をCtrl+Cで停止する。

`run.mjs` はこのホスト指定以外を拒否する。`latest.tap` と `latest.json` はignoredの `artifacts/` に保存する。実行したソースのSHA-256、依存バージョン、各ケース、失敗、セキュリティ問題の再現をJSONに分離する。ローカルバイトのハッシュは改行形式にも依存する。

## 実処理とテスト境界

- Rulesはルートのfirestore.rulesを実Emulatorへロード。認証トークンはrules-unit-testingで生成する架空のユーザー。Authのログイン自体はテストしない。
- NodeのregisterHooksでjs/firebase.jsだけをEmulatorのDB状態へ置換し、gstatic SDKのimportだけを同版のnpm Firebase 11.0.2へ転送する。業務サービス、inventory-firestore.js、inventory-concurrency.mjsのソースは改変せず実行する。
- sdk.mjsは実SDK runTransactionを呼ぶ。呼出回数の観測、preflight直後の競合書込み、実コミット後の応答消失例外を注入する。モックTransactionやRules判定の代用品は使用しない。
- S10は127.0.0.1:8086のTCPプロキシを切断して実RPCを失敗させ、復旧後に同じ売上IDを再送する。切断試験だけmaxAttempts=1とし、長いSDKバックオフを避ける。iPhoneの回線断やブラウザのPOSキューは再現しない。
- SDK disableNetworkだけではこのNode版のTransaction RPCを遮断できなかったため、その方式の試験は採用していない。
- C01とS02は全リクエストのsettlementを待ってから失敗を報告し、次のfixture削除と競合させない。C04は正本以外の同時Transactionが実際に再試行される対照試験。
- 同一PC・SDKでの結合試験。T-shirts/Accessoriesの画面、AccessoriesのFirebase 12.18.0、Web SDK配信・キャッシュ・実ブラウザ・実稼働Rules/IAMは未検証。

ケースと受け入れ判定は[追加検証報告](../../docs/EC_STAGE_A_EMULATOR_2026-10-12.md)、保存済み実測値は[結果JSON](../../docs/evidence/stage-a-emulator-2026-10-12.json)を参照。
