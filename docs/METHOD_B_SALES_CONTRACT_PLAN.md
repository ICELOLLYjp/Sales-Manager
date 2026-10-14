# 方式B：販売API互換契約・隔離試験計画（設計案）

2026-10-13。**文書作成のみ承認済み。販売API、移行アダプター、試験コードは未実装・未実行。** 本書の設計案を実装承認と扱わない。

2026-10-14追記：第6節A〜Eの最小版仕様は[隔離最小版仕様](METHOD_B_SALES_MINIMUM_SPEC_20261014.md)で具体化した。JPY/割引0、expectedContextHash追加、旧記録/voidedの照合待ち、19項目の限定適用と5項目の後続依存を明記。本書の候補表現と異なる箇所は最小版について同仕様を優先する。24項目の元計画は保持し、全POS互換性や実装承認とはしない。

## 1. 承認済み判断と基準

ユーザーは「安全な拒否を許容する」「販売API互換契約・隔離試験計画の作成承認」と指示した。

- C01：手動在庫編集では、別SKUでも正本文書revisionが変われば409として安全拒否する動作を許容する。最新数量の提示後に人が再確認する。不変baselineを自動更新して絶対数量を上書きしない。同じoperationIdの内容は変えず、拒否が確定した操作の再編集は明示的な別操作とする。成否不明なら新IDを作らず元IDを照合する。
- 当初のC01「異SKU両方成功」の試験結果は失敗のまま保存する。今回の受入方針変更は過去結果の改変でも、本番配備の許可でもない。隔離B12の安全拒否結果を根拠として再利用する。
- この許容はS02の売上欠落を認めるものではない。販売は固定数量の減算意図であり、異なる売上IDをそれぞれ1回反映できることが必要。
- PR #123の開始時headは `a95bb39db69332e944e170d86a709423c7cd650f`。GitHubとfetch結果を照合した。baseはSales #121 `71ec1d77691aaa2e194d0eebb55ce207b546b200`。
- 最新mainをfetchして `aa146a03eb409d0b009d29382fed7baae6ba752d` と確認。前回基準 `1c44320108f3db95dc13fe432899568bfdc57ab8` からは日付表示・UI・SW・対応テストの6ファイル更新。transactionService/offlineQueueService/authの変更はない。mainは今回の専用ブランチに統合しない。将来のSW移行試験ではこの差分も取り込む必要がある。
- [第5段階報告](METHOD_B_COMPATIBILITY.md)、[手動API契約](METHOD_B_API_CONTRACT.md)、[書込経路](METHOD_B_WRITE_PATHS.md)、[検証記録](METHOD_B_VALIDATION.md)を継承する。実UID/IAM/稼働Rulesの確認、他リポジトリ変更、本番・POS接続・配備・工程Bは対象外。

## 2. ソースから確認した互換性制約

位置は開始時headの`js/services/transactionService.js`。

| 事実 | 契約への影響 |
| --- | --- |
| :44 createTransactionId、:1146 ID未指定なら採番 | APIではtransactionId必須。キューの元IDを保存し、サーバー採番・再採番しない |
| :370 fingerprintForはsession/currency/itemsの一部とdiscount等をJSON化 | 既存fingerprintを互換性のため保持。ただし支払情報やSKU構成項目の全ては含まれず、新APIの完全な意図照合には単独で使えない |
| :1197以降でlockを読むがsessionがopenかを先に判定し、:1364はfingerprintがあるときだけ不一致拒否 | 新APIは信頼できる既存のcommit証拠を先に照合し、終了済みsessionでも過去の成功を確認する。lockが存在するだけで成功扱いしない |
| :2331 salesTransactions/id、transactionLocks/id、:2352 inventoryMovements/id__行番号を保存 | 既存文書IDと行順を維持。新売上台帳を作らない。行の並べ替えは意味のある変更として扱う |
| :2428 session売上集計、イベント販売数量、正本を同一transactionで更新 | 金額・在庫・movement・lock・sessionの分割commitは禁止 |
| :3336取消は既存lockをmergeしてstatus=voidedへ更新 | 元の販売証拠を保持しつつ取消状態を確認する。販売再送でvoidedをcommittedへ戻さない |
| normalizeItemsは不正値の既定化・切捨て・空行除外を含む | 新APIは不正入力を黙って変換しない。旧キューからの変換で内容を変える必要があれば照合待ちにする |

通常のexact SKUは即時減算、未特定Quickは特定SKUへ強制割当しない。開始在庫だけでは正本を減らさず、終了時にexact売上を再減算しない。0・負数・不明は区別する。負在庫だけを理由に販売停止する仕様へ変更しない。

## 3. 固定API境界の案

