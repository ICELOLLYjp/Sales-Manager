# 販売API：隔離最小版の仕様と実装承認単位

後続記録（2026-10-14）：ユーザーが本最小仕様の実装・Emulator検証を承認し、[限定検証結果](METHOD_B_SALES_VALIDATION_20261014.md)へ実装・19項目の適用結果と残件を保存した。以下の「実装承認待ち」は仕様作成時の履歴。配備・製品接続は引き続き未承認。

2026-10-14 JST。今回承認された作業は仕様確定・実装計画のみ。以下は次の実装承認に渡す具体仕様であり、コード実装・接続・配備を承認する文書ではない。

## 1. 基準と優先順位

- Sales #123 head `6f0b0c5a87965a2c4cad449d45e30f7e4a12bde3`、main `aa146a03eb409d0b009d29382fed7baae6ba752d` をGitHub/fetchで確認。main統合なし。
- Website #23 head `85f5e95139e694e5fad7b7e6d0f404a2945ed937`、#24 head `78f9a39dbe83b0bbda31d890a8e85fd91b9be925` を読み取り。#24のDATA_AUTHORITY、EC_APP_RESPONSIBILITIES、復旧監査第9節を確認。#23の「方式B未承認」は後続の#24とユーザー承認により履歴扱い。
- [販売契約案](METHOD_B_SALES_CONTRACT_PLAN.md)第6節A〜Eを本書で最小版について具体化する。過去案との違いは下表に明示。24項目の試験IDと過去の診断結果は変更しない。
- 手動在庫編集25件成功を既存成果として再利用し、再調査・再実行しない。販売APIの成功証拠ではない。C01安全拒否は承認済み、S02は未解決。

## 2. 第6節A〜Eの決定

| 論点 | 次に実装承認する隔離最小版の仕様 | 将来へ残す条件 |
| --- | --- | --- |
| A 範囲 | 既存variantIdを持つTシャツ/アクセサリーのexact SKU、paymentMethod=manual、JPY、1〜20行。複数SKU・両正本文書を跨ぐ販売を含む | manualは支払記録方式であり、在庫の手動絶対数編集や金額のみ販売ではない。Quick・金額先行・決済プロバイダー・実端末接続は未対応 |
| B 価格・値引き・丸め | 合成fixtureのサーバー価格とunitPriceが完全一致。JPY整数0〜1,000,000、割引3項目はすべて0。総額・総数量もsafe integer検査。端数丸めなし | 既存POSは任意価格/値引き、通貨換算、比例注文割引に対応。本最小版はその部分を拒否し、POS全面互換としない。当時価格保証・値引き認可・他通貨丸めは別仕様 |
| C 商品/設定変更 | commit入力にexpectedContextHashを追加。session内の隔離専用policyと参照variantの固定業務情報からサーバーで再算出。不一致は409。売上集計/在庫数量/revisionはcontextに含めない | 実POSへの版導入やquote取得は未実装。旧キューにhashを後付けして当時の合意と偽らない |
| D 旧記録と証拠 | 新規は既存transactionLocks/id内のserverSaleV1へ証拠保存。同IDの旧記録・不完全証拠は409照合待ち。補修・上書き・再採番なし | 旧売上の移行承認手順、取消APIとの証拠更新、実Admin経路の信頼確認は別途 |
| E 上限・再試行・応答 | body 32 KiB、20行、各数量1〜1,000、ID UTF-8最大256 bytes。Admin transaction maxAttempts=3。結果照会とHTTP仕様は下記 | 制限は隔離最小版用。実データの全ID/会計規模に適合すると断定しない。上限外を切捨て・改名しない |

JPY・割引0という境界は業務仕様を変更するものではなく、金額計算の拡張を行わずS02・原子性・冪等性を先に検証するための最小範囲。価格0もfixture価格が0なら認め、負在庫は警告付きで保持する。不明数量・欠損SKUを0へ変換しない。

## 3. 固定入力とcontext

routeはPOST `/v1/sales/commit` とPOST `/v1/sales/result`。commitのキーは既存案のversion/transactionId/sessionId/currency/items/orderDiscount/paymentMethodに **expectedContextHash** を追加する。itemsのキーはlineId/variantId/quantity/unitPrice/setDiscount/manualDiscountのみ。全項目必須、余分キー・不正型・重複JSONキーを拒否。行順は保持する。resultはversion/transactionIdのみ。

