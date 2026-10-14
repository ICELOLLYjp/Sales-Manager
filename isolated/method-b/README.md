# 隔離・手動在庫編集API（製品未接続）

このディレクトリだけが実装対象。既存firebase.json/functions/Webアプリからimportしない。デプロイ用entrypointはない。設計/段階状態は../../docs/METHOD_B_PROGRESS.mdを参照。

依存：`npm.cmd ci --prefix isolated/method-b --ignore-scripts --no-audit --no-fund`。Admin14.4.0、Web11.0.2、rules-unit-testing4.0.1をlockで固定。

既存のJava21とfirebase-tools15.33.0を利用し、リポジトリrootから専用Emulatorを起動する（本番CLI設定を使用しない）。

```powershell
$env:JAVA_HOME=(Resolve-Path '.emulator-runtime/java21/jdk-21.0.12.1+1-jre').Path
$env:PATH="$env:JAVA_HOME/bin;$env:PATH"
$env:FIREBASE_EMULATORS_PATH=(Resolve-Path '.emulator-runtime/cache').Path
$env:CI='true'
node tests/emulator/node_modules/firebase-tools/lib/bin/firebase.js emulators:start --only firestore,auth --project demo-icelolly-method-b --config isolated/method-b/firebase.json
```

APIはAuth Emulatorのtokenを使う隔離試験サーバーとして127.0.0.1にbindする。実認証token、実UID、実データ、ADCを持ち込まない。Auth Emulator tokenは本番の署名付きtokenの安全性を証明しない。既存アプリにこのRulesを配備するとPOS等が拒否されるため配備禁止。

第3段階時点：実装と構文確認のみ。安全合格は第4段階の結果を参照。旧A1の32試験を変更しない。

第4段階：25件成功。専用Emulator起動後、別端末で次を実行（他テストと同時実行しない）。

```powershell
$env:FIRESTORE_EMULATOR_HOST='127.0.0.1:8087'
$env:FIREBASE_AUTH_EMULATOR_HOST='127.0.0.1:9098'
node isolated/method-b/run-tests.mjs
```

artifacts/latest.json・latest.tapを生成。詳細/限界は../../docs/METHOD_B_VALIDATION.md。第5段階の互換性評価は未完了。