候補routeは `POST /v1/sales/commit` と、書込を行わない `POST /v1/sales/result`。いずれも未実装。AuthのID Token検証・失効確認、架空3 UID、email_verified、同等権限を継承する。再送・結果照会も毎回認証し、クライアント申告メールを監査主体に使わない。

最初の隔離実装候補は、既存variantIdを持つexact SKU・手動支払の販売。Quick、金額先行、決済連携をこの候補で処理したことにしない。未対応種類は明示的に拒否し元キューを保全する。通常POS全体への適用条件は別途満たす。

### commitの固定入力候補

```json
{
  "version": 1,
  "transactionId": "sale_existing-id",
  "sessionId": "fixture-session",
  "currency": "JPY",
  "items": [{
    "lineId": "line_1",
    "variantId": "fixture-variant",
    "quantity": 1,
    "unitPrice": 3000,
    "setDiscount": 0,
    "manualDiscount": 0
  }],
  "orderDiscount": 0,
  "paymentMethod": "manual"
}
```

このキー集合を固定し、ネストも余分キーを拒否する。上記金額は商品価格の承認値ではなく架空例。transactionId/sessionId/lineId/variantIdは既存文字列をそのまま扱い、trim・小文字化・切捨て・自動補完・再採番しない。Firestore文書IDとして無効なIDは拒否する。手動編集用128文字制約を根拠なく旧売上IDへ適用しない。上限は既存ID生成形式とfixtureで確認して実装前に固定する。

- quantityは正のsafe integer。金額は通貨別の精度を満たす有限非負値。行割引は行金額以下、注文割引は残額以下。計算上限、端数配賦、行数/body上限は実装前の決定事項。文字列数量、NaN、無限、切捨てを必要とする値、重複lineId、空itemsは拒否する。
- unitPrice/割引は「利用者の販売意図」であって信頼済み計算結果ではない。サーバーで価格/割引の許容方針を確認し、合計・配賦・通貨換算を再計算する。価格改定後のオフライン売上を当時価格で受け入れる条件は未決。最新価格への自動置換は禁止。
- category、SKU座標、inventoryKey/source、在庫効果、actor、status、合計、時刻、receipt、任意path/patchは入力にしない。variant/session/商品情報からサーバーで確定する。variantのSKU対応がキュー作成後に変わった場合は照合待ちにするため、履歴または期待商品版を確認できる仕組みが必要（未実装）。
- currencyはsessionと照合する。支払プロバイダーID・支払完了申告は最小版では受け付けない。決済処理・決済証拠確認は別契約。旧キューのprovider情報を捨ててmanualとして送信しない。
- sessionの売上集計更新ごとに変わるrevisionをクライアント必須条件にして全販売を衝突させない。新規販売の業務状態openと販売停止条件をtransaction内で読み直す。価格/通貨/商品対応等が変化した場合の業務版契約は実装前に確定する。

### 出力とエラーの案

commit成功は200、`transactionId, sessionId, outcome="committed", replayed, result`を返す。resultはサーバー保存の操作時点の通貨・明細・合計・在庫効果・警告。再送では入力から結果を再計算して成功に見せない。`currentSaleStatus`を別に返し、取消済みならvoidedと示す。操作時点の数量を最新在庫表示に使わない。

result入力はversion/transactionIdのみ。認証後にサーバー記録を照合し、`committed / voided / not-found / reconciliation-required`を区別する。not-foundは「読取時点に記録がない」だけで、別リクエストが実行中でないことの証明ではない。新ID発行やキュー破棄の根拠にしない。旧証拠の存在は診断として返しても新API成功と認定しない。

| 応答 | クライアント側に要求する扱い（アダプター未実装） |
| --- | --- |
| 400 schema / 413 size / 未対応種類 | 内容を自動変更せず保存し、対応判断待ち |
| 401 / 403 | 再認証または権限確認待ち。ID変更・削除・無条件再試行なし。認証基盤障害との分類も実装前に決める |
| 409 intent-conflict / session-closed / reconciliation-required / 業務版不一致 | 副作用なし。元payloadを保持し照合・人の判断へ。後から別の売上として自動再送しない |
| 503 / 500 / timeout / 応答消失 | 成否不明として扱い、同ID・同payloadの照会/有限再送。503は有限transaction再試行を使い切った場合を含む。直接書込fallback禁止 |
| committed / voided照合済み | 元IDと送信意図の一致を確認して送信済みと扱う。voidedの販売を復活させない。キュー削除の永続化確認と保全方法は別設計 |

## 4. 冪等性・旧記録・原子性

### 新API作成分の案