IDは空文字、前後空白、制御文字、slash、`.`/`..`、予約された文書ID形式を拒否し、文字列を正規化しない。ID内のdotやUnicodeを任意パスとして解釈しない。transactionId/sessionId/variantIdは固定collectionの単一doc ID、lineIdは表示/照合用でありmovement IDは既存どおり`${transactionId}__${index+1}`。20行・32 KiB・256 bytesを超える場合は明示拒否。最大値ちょうどと1超過を試験する。

価格確認用の合成fixtureとしてsessionに`methodBSalesPolicyV1={version, currency, pricesByVariant}`を設ける計画。versionは正のsafe integer、currency=JPY、価格は全対象variantを固定キーで保持。これはEmulator内だけの新項目であり、現行priceBookの実構造や新しい本番価格正本ではない。fixture以外の価格供給・設定更新APIは作らない。

context hashはSHA-256（小文字64桁）。対象はsessionId、上記policy全体、要求内の重複を除いたvariantをID順に並べた固定projection（variantId、active、category、inventorySource、inventoryKey、bodyId/designId/colorId/sizeId）。未使用座標はnullに固定し、名前等の表示項目は含めない。variantの必須項目不足・矛盾するSKU対応・inactiveは新規販売拒否。projection以外から在庫対応を推測しない。

fixtureの価格/商品対応/通貨変更時はpolicy.versionを必ず増やし、再使用しない。A→B→Aでも旧contextを拒否する。APIはpolicyを書き換えない。サーバー専用fixture作成時にhashを用意し、HTTPテストへ渡す。顧客/旧POSへhashを供給するquote endpointは今回作らない。contextは版照合であり認証の代わりではない。

新規販売はtransaction内でcontext一致とsession.status=openを確認する。再送は認証・入力検証・意図一致と証拠整合の確認後、現在context/session状態が変わっても過去の確定結果を返す。現在のsessionが欠損する等の不整合は照合待ちとし、成功を推測しない。

## 4. 原子性と冪等証拠

Admin transaction内でlock、sale、同IDのmovement群、session、参照variant、対象正本をすべてreadしてからwriteする。孤立movementの検出は要求行数の範囲に限定せず、transactionIdで検索し、文書内IDの一致も調べる。最小版の初回処理はこれらの旧記録が全てないことが条件。存在する記録をsetで上書きしない。

同一commitでsale、既存IDのlock、行別movement、sessionの売上集計/該当イベント販売数、正本の差分を反映する。Tシャツはmaster.inventory_v2、アクセサリーはshared.designsを正本とし、変更対象以外のSKU・metadataを保持。同一文書の複数行は集約して数量を減算し、正本revisionは売上1件につき対象文書ごとに1増やす。売上が触れない正本文書は更新しない。revision欠落は既存契約の0、その他不正値/overflowは拒否する。

既存transactionServiceの売上・movement・集計フィールドへの対応表を実装開始時に作り、fixtureの期待値と照合する。入力のlabel/category/在庫path/合計を受け付けず、サーバーで決定する。既存sale ID・movement ID・fingerprintの計算互換を保つ。新しい売上台帳やinventoryWriteReceipts内の販売receiptは作らない。

lockの`serverSaleV1`は固定schema=`sale-server-v1`、canonicalRequest、requestHash、actorUid、contextHash、result、effectsを持つ。canonicalRequestは全受理入力をobjectキー順に正規化し、配列順序・数値・IDを保持。effectsは実際のSKU、before/after数量・revision、movement IDと効果、session集計差分をサーバー生成する。createdAtはserver timestamp。旧fingerprintは保持し、新digestだけに置換しない。

resultには操作時のcurrency、明細、subtotal/discount/netSales、警告、既存transactionIdを保存。再送時はhashだけでなくcanonicalRequest、sale/lockの対応、明細とmovementの効果・固定値・必須型を照合する。後続売上で変わる現在の正本数量/revisionやsession合計との完全一致は要求しない。記録同士の矛盾、欠損、未知schemaは409。完全なAdmin偽造を防げるという主張はしない。

