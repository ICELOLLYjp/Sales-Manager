# 第2段階：操作API契約と認可

2026-10-12。方式B採用はユーザー承認済み。ここで確定する実装は隔離・手動数量編集だけ。他操作は将来設計であり未実装。実3 UID/本番IAM確認は将来配備の停止条件であって、架空Emulator試験には使用しない。

## 共通境界

- Firebase Admin Auth `verifyIdToken(token, true)`でID tokenと失効状態を検証し、UID allowlistとemail_verified=trueを要求。3 UIDは同権限。隔離実装は固定demo project＋Auth Emulator＋架空3 UIDだけ。実用許可リスト・汎用role設定なし。
- Bearer token、POST JSON、固定route、固定schema。任意path/patch/全体データ/余分なキーを拒否。認証確認をDB更新より前に行う。
- 冪等IDと正規化した固定schemaのSHA256 fingerprintを結合。同じID/同じ内容だけ結果再返却、異なる内容は409。IDは既存receipt collectionの同じ名前空間を使用し、旧A1 receiptをサーバー証明として信用しない。旧receipt/不正形式との衝突は409・変更なし。
- 将来も既存POS transactionId/lock fingerprint/movementを維持。新台帳・再採番なし。APIのハッシュを既存POS fingerprintの代わりに無検証で導入しない。
- HTTP 401 tokenなし/無効/期限切れ/失効、403 UID/確認状態、400 schema、404正本/SKUなし、409競合/ID意図不一致/非信頼receipt/不正正本。上限後の競合/停止は503、内部障害500。成功以外でクライアントはキューを消さない。

## 実装する手動在庫編集 v1

`POST /v1/inventory/manual-edit`、単一の既存SKUを編集する。

```json
{
  "version": 1,
  "operationId": "manual-unique-id",
  "stock": "tshirt",
  "sku": { "bodyId": "b", "designId": "d", "colorId": "c", "sizeId": "s" },
  "expectedRevision": 0,
  "expectedQuantity": 5,
  "quantity": 4
}
```

Accessoriesはstock=`accessory`、sku=`{designId, quantityField}`。quantityFieldはpiercing/earringのいずれか（既存designの数量field名）。既存IDは変換しない。SKU IDにslashやdotがあってもFirestoreのpathとして連結せずmapキー/配列IDとして扱う。prototype特殊キーは拒否。operationIdは1〜128のASCII英数字/underscore/hyphen（既存ランダムIDを維持できる範囲）。旧IDが範囲外なら移行判断が必要で、自動改名しない。

最小版は存在するsafe integer数量だけを編集。0/負数を保持し、null/欠落/文字列/小数/不正revisionは拒否、既定0への変換なし。未知/未登録SKUの作成、design追加削除、名前変更、材料、制作、価格は未実装。

Transactionはreceiptと正本を読んでから、(a)既存B receiptの操作一致と結果形式を照合、または(b)expectedRevision==currentRevisionおよびexpectedQuantity==currentQtyを確認する。revision欠落は既存契約どおり0、null/負/小数/上限は拒否。quantity変更がなくても1つの確認済操作としてrevision+1とreceiptを原子的記録する。

**保守的な版契約**：数量だけでは同SKUのA→B→Aを検知できないため、最小版は文書全revision一致を要求。Admin SDKは有限回Transaction再試行するが入力baselineは固定。異SKUでも競合時は409となり得る。無条件自動再baseは禁止。C01の双方成功を満たしたとは報告しない。SKU別の安全なマージは別承認の拡張候補。

正本pathはstockからサーバーが固定選択。変更対象のqty/数量fieldだけをサーバー側の現文書コピーへ反映し、非対象SKU/metadataを保持。revision+1/protocol1/updatedAtだけを共通更新。既存POSの数量/ID/schemaは変えない。T-shirts sharedへの派生同期は未実装。

receiptは同Transactionでcreate（上書きしない）し、schema識別子、actorUid、固定入力、SHA256 intent、実際のbefore/after数量、before/after revision、path、createdAt、再返却する結果を保存する。旧A1 receiptまたは内容不一致は409。クライアントはreceiptを作成/変更/削除できない。Adminによる完全な偽造を防ぐ機能ではなく、Admin境界はIAMに依存する。

応答はoperationId/fingerprint/path/revision/beforeQuantity/quantity/replayed。応答消失後は同じPOSTを再送し、記録済結果を返す。後続更新を巻き戻さず、返却quantityは操作当時の結果であって最新数量ではない。成功照会のため新IDを発行しない。

## 将来の操作別契約（今回未実装）

全操作で固定version、既存ID、期待業務状態/版を要求し、余分キーと不正数量/列挙値を拒否。次表は業務inputの最小境界であり、既存関数全引数の検証/移植完了ではない。

| 固定操作 | 入力候補 | 冪等ID/原子的効果 |
| --- | --- | --- |
| sale | transactionId, sessionId, SKU/未特定区分付きitems, payment種別, expectedSessionVersion | 既存transactionId/fingerprint/lock。sale/session/movement/正本。価格・支払証拠の検証必要 |
| void | transactionId, reason, expectedSaleState | 既存取消lock。取消状態/在庫戻し/movement/sessionを1回 |
| close-normal | sessionId, expectedSessionVersion, 確定計数ID | 既存終了lock。計数/損失調整/終了、exact売上再減算なし |
| close-pending / close-unidentified | sessionId, expectedSessionVersion, 確定SKU別計数 | 既存lockとpending記録。未知を保持して特定分のみ効果 |
| resolve-sku | sessionId, 未特定groupId, sku, quantity, expectedResolutionVersion | 既存解決lock/movement/session/正本。余剰割当拒否 |
| allocate-amount | transactionId, allocationId, sku, quantity, expectedSaleVersion | 既存配賦lock、元movement、sale/session/正本。売上を新規作成しない |
| physical-count | operationId, scope, SKU別計数, expectedRevision, 計数開始識別 | 既存厳格revision。正本/receipt。通常編集との意味を分離 |
| manual-edit | 上記の固定入力 | 今回の唯一の実装対象 |
| consume-materials | operationId, productionTaskId, expectedRevision, 実施数量 | 材料/実施記録/必要な完成品効果をサーバー算出。任意材料patchは禁止 |
| complete-production | operationId, taskId, expectedRevision, completedQuantity | タスク/材料/完成品を原子的に。業務計算は既存関数を照合して移植 |

## 隔離の強制

専用demo project/loopback host以外は起動拒否。既存firebase.json/firestore.rules/functionsを変更しない。Auth Emulatorのunsigned tokenは隔離時だけ有効で、本番認証の試験とはしない。専用Rulesは再帰的にclient writeを全拒否し、架空3 UID/verifiedのreadだけ許可。Admin SDKの直接writeはRulesを迂回するためテスト用fixtureとAPIのみが使用する。

試験はAdminのpessimistic Transactionを実行し、既存Web SDKのpermission-denied retryを追加しない。ループバックHTTP層を通す認証/レスポンス試験と、実Transactionへの故障注入試験を区別する。