既存transactionLocks/idにサーバー専用のversion付き証拠領域を追加する案とする。別の売上台帳は作らない。既存fingerprint/status/IDを保持し、新しいcanonical requestのdigest、actor、操作結果、書き込んだsale/movementへの対応を結び付ける。新領域の名称とschemaは実装前レビュー対象。旧fingerprintの計算を無検証でSHA-256へ置換しない。

全てのDB読取をwrite前に行うAdmin transactionで、(1) lock/sale/movement等を照合、(2) 信頼済み同意図なら保存結果返却、(3) 新規ならsession/variant/正本等を確認、(4) 固定意図から効果を計算し既存文書群へ原子的に反映する。正本revisionを既存共通契約に沿って更新し、非対象SKU/metadataを保持する。既存IDの孤立saleやmovementを上書きしない。

同ID異意図は409。違いが旧fingerprintに現れない場合も新digestで拒否する。itemsの順序は保存し、objectキーの順序だけの違いは同意図とする。販売後の価格改定/session終了で同意図再送の過去成功を消さない。認証拒否は再送にも適用する。

再試行時も売上ID・入力・数量は固定し、最新在庫へ同じ減算をtransaction内で計算する。外部決済やメール送信等の副作用はcallbackに入れない。有限maxAttemptsを設定し、上限後は成否照合可能な503とする。手動編集のexpectedQuantityを再baseする処理とは区別する。

サーバー専用証拠も、直接writerや別Adminが改変できれば信用できない。isolated deny Rulesとfixture/API専用Admin境界が成立する環境だけで評価する。実稼働の信頼境界は未検証。

### 旧記録の扱い（保守的な案）

| 読取状態 | 初期案 |
| --- | --- |
| 信頼済み新API証拠＋同意図＋整合した記録 | 過去結果を返す。取消後は現在状態も返し、追加書込なし |
| 新API証拠の欠損/不正/不整合、同ID異意図 | 409で停止。補修・上書き・再減算しない |
| 旧lockあり（fingerprintあり/なし）、旧saleあり | 自動成功も自動再実行もしない。reconciliation-required。旧fingerprint一致だけでは改変不能性を証明できない |
| saleだけ、lockだけ、movementだけ、部分的な旧記録 | reconciliation-required。欠けた文書を推測して埋めない |
| 全記録なし | 読み取り専用照会ではnot-found。承認された新規入力だけをcommitする。旧キュー移行では停止境界・元payload変換の確認前に新規扱いしない |

旧記録を信頼済みとして移行する照合/承認手順は未設計。実データ取得や自動補修は今回含まない。正本現在値から特定売上の過去効果を逆算するだけでは十分でない。

## 5. 隔離試験計画（全件未実装・未実行）

固定demo project、Auth/Firestore Emulator、loopback API、架空3 UID、合成fixtureだけを使う。既存25件と旧32件は変更せず、販売用の別runner/結果JSON/TAPに保存する計画。各ケースにsource SHA、SDK/Emulator版、入力ID、HTTP結果、前後文書、transaction試行回数、assertionを記録する。個人情報・tokenは記録しない。

以下は**計画24項目**であり、成功件数ではない。未実装の取消/終了等に依存するケースをskipして販売全体合格と報告しない。実装対象が限定された場合は、実行済み・未実施・範囲外とその依存を明示する。