同ID同意図は書込0で保存結果を返す。同ID異意図は409。別ID販売は固定減算意図のまま最新在庫を読んで有限再試行する。手動編集のbaselineを自動変更する処理を入れない。callbackからHTTP/メール/決済等の外部副作用を起こさない。

## 5. 認可・応答・成否不明

既存隔離と同じ架空3 UID＋email_verified、verifyIdToken(token,true)をcommit/result両方に適用。部外者・未確認は403、欠落/無効/期限切れ/失効tokenは401。Auth通信・内部障害は503、未分類例外は500としてfail closed。業務書込は行わない。無条件のpermission-denied再試行なし。新APIは既存手動APIの401分類を共通修正せず別境界に置く。

成功は200、transactionId/sessionId/outcome/replayed/requestHash/result/currentSaleStatusを返す。400 schema、413 body超過、404未知session/variant、409 context-conflict/session-closed/intent-conflict/reconciliation-required、不正正本も409。既存記録があれば未知データの404より照合待ちを優先する。Admin code 4/10/14は503、他は500で内部詳細・tokenを露出しない。どの失敗もクライアントが元IDやpayloadを捨てる根拠にならない。

resultはread-only transactionで整合したsnapshotを取得し、committed / not-found / reconciliation-requiredを返す。旧案のvoided成功は、取消APIの整合した証拠契約が成立するまで最小版では認定せず、currentSaleStatus=voidedと照合待ちを返す。販売を復活させない。P19/P23の取消完了判定は後続依存として残す。

not-foundは読取時点の観測であり、別commitがまだ進行中なら後で変わり得る。通信断時は同ID・同payloadの再送か照会で確定する。自動で新IDにしない。記録なし新規のsession終了は409、commit済みの終了後再送は200。同一IDの最初のcommitが後で成功し得るtimeoutは「失敗確定」と表示しない。キュー削除/アダプターは今回作らない。

## 6. 24項目の試験への対応と完了条件

P01〜P24の元計画は保持する。次の承認単位は **P01〜P17・P23・P24の19項目を最小仕様の範囲で具体化** する。P18〜P22の5項目は未実施の依存として残し、skipで全体合格にしない。19項目の中にも拡張部分があるため「24項目中19件の全仕様完了」と数えない。

- P01〜P04：Auth Emulator実token、両route、ネスト/重複JSONキー、上限境界、unknown fields、全関連文書のWeb SDK create/update/delete拒否。R02/R09の再発を防ぐ。
- P05/P17：JPY・割引0の両種SKU/複数行/同一SKU複数行、負在庫警告、未知数量拒否、価格/context不一致・ABA拒否。非JPY・非0割引は未対応として拒否試験。既存POSの値引き/FX互換性は未検証として残す。
- P06/P07/P15/P16：同ID同意図/異意図、旧fingerprint外の変更、偽receipt・旧lock・孤立文書・証拠改変。R13の「存在だけで成功」再発を防ぐ。別売上後の正常再送を誤拒否しない。
- **P08/S02必須**：在庫5、qty1のID a/b/aを並列HTTP送信。全3応答が成功（1件は再送）、sale2、movement2、在庫3、revision+2、session取引+2。これが失敗すれば限定実装も不合格。旧S02結果は変更しない。
- P09/P10：同/異SKU、両正本文書、手動編集と競合。実Admin transactionの有限再試行を観測。pessimistic lock下で全callback到達を待つbarrierを使って自作deadlockを起こさない。制御可能な先行lock保持と解放、競合注入を区別して証拠化する。
- P11/P12/P14：実commit後のproxy応答切断、受信前断、再起動、実Emulatorへの不正書込等の故障注入。全関連文書の原子的0/1効果を確認。上限503後も同ID照合で確定可能。
- P13：commit後にfixtureのsession終了/価格改定を行い再送確認。これは終了API統合試験の代替ではない。
- P23：read-only照会、実行中との競合、認証拒否、不整合/voidedの安全拒否。取消済み成功照合はP19とともに後続。
- P24：固定demo・loopbackのみ、実credential/project拒否、秘密のないログ。ネットワーク制限を緩めて動かさない。

独立した販売用JSON/TAPへ版・source SHA・case ID・前後snapshot・再試行数・判定を保存する。架空fixtureのみ。予想失敗への変換は禁止。手動APIの既存25件は再実行しない。ただしP10で既存手動APIを呼ぶ新しい結合ケースは必要な新規検証であり、25件の再実行と混同しない。

## 7. 今週末のPOSへ触れない実装境界

実装承認後も専用branchで`isolated/method-b-sales/`を新設する案。既存method-bは変更せず必要時に既存手動APIを参照。demo project `demo-icelolly-method-b-sales`、Auth/Firestore/HTTPはloopbackの専用空きport（起動前に衝突確認、他processを停止しない）。起動時に固定project/hostを検証し、既存25件環境や本番へfallbackしない。

変更候補は新ディレクトリのruntime/http/sales/validation/test/runner/Rules/config/固定依存lockと文書・新証拠だけ。製品js、SW、functions、root firebase.json/Rules、認証許可リスト、既存POSキュー、他リポジトリを変更しない。productコードを直接書込可能なテスト例外として取り込まない。POS端末でログアウト、キャッシュ削除、更新、販売停止等を行わない。

今週末のイベントにこのAPIを使う計画はない。今回の隔離作業が既存POSの安全性を保証するものでもない。稼働版の未知の問題を見つけた場合は別件として報告し、無断で修正・切替しない。

## 8. ECイベント確保・注文引当への将来接続

Website #23/#24の設計は、確定した持参数でイベント確保を開始し、SKU別最終棚卸の確定保存で解除する。Session終了だけでは解除しない。未同期・未特定は安全側に維持する。イベント開催中も確保分以外の完成品と条件を満たす制作注文を販売する目的を保持する。

将来の販売transactionには、正本減算と対応するイベント残確保の消費を原子的に結び付ける必要がある。例：正本5・イベント確保3でEC可能2。イベントで1点売れた後は正本4・残確保2でEC可能2を維持する。同じ販売を二重控除せず、再送も確保を二重消費しない。確保の永続化先・未特定配分は未確定で、今回新しい予約collectionや空のhookを実装しない。

ECはWooCommerce注文IDに仮確保/確定引当を結び付け、発送までの保持と取消/返金/発送の効果を別契約で定める。EC注文をPOS売上APIへ送りsalesTransactionsへ重複計上しない。既存movementのtransactionId/sessionId/variantId/数量と効果は将来の照合材料になるが、Webhook配送やExactly-once連携を現在保証しない。

POSと注文引当が同じ販売可能数を取り合う時、共通のFirestore transactionで直列化する範囲と、WooCommerce/決済との通信を跨ぐ冪等な状態遷移・再照合を工程Bで設計する。FirestoreとWooCommerceを単一DB transactionとして扱わない。物理負在庫を記録するPOS方針を、ECの無条件注文許可へ流用しない。

アクセサリーの10営業日30点・同意、Tシャツ制作材料/能力、注文時の発送約束、全商品手動停止の維持はEC側の後続条件。今回の販売APIでは計算/変更しない。#24の同一時点DB+ファイル復旧点は未成立、隔離復元未実施。合成fixtureのAPI検証はその復旧を待たず行えるが、staging/Bridge統合や配備には別の復旧・承認条件が必要。

## 9. 次の承認文と停止位置

次の最小承認対象：**本書のJPY・割引0・exact SKU・manual支払に限定し、Sales #123専用branchのisolated/method-b-sales内でcommit/result APIを実装し、P01〜P17/P23/P24の適用範囲を実Auth/Firestore Emulatorで検証する。製品接続・移行・配備・EC確保・注文処理は行わない。**

承認後は①入力/認可/context/証拠とtransaction、②HTTP/照会/隔離ガード、③該当試験と証拠、④残件と引継ぎの順で保存する。安全不合格や範囲を超える依存が出たら未完成として保存し停止。成功してもS02の新API限定解決と旧POS未変更を分けて報告する。

現時点は仕様・計画のみ完成。実装0、試験実行0、配備0。既存25件と旧診断証拠は不変。工程A配備不可、工程B着手不可。3アプリ契約の実適用は未完了。実装承認待ちで停止する。

保存前確認：git diff --check合格、文書リンクの存在確認、24項目の元計画保持を確認。開始headから製品JS/SW、functions、設定/Rules、isolated、tests、既存evidenceの差分なし。変更は本書・契約案・互換性報告・進捗の4 Markdownのみ。これは文書の整合確認であり、新しい安全性試験の成功ではない。