| ID | 条件 | 合格条件 |
| --- | --- | --- |
| P01 | 架空3 UID、部外者、未確認、無token、期限切れ、失効 | 3 UID同等権限。拒否時全業務文書不変。実Auth Emulator token使用 |
| P02 | Web SDKから正本・sale・lock・movement・session・商品/variant・証拠へcreate/update/delete | 全直接書込拒否。API Adminだけで所定効果 |
| P03 | 任意path/patch/全置換/余分キー/偽支払・actor・receipt | 400等の明示拒否、全体状態不変 |
| P04 | 不正ID/数量/金額/重複lineId/上限/未知variant/未対応種類 | 暗黙変換・行除外・ID再採番なし、部分書込なし |
| P05 | 正常exact SKU販売、Tシャツ/アクセサリー/複数行 | 既存IDと行順、計算、movement、session、revision一致。他SKU/metadata保持 |
| P06 | 同ID同意図の逐次再送・objectキー順変更 | sale1、各movement1、減算1、集計1。保存された同じ結果を返す |
| P07 | 同ID異意図（旧fingerprintに含まれない項目も） | 409。最初の売上と在庫を保持 |
| P08 | S02対応：在庫5、qty1のID a/b/aを並列HTTP送信 | 3要求成功（再送含む）、sale2、movement2、qty3、正本revision+2、session取引+2。有限競合下で収束 |
| P09 | 異ID・同SKU/異SKU並列、強制transaction競合 | 意図固定で再読取・再計算。成功操作のみ各1効果。再試行上限時は503かつ部分更新なし |
| P10 | 手動編集と販売が競合 | 手動の古いbaselineを409拒否するか直列化した効果。販売欠落なし。手動の自動上書きなし |
| P11 | 実commit後にHTTP応答をproxyで切断 | 同ID再送で保存結果、追加減算なし。旧S04/B13を販売APIで検証 |
| P12 | 受信前切断、実transaction中断、API停止/再起動 | 原子的0または1効果。照会＋同ID再送で確定できる。直接fallbackなし |
| P13 | commit後にsession終了・価格変更、その後再送 | 初回成功の照合可能。新価格で再計算・再減算しない |
| P14 | sale/lock/movement書込時の実Admin transaction故障注入 | 正本/sessionを含め部分書込0。単なるmock例外のみでは合格にしない |
| P15 | 旧lockのfingerprint有/無、旧sale、一致/不一致 | 全て所定の照合待ち。偽receiptや旧lockだけで更新スキップ成功なし |
| P16 | 孤立文書、新証拠の改変、不一致movement | 拒否、上書き/修復/減算なし。状態差分で確認 |
| P17 | 価格・割引・通貨端数・上限・負在庫・未知数量 | 承認された計算規則と一致。負在庫警告を維持、不明を0にしない。価格方針確定が前提 |
| P18 | raw旧キュー、同ID異payload、壊れたJSON、storage失敗、複数タブ | 元ID/payload保全、黙った欠落なし。アダプター別承認まで未実施 |
| P19 | 販売再送と取消、取消後販売再送 | 販売復活なし、戻し1回、結果に取消状態。信頼できる取消API設計/実装が前提 |
| P20 | 新規販売と通常/保留/未特定終了の並列 | 同一sessionの合法な順序だけ成立。終了後新規販売拒否、既存販売再送照合、二重減算なし。終了APIが前提 |
| P21 | Quick/金額先行→後日SKU確定/配賦→再送 | 元売上ID保持、未特定を勝手に減算せず、配賦1回。各API契約・実装が前提 |
| P22 | 旧SW/旧タブ/認証切替・API停止のクライアント | 旧writer拒否、キュー削除なし。iPhone/旧ブラウザは別途実機承認・試験が必要 |
| P23 | result照会と実行中commitの競合、取消済み/不整合 | not-foundで新IDを発行しない。現在状態と過去結果を分離、未認証照会拒否 |
| P24 | 環境変数・credential・host・projectの誤設定 | 本番接続前に起動拒否。ログにtoken/秘密なし |

並列ケースはPromise.allだけに頼らず、fixture専用の読取後barrier等で競合を制御し、実Admin SDK transactionを使う。hookは製品設定に入れない。拒否系は対象文書だけでなく全関連文書の前後snapshotを比較する。成功系は文書数、ID、数量合計、session集計、revisionを独立にassertする。終了/取消の競合試験で旧Web writerをdeny Rulesの例外として許可しない。Adminの仮の状態変更fixtureだけでは業務API互換性合格にしない。

## 6. 次に決める事項・停止境界

実装承認前に、(A)最初のexact SKU/manual支払という範囲、(B)オフライン当時価格・値引き・通貨端数の規則、(C)商品対応/販売設定の変更検知、(D)旧記録の照合待ち運用と新lock証拠schema、(E)入力上限・有限再試行・エラー分類をレビューする。旧キューの内容を現行価格へ変更してまで自動送信しない。

その後に必要なら「限定販売APIとP01〜P17/P23/P24の実装・隔離実行」を別途承認する。ただしこれだけでP18〜P22や全POS互換性を合格としない。取消・終了・配賦・棚卸・制作/材料・他2アプリへの拡張、実機、稼働認可、移行・配備は別承認。

今回の完成物はこの設計案と進捗記録。製品/隔離API/試験/既存証拠を変更せず、実行試験0件。既存25件を再実行しない。安全拒否の承認によりC01の受入方針は決定済みだが、S02は依然未解決。方式Bの3アプリ全体適用は未完了。**工程A配備不可、工程B着手不可、実装承認待ちで停止。**

文書確認：diffチェック合格、参照先文書の存在を確認、P01〜P24の重複なし。既存試験JSONに記録された8ファイルのSHA-256が一致し、開始headから製品・隔離API・試験・証拠・PROJECT_HANDOFFの差分なし。これらは保存状態の確認であり、安全性試験の追加成功には数えない。

再開時はPR #123の最新head、本書、第5段階報告、進捗記録を読み、承認された範囲だけを進める。文書の復旧は追加訂正/revertで行う。元売上ID/キュー/過去証拠を消さず、直接書込の復活やforce-pushを行わない。
