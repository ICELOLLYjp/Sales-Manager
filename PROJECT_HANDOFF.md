# ICELOLLY Sales Manager — PROJECT HANDOFF

## 2026年10月8日 13色の実登録完了と共通参照の実装

利用者からCloud Shellの適用結果を受領：status=applied、confirmedColors=13、createdJapanBlack=true、metadataRevision=1、inventoryQuantityChanged=false。これはメタデータ登録の成功であり、各アプリの新しい表示コードの公開成功ではない。Japan Blackの新規固定IDはcolor_15gcow、MIJのbody_2um63vに対応し、メーカーJPC-001の02ブラックを参照する。完成品セルと商品バリエーションは自動作成しない。

同じ参照モジュールをTシャツ在庫管理、Sales Manager、EC読取APIへ追加する変更を作成。既に読み込んだmasterのmanufacturer_color_linksのみを参照し、名前やSKUから推測しない。固定ID、schemaVersion、revision、レコード版、確認日と項目を検証し、欠落と不一致は未確認とする。出力は正式カラーの公開参照項目に限定し、履歴や任意の私的項目は含めない。

在庫管理のColor設定は現在の管理名と販売名を保持し、品番・正式名・コードを読み取り専用で併記。Sales Managerの現在在庫行、Master options、新規Variant draftは元の名称・ID・数量を保持し、manufacturerColorまたはmanufacturerColorsを補助データとして付加する。POSと履歴の画面表示変更は含めない。EC APIは各行のmanufacturerColorと全体のmanufacturerColorsを返し、在庫セルのないJapan BlackやLight Purpleの対応も全体の参照に含められる。新しい在庫行は生成しない。v2の旧SKU照合と参考価格は維持。Firestore GETマスクに共通メタデータのschemaVersion・revision・itemsだけを追加し、履歴は取得対象に含めない。

ローカル検証はAPIと既存在庫、bulk、REST、runtime、共通参照87項目と、Tシャツ表示・Sales Manager参照5項目が成功。各コピーは同一ソース。実ブラウザーとiPhoneでの表示確認は未実施。各アプリのmainは変更しない。TシャツとSales Managerは専用作業ブランチとDraft PRへ、Websiteは既存Draft PR #3へ保存する。staging APIはまだ0.37.1、WordPressプラグインは0.46.0のまま。APIの新機能は更新後に有効となる。WordPressのメーカー共通画面との自動対応連携は次工程。


Last reconciled: 2026-09-30
Repository: `ICELOLLYjp/Sales-Manager`
Reference `main` at reconciliation: `27bdacbcaa0d307c9cbbef4da0f825220e3ec5ee`

This is the canonical handoff for future development chats. Inspect latest `main` before editing; this file describes the intended invariants, what is already implemented, and what still needs work.

## キーボードでの数量入力 2026年10月1日

Sales Manager、T-shirts-Stock、Accessories の通常在庫およびイベント棚卸の数量欄に、Tab / Shift+Tab、Enter、上下左右の移動を追加。対象は数値入力欄で、操作ボタンを飛ばして次の数量欄へ移動する。通常在庫の保存後に画面が描き直されても、移動先SKUの入力欄へフォーカスを戻す。保存のタイミング、在庫権限、0と不明の扱いは既存の処理を使う。Sales Manager PR 108、T-shirts-Stock PR 17、Accessories PR 1 を各mainへマージ済み。実機での連続入力と保存の確認は未実施。

## Gmail経費取り込みの現在地 2026年9月30日

1. 通常の入口はイベント一覧の「Gmail経費を取り込む」、または経費管理の「イベント経費をGmailから取り込む」。どちらも `gmail-expense-intake.html` を開く。イベント一覧には「イベント情報を編集」「売上・経費・収支を見る」「持参・終了在庫を見る」も表示する。従来の個別取得画面と確認画面は補助的に残す。
2. 取り込み画面では対象イベントを選び、開始月から過去1か月、3か月、6か月を2つのGmailで検索する。本文プレビューだけでは候補保存や経費登録をしない。必要なメールを選び、「選んだ候補を保存してイベントに割り当てる」を押す。PR 101で、このボタンに欠けていたクリック処理を接続した。
3. 保存済み候補は同じ画面の下部で本文、PDF、Excel添付の抽出結果を一時確認できる。元ファイル全体はGmailで確認する。人が金額、通貨、支払証拠を確認する。未払いは下書き保存し、支払済みの証拠がある候補だけを個別に経費登録する。売上報告など、検索に混じる経費以外のメールを自動計上しない。
4. `.xlsx` の解析は最大5 MiB、ZIP項目200、展開後20 MiB、最大20シート。実データで各シート200行、24列までを判定し、表示は全シートから合計12,000文字までの抜粋。PR 102では書式だけが付いた空セルを行列の上限に含めないよう修正した。月次売上報告の実ファイル10シートで解析成功を確認した。旧形式の `.xls` と元ファイルのダウンロードには対応していない。
5. PR 99からPR 102まで `main` に反映済み。2026年9月30日に利用者から Firebase Functions の `Deploy complete!` が報告され、その後Excelの文字表示も確認された。Stripe FunctionsやFirestore Rulesは対象にしない。
6. Excelの文字列だけでは列の関係が分かりにくいため、構造化したシート別の表表示を追加した。先頭と末尾の行を最大合計240行表示し、省略行数を示す。元の書式と結合セルは再現しない。表表示には今回の画面更新と Firebase Functions の再デプロイが必要。

2026年9月30日追記: PR 105のExcel表表示について、利用者から Functions のデプロイ完了と、見やすく確認できたことが報告された。PDFは今回、元ページの埋め込み表示、別画面で開くリンク、抽出文字の折りたたみ表示を追加。新しい画面は認証済みの添付確認時にだけ元PDFを要求する。1ファイル5 MiB、1回の応答の元PDF合計5 MiBまでで、超過分は元メールで確認する。元PDFはブラウザ内で一時表示し、Firestoreやログに保存しない。画面更新時とログアウト時にBlob URLを解放する。文字解析は従来どおり最大3添付、20ページ。画像PDFは元ページで目視確認する。PDF変更は今回の Functions 再デプロイが必要で、iPhone実機での表示確認は未完了。

---

# 1. Core operating rules

- iPhone is the primary production device. Event-day UX must prioritize large touch targets, few taps, and readable state.
- Preserve existing Firestore data, SKU identities, prices, and inventory authorities.
- T-shirt canonical real stock: `tshirtStock/master.inventory_v2`.
- `tshirtStock/shared` is not canonical T-shirt real stock.
- Accessory canonical real stock: `accessoryStock/shared.designs`.
- Exact SKU sales decrement canonical real stock immediately at checkout.
- Event opening inventory does not decrement canonical stock.
- Event closing must never decrement exact SKU sales again.
- Restock / Opening correction are event-flow records and must not cause double stock mutation.
- Unknown Quick or amount-only sales must never be forced into an arbitrary SKU.
- Negative stock may be recorded as a warning; event checkout must not stop solely because stock reached zero.
- Unknown and zero are different states. Never convert unknown to zero automatically.
- A workflow may continue with all, some, or none of the unknown items resolved. Preserve unknown state explicitly.
- `salesTransactions` is the sales source of truth. Stripe/Wise/PayNow are payment evidence, not duplicate sales ledgers.

Tracked event-inventory categories:

- `tshirt`
- `pierce`
- `earring`
- `drop_pierce`
- `drop_earring`

Non-tracked sales such as postcard/sticker/art print may be sold without event-stock allocation.

---

# 2. POS model

Three POS entry modes coexist and are intended to be used in parallel:

## Quick

- Fast category/body based sale entry.
- Can remain without exact SKU.
- Tracked unresolved Quick items remain `pending_allocation` / unidentified.

## SKU

- Exact Variant sale.
- Canonical stock decremented immediately.
- Event `soldByVariant` updated.
- Same cart can mix Quick and SKU lines.

## 最速 / amount-only

- Enter only the total amount and check out immediately.
- Optional classification hint: `完全未分類 / Tシャツ / アクセサリー / その他`.
- Hint is not SKU confirmation and does not decrement canonical inventory.
- Manual/other payment can be queued offline.
- Stripe QR is available online.
- Unclassified amount-only sales must later be classifiable without duplicating revenue or inventory mutation.

Current mode UI:

- Quick = blue
- SKU = green
- 最速 = Stripe-family purple
- Main POS and Fast POS both expose Quick / SKU / 最速 switching.
- The three mode buttons are intended to have equal width/height on iPhone.
- Fast POS now also shows connectivity/offline-prepared state and shared Session selection.
- Session selection is shared with normal POS via `icelolly-sales-active-session` / normal `#posSessionSelect` behavior.

Current Singapore reference pricing retained:

- Sticker SGD 5; 3 = 13; 5 = 20
- Postcard SGD 5; 3 = 13; 5 = 20
- Earrings SGD 22; 2 = 40
- Drop Earrings SGD 26; 2 = 48
- A3 Art Print SGD 25; 2 = 45
- Pigment T-shirt SGD 52
- Organic Cotton T-shirt SGD 55
- Made in Japan T-shirt SGD 85
- Any two T-shirts = SGD 8 off

---

# 3. Event inventory model

Event inventory means stock physically brought to the event, not total company stock.

Base theoretical event quantity:

`Opening + Restock + Opening correction - exact SKU sales`

Identified Quick / discrepancy adjustments are applied only by the appropriate reconciliation/finalization path and only once.

## Flow records

`inventoryCount.flowEntries`

Supported:

- `restock`
- `opening_correction`

`eventFlowAccountingService.js` produces flow-adjusted opening rows while preserving the original opening record.

## Checkpoints

`inventoryCount.checkpoints`

Supported types:

- `checkpoint`
- `daily_close`
- `final_count`

Checkpoint reuse is per SKU, not one global latest checkpoint. T-shirts and accessories may therefore be counted at different times. A SKU can be reused only when no relevant sale / Restock / correction / ambiguous Quick change occurred after that SKU's checkpoint.

UI states:

- `✓ 再カウント不要`
- `要再確認`

## Explicit count state

T-shirt and accessory event-count pages distinguish:

- confirmed number including explicit `0`
- `不明` / unknown

Unknown is stored as unknown/null and is not converted to zero.

Partial final count is allowed; remaining unknown rows may flow into pending-inventory close.

---

# 4. Event inventory operation UI

Top inventory operation is intended as **イベント在庫運用** during an active event.

It contains:

- T-shirt inventory board
- Accessory inventory section
- predicted/current event quantity
- Restock
- Opening correction
- intermediate count
- daily close
- unregistered event item handling

T-shirt board direction:

- Vertical: Design / Body / Color
- Horizontal: S / M / L / XL / XXL
- Zero-opening valid SKU cells remain operable.

Accessory inventory is a separate first-class section, not hidden in `その他`.

---

# 5. Multi-day operation

Implemented daily operation:

`sales -> intermediate count -> daily close -> next day -> sales -> ... -> final close`

Daily close may proceed in three ways:

- all tracked SKUs counted
- partially counted with unknown remaining
- no new count at all

Daily close does not close the Session and does not mutate canonical stock by itself.

Implemented fields include:

- `inventoryCount.dailyCloses`
- `inventoryCount.dailyState`

Daily history stores at least:

- confirmed/inherited/unknown counts
- exact SKU sales for the day
- Quick units for the day
- Restock
- Opening correction
- item-level count/inherit/unknown state

`eventDailyInventoryTrendService.js` / UI shows Day-by-Day inventory history across T-shirts and accessories, including zero vs unknown distinction.

---

# 6. Event close / unresolved policy

A Session may proceed without resolving everything.

Supported direction:

- provisional POS stop without count
- partial count
- formal close with unresolved Quick / unknown inventory remaining
- later SKU resolution

Do not block the user merely because some SKU/count is unknown.

Pending inventory state is recorded rather than fabricating a value.

Exact SKU sales are already stock-applied and are not applied again at close.

Flow-compatible close wrappers exist for Restock / Opening correction.

## Late SKU resolution

Implemented post-close resolution can link previously unidentified Quick quantities to a formal SKU and apply only the newly resolved quantity once, with movement/audit history.

After all unresolved quantities are resolved, Sessions UI can return from an unidentified-ended state to a resolved closed display.

---

# 7. Unregistered event products

Implemented event-only temporary product rows live separately from canonical SKU inventory.

They must not create a fake formal SKU or mutate canonical stock merely by being added.

Current temporary model supports:

- event temp ID
- source
- category
- label/detail
- T-shirt body/color/size metadata when known
- opening known/unknown
- current/closing quantity
- unregistered/linked state
- later formal Variant link

Unregistered items may remain unresolved when the event closes.

---

# 8. Transactions / inventory movements

Primary collections:

- `salesTransactions`
- `inventoryMovements`
- `transactionLocks`

Transaction IDs are idempotent. Conflicting reuse of the same ID is an error.

Voids preserve sale history and restore exact SKU stock.

Inventory movement reasons include:

- sale
- return
- loss
- theft
- damage
- gift
- sample
- stock_adjustment

---

# 9. Offline

Offline queue and POS snapshot are implemented.

Rules:

- keep same transaction ID after reconnect
- do not formally close while checkout data remains unsynced
- Fast amount-only manual checkout can be queued offline
- Stripe QR requires online connectivity
- Fast POS shows whether the selected Session is prepared for offline use

Field-test the entire workflow at the next real event; do not forcibly rewrite/close the old Public Garden test Session merely to validate new flows.

Recommended pre-event validation: run a small 5-10 product test Session the day before the real event.

---

# 10. Stripe

Client: `js/services/stripePaymentService.js`
Backend: `functions/index.js`

Implemented code includes:

- Checkout creation
- QR rendering
- status lookup
- expiration
- committed marker
- refund
- recoverable paid-payment listing

`salesTransactions` remains source of truth. A Stripe payment must link to the intended Sales Manager transaction and must not create a second sale.

Refund order:

`Stripe refund -> Sales Manager void -> inventory restore`

Stripe secrets stay in Firebase Functions secrets.

---

# 11. Costs / FX / finance

Cost history is effective-dated.

T-shirt cost priority:

`SKU override -> outsourced all-in -> Body -> missing`

Sale-time cost snapshots preserve historical accounting.

FX is still partial. Manual Session FX exists; sale-date/payment-date/current/actual-provider rate handling is not fully implemented.

Wise / PayNow many-to-many reconciliation and full final-profit reconciliation remain future work. Gmail preview, explicit candidate storage, saved-candidate review, bounded evidence inspection, PDF extraction, evidence drafts and explicit event-expense posting are live-tested. Mori Market orders `11333138` and `11339404` were posted separately for a combined `16,950 TWD`, and both entries were confirmed separately in the production event detail. Safe void is implemented and unit-tested but must be live-tested only with dedicated test data. Explicit assignment to an existing sales Session, general business, or unassigned remains required.

---

# 12. Current implementation status

## Implemented / substantially implemented

- Quick + SKU mixed cart
- exact SKU stock mutation at checkout
- negative-stock warning without checkout block
- idempotent sale + void restore
- offline queue / POS snapshot
- transaction history search/filter
- event Restock / Opening correction
- T-shirt event inventory matrix
- accessory event inventory section
- independent per-SKU checkpoint reuse
- T-shirt/accessory intermediate count support
- explicit zero vs unknown count
- partial/unknown close continuation
- event-only unregistered product rows
- later linking of temporary/unidentified items
- post-close SKU resolution with one-time stock application
- daily close -> next day
- daily inventory trend view
- amount-only fastest POS
- amount-only Stripe QR
- Quick / SKU / 最速 three-way switching
- Fast POS offline state + shared Session selector
- amount-only history classification to category or one exact SKU
- one-time canonical stock application when an amount-only sale is classified to SKU
- normalized T-shirt sales reporting under `category=tshirt`
- independent T-shirt sales dimensions for Design, Body, Color, and Size
- cost schedules/snapshots
- Stripe client/backend foundations
- Gmail readonly OAuth for two approved accounts
- staff-only manual Gmail metadata preview, live-tested for both accounts
- metadata preview does not save candidates or post expenses automatically
- explicit candidate save, live-tested with 25 new records and a repeat save producing 0 new / 25 existing
- explicit event-expense posting, live-tested with two Mori Market entries totaling `16,950 TWD`
- event expense detail, live-tested with orders `11333138` and `11339404` shown separately
- safe single-entry void with idempotency and audit protection, unit-tested only
- independent expense-management hub linked from More, covering Gmail connection, candidate acquisition and saved-candidate review
- contextual Session link that opens saved Gmail candidates prefiltered to the selected event

## Needs field test

- full real event from opening -> sales -> Restock -> checkpoint -> daily close -> next day -> final close
- mixed T-shirt/accessory checkpoint reuse under live traffic
- unknown/zero partial final counts in production
- post-close unidentified SKU linking after a real event
- Fast POS manual/offline sync under unstable network
- Fast POS Stripe QR on event-day live environment
- Fast POS shared Session switching when a normal POS cart already has items
- amount-only later classification, including subsequent sale void and stock restore
- T-shirt category and four-dimension aggregation against mixed historical and new sales

## Remaining integration debt

- event close architecture still contains compatibility layers and older/newer models; avoid starting another competing close model
- T-shirt reporting now normalizes `category=tshirt`; continue field-testing historical aliases and unresolved Quick rows
- current event stock vs physical excess reasons can be presented more clearly
- overall event UI can still be simplified after field test

---

# 13. Remaining backlog

## High priority after next field test

1. Fix defects found by the real-event end-to-end test.
2. Field-test later allocation of amount-only sales to category or one exact SKU, including duplicate-tap protection and subsequent void.
3. Field-test normalized T-shirt sales aggregation across exact SKU, Quick, and category-only sales.
4. Analytics: popular size/design/color, sell-through, SOLD OUT, Restock effect, event/city/country comparison.
5. Lost-opportunity capture; do not infer lost sales only from negative stock.

## Later

- generic promotion builder
- Wise / PayNow many-to-many reconciliation
- Gmail candidate pagination and per-account partial failures
- general business expense ledger and reviewed posting
- sale-date/payment-date/current/actual-provider FX stack
- final event financial reconciliation
- Session notes / event review
- full Consignment workflow
- full Wholesale / Buyout workflow
- Help / Quick Start
- short Sales Manager Stripe QR URL

Long-term navigation direction:

`販売 -> 在庫 -> 日次締め -> 収支 -> 分析`

---

# 14. Security note

Intended access is authenticated allowed staff only.

Repository `firestore.rules` has historically allowed any signed-in user to read/write. Confirm actually deployed Firestore Rules before changing security code; do not assume repository rules equal production rules.

---

# 15. Current key files

Core:

- `index.html`
- `js/app.js`
- `sw.js`

POS:

- `js/services/transactionService.js`
- `js/services/offlineQueueService.js`
- `js/posUxEnhancements.js`
- `js/transactionHistorySearch.js`
- `js/fastPosUi.js`
- `js/fastPosModeEnhancement.js`
- `js/fastPosSessionEnhancement.js`
- `js/services/fastAmountSaleService.js`
- `js/services/fastAmountAllocationService.js`
- `js/fastAmountAllocationUi.js`
- `js/services/salesAggregationService.js`
- `js/tshirtSalesAggregationUi.js`

Event inventory / close:

- `js/inventoryFlowPanel.js`
- `js/inventoryFlowAccessoryUi.js`
- `js/services/inventoryFlowService.js`
- `js/services/eventFlowAccountingService.js`
- `js/services/eventCheckpointReuseServiceV2.js`
- `js/eventCheckpointReuseUi.js`
- `js/services/eventDailyCloseService.js`
- `js/eventDailyCloseUi.js`
- `js/services/eventDailyInventoryTrendService.js`
- `js/eventDailyInventoryTrendUi.js`
- `js/services/eventUnregisteredItemService.js`
- `js/eventUnregisteredItemsUi.js`
- `js/services/eventLateSkuResolutionService.js`
- `js/services/eventLateSkuResolutionSessionService.js`
- `js/eventLateSkuResolutionUi.js`
- `js/eventLateSkuResolutionSessionsUi.js`
- `js/services/closeWithPendingInventoryService.js`
- `js/services/eventCloseService.js`
- `js/services/eventCloseServiceCompat.js`
- `js/services/eventCloseFlowCompatService.js`
- `js/services/unidentifiedQuickService.js`
- `js/services/closeWithUnidentifiedService.js`
- `js/services/closeWithUnidentifiedFlowCompatService.js`
- `js/services/provisionalWithoutCountService.js`
- `js/eventCloseHubUi.js`
- `js/eventCloseStageUi.js`
- `js/sessionStatusUi.js`

External event count apps:

- `ICELOLLYjp/T-shirts-Stock/event-count.html`
- `ICELOLLYjp/Accessories/event-count.html`

Stripe:

- `js/services/stripePaymentService.js`
- `functions/index.js`
- `stripe-result.html`

Cost/pricing:

- `js/services/costHistoryService.js`
- `js/services/priceBookService.js`

Security/config:

- `firestore.rules`
- `firebase.json`

---

# Next implementation focus

For Gmail expenses, preserve this sequence: manual metadata preview -> explicit candidate save -> event/general classification -> human review and duplicate warning -> explicit bounded body/attachment inspection -> human-reviewed evidence draft -> PDF extraction when present -> separate user-approved expense posting. Body and PDF inspection is allowed only for candidates marked kept, and raw body/attachment bytes and extracted PDF text are not persisted during inspection. Temporary HTML evidence display decodes bounded named and numeric character references for readability. Posting is event-only, requires paid evidence, matching event currency, a configured exchange rate for non-JPY events, a separate confirmation dialog and a transactional current-amount check. It is idempotent and locks the candidate after posting. Event detail lists active Gmail-posted entries through a staff callable; Mori Market orders `11333138` and `11339404` were confirmed separately in production under the total of `16,950 TWD`. Voiding one entry requires a second confirmation and one transaction that subtracts only that amount, records an audit and unlocks the candidate for correction; retrying must not subtract twice. Live-test void only with a dedicated test candidate and test event, never with the two production Mori Market entries. Fetching, parsing, classifying or saving a candidate must never post an expense. Order `11333130` for `8,550 TWD` belongs to a separate 20 to 22 November event and must remain unassigned until that event is created. A PDF invoice is not payment proof. Deploy only `functions:gmail-expenses`; never deploy the tracked Firestore rules with this work.

Do not add another large inventory-close model before the next real-event field test. Amount-only later allocation and normalized T-shirt sales aggregation are implemented.


---

# 16. Real event field test notes 2026-09-25

Recorded: 2026-09-26

The app is being tested during a real event. Treat the items below as field observations. Reproduce and verify them after the event before changing data models or large workflows.

## Confirmed during the event

1. Fast POS mode switching was rechecked after an earlier concern. Quick, SKU and 最速 tabs were displayed correctly, so this is not currently treated as a reproducible defect.

2. Rapid repeated taps on iPhone could trigger Safari double tap zoom and interfere with event operation. PR 45 added the interaction fix and PR 46 refreshed the cached CSS. The user confirmed during the event that the issue improved.

## Needs reproduction or verification after the event

1. Accessory quantities entered through inventory registration appeared not to be reflected in SKU POS. Verify whether this is an actual data linkage defect, stale state, or an operation issue. Preserve `accessoryStock/shared.designs` as the canonical accessory stock source.

2. Verify behavior when the user moves to another screen or starts another operation while a Stripe checkout is still in progress. Payment success, Sales Manager transaction creation, inventory mutation and duplicate protection must remain consistent. Until verified, event operation should wait for payment completion before leaving the checkout flow.

## UX and workflow improvements identified during the event

1. The difference between the event inventory actions currently shown as 補充 and 修正 is not clear enough during live operation. Confirm the exact behavior of each action and rename or explain them so the result is immediately understandable.

2. A mistaken inventory flow operation is difficult to correct afterward. Consider a safe correction workflow such as undoing the latest operation, editing through an audit history, or entering a verified physical count without losing the original history.

3. 棚卸なしで仮終了 should be able to end the event Session operationally while keeping inventory reconciliation pending. The event can be closed for sales while inventory remains explicitly unconfirmed and can be completed later.

4. Sessions should be sorted by event date in descending order so the newest event appears first.

5. In sales detail, 経費差引き収支 should appear above the 経費 section so the final event result is visible before expense detail.

6. After an event, the accessory and T shirt inventory management screens should be usable directly for stocktaking. The desired flow is to compare theoretical stock with the physical count, show differences, review them, and then apply the confirmed result to canonical real stock.

## Field test handling rule

During the event, record observations first and avoid large changes unless a small isolated fix is necessary for operation. After the event, classify each item as a reproducible defect, an operation issue, or a UX improvement before implementation.


## Accessory SKU registration follow up 2026-09-26

Code investigation found a reproducible gap: event opening inventory accepts accessory rows from the canonical stock catalog even when the corresponding productVariants entry is absent. SKU POS filters accessory rows by productVariants, so a positive saved opening quantity alone does not make an unregistered accessory available in SKU mode. A separate manual registration button exists in Inventory.

Merged PR 48 registers only missing accessory SKU metadata from canonical accessoryStock/shared after a positive event opening is saved. It does not change canonical stock quantities or existing sales. If registration fails, the opening remains saved and the user receives a warning. Focused regression tests pass. Production Firestore state for the affected event has not been inspected; verify the actual missing SKU IDs and the result on a dedicated test Session before applying any data changes. The code was merged to main on 2026-09-26, but no production inventory data was changed.


## Accessory full stock entry and late recovery 2026-09-26

User operation: most accessory stock is brought to each event. The event opening form now has a dedicated accessory only button that fills all accessory quantity inputs from the server read canonical stock snapshot. It preserves T shirt entries, supports the existing undo and local draft, and requires the normal explicit opening save. The existing all categories button remains available.

Mori Market has an opening record and active sales, so its opening cannot be overwritten. Merged PR 48 adds a separate inventory operation that previews missing accessory SKUs and inserts only currently unrepresented positive canonical stock quantities as audited opening correction flow entries in one Firestore transaction. It skips any SKU with positive opening, prior flow history or exact SKU sale. A retry sees the new flow and adds nothing. It never changes canonical real stock or sales. Zero opening can also mean deliberately excluded stock; therefore the user must review the proposed count and correct any items not physically present before accepting. Mori Market accessory sales to date were entered only through Quick mode because accessories were not registered at event opening. These transactions do not identify accessory SKUs. The recovery action must not infer a SKU allocation or reduce a specific SKU's expected event remainder for those sales; its per-SKU remainder is provisional until physical counting and later explicit reconciliation. The review UI warns about this before the one-transaction addition. Unknown Quick sales remain unresolved.

The inventory count reader and SKU POS include valid Restock and opening correction flow quantities so a late added SKU can appear with the expected event quantity after product SKU metadata registration. PR 48 was squash merged into main as ff35bc1777a51bd2aebae0fe15a2867e2d349b4d. The six focused tests pass. No authenticated production Session or physical item list was available in this work session, so the Mori Market bulk action was not invoked. Verify the bulk result, duplicate tap behavior, screen refresh, product registration, event close summary and real event exceptions on an isolated test Session. Do not apply a bulk correction to production Mori Market until its candidate SKU list and physically present quantities have been checked.


## Existing accessory SKU recovery after Mori Market screenshot 2026-09-26

The production UI screenshot showed 83 active event accessory SKUs, but no missing stock backfill control. The stock backfill control is intentionally hidden when there are no positive canonical stock rows absent from the event opening and flow history. An opening row with a positive quantity does not prove its corresponding productVariants metadata exists, and the previous automatic registration only ran after a new opening save. Merged PR 49 at 5493514fbc7b0f61c4d77cad2102fff25091fbab adds a separate on-demand action in the Accessory inventory card to inspect productVariants and register only missing metadata for accessory SKUs already represented by opening or flow quantities. It displays the missing names for confirmation and does not change event opening/flow quantities, canonical stock or sales. If none are missing, it reports that registration is complete. The actual production productVariants collection was not inspected because the remote browser was not authenticated. Do not claim the 83 SKUs are missing metadata before running that check. Keep Quick sales unresolved and per-SKU expected quantities provisional.


## T-shirt event design visibility 2026-09-26

The user observed T-shirt designs not brought to the active event in SKU POS. The event opening saves zero placeholder rows for all catalog SKUs, and the prior POS filter accepted every matching variantId even when all sizes of a design had zero event inventory. Field screenshot showed the design-only filter was too broad: Bigwave Organic Black and Organic Natural appeared with zero event inventory merely because Bigwave Vintage Navy was carried. For an active Session with an opening, POS now evaluates each Design / Body / Color combination separately. A combination appears when at least one matching size had positive opening, positive Restock or opening correction, or an exact SKU sale. Other zero-quantity sizes within that same combination remain visible when they were already POS candidates. Without an event opening, the existing catalog visibility remains unchanged. The selection is presentation-only and does not change stock or sales. A design with only automatic zero placeholders is not distinguishable from an intentionally registered zero-only design in the current Session schema; this implementation hides such a design until a positive event adjustment is recorded. PR 50 was merged as 90aaa0996290cbf0adea7740763e40aebf1c7d34. Focused tests cover the display filter. No production Session data was mutated.


## Event T-shirt color correction 2026-09-26

PR 50 grouped only by Design and was insufficient for the real event screenshot. PR 51 merged as be56e8f5e43ac5dfd28d63e879f39c0e91df3f59 and narrows SKU POS visibility to the Design / Body / Color combination while retaining size zero cells within a carried combination. Example: Bigwave Vintage Navy is visible while Bigwave Organic Black and Organic Natural are hidden when those combinations have only automatic zero opening rows. This changes display only and preserves Quick sales and real stock.


## POS module cache compatibility incident 2026-09-26

After PR 51, an iPhone showed a full-app startup error: the previously cached app.js imported filterTshirtRowsForEventDesigns, while the newly deployed eventTshirtDesigns.mjs only exported filterTshirtRowsForEventGroups. The fix exports both names as the same Design / Body / Color filter and versions both the app.js entry URL and its helper import. The service worker shell cache version is advanced and preloads the helper. Regression tests import both names and check they point to the same implementation. No sales or stock data was altered. Verify production startup on iPhone after Pages deployment, then recheck SKU POS visibility.


## SKU POS selection tabs 2026-09-26

The SKU POS category dropdown is replaced with large T-shirt and Accessory buttons for event use on iPhone. The Accessory view defaults to all four tracked accessory categories and has optional All / Pierce / Earring buttons. Drop pierces appear with pierces, and drop earrings with earrings; the individual SKU category label remains visible under each product. The UI grouping never changes productVariants.category, variantId, prices, cart line identity, checkout stock deduction, or event inventory authority. Switching views clears the SKU search and accessory subtype returns to All. Version the index app.js entry and service worker shell together to avoid mixing cached module generations, following the PR 52 incident. Verify both modes and each accessory button in an authenticated event Session on the physical iPhone after deployment.


## Accessory SKU card layout 2026-09-26

Each Accessory SKU filter displays product cards in two columns on iPhone. Stud cards use a pale blue background and blue left border; Drop cards use a pale orange background and orange left border. Each card explicitly labels Stud or Drop and Pierce or Earring so the distinction does not depend on color. The card still shows its own sale price, stock, and cart quantity; the existing variantId, price and checkout path are unchanged. Zero stock cards remain visible and disabled. Index module URL and service worker shell cache were versioned together. PR 53 introduced the category buttons and was merged as d917cda43158ca7607fb9c7bad19af92f467be75; Pages deployment succeeded and the unauthenticated login screen started without an app module error. Verify this two column accessory layout and selection on the physical iPhone during an authenticated event Session.
---

# 17. System role boundaries for Website, Inventory Apps and Sales Manager

Recorded: 2026-10-05

This section is a product boundary. Future work must preserve these roles unless the user explicitly approves a role change.

## 17.1 Sales Manager role

Sales Manager is the operational app for event sales and event business management.

Primary responsibilities:

* POS and checkout for events and direct sales
* Sales Sessions and event opening, checkpoint, daily close and final close
* Event sales history, revenue, expenses, profit review and analytics
* Quick, SKU and amount only sales handling
* Payment evidence and payment integration such as Stripe
* Event price books, event currency handling and event discount logic
* Applying approved sale, void and reconciliation effects to the canonical inventory sources

Sales Manager is not the primary inventory management UI and must not become the canonical stock store for T shirts or accessories.

Authority rules:

* `salesTransactions` is the source of truth for sales recorded by Sales Manager.
* T shirt canonical finished stock remains `tshirtStock/master.inventory_v2`.
* Accessory canonical real stock remains `accessoryStock/shared.designs`.
* Event inventory is a temporary operational view of stock physically brought to an event. It is not company wide canonical stock.
* Sales Manager may mutate canonical inventory only through defined sale, void, later allocation and approved reconciliation paths. It must not create a parallel permanent stock count.

## 17.2 T shirts Stock role

`ICELOLLYjp/T-shirts-Stock` is the primary T shirt inventory and production operations app.

It owns the operational management of:

* Finished T shirt inventory
* Body, Design, Color and Size inventory dimensions
* Blank Body inventory
* Print sheet inventory
* Production tasks
* Customer order production context
* Current T shirt inventory adjustments and production related inventory state

Sales Manager may read this data and may apply sale related stock movements, but it does not replace T shirts Stock as the normal place to review and maintain T shirt inventory.

## 17.3 Accessories role

`ICELOLLYjp/Accessories` is the primary accessory inventory management app.

It owns the operational management of accessory designs and current quantities stored under `accessoryStock/shared.designs`.

Sales Manager may read this catalog and apply defined sale related stock movements, but it does not replace Accessories as the normal place to review and maintain accessory inventory.

## 17.4 Website and WooCommerce role

The ICELOLLY website is the customer facing brand site, portfolio and ecommerce storefront.

Its responsibilities are:

* Present products as both purchasable items and the public portfolio of ICELOLLY work
* Product photography, customer facing descriptions, translations and merchandising
* Browsing by product type, illustration, material and making method
* Online cart, checkout, shipping information, customer communication and online order records
* Event follow up landing pages and online purchase paths after physical events
* Brand story, About, Events and Contact
* International ecommerce presentation and localization

The website must not become a second canonical physical inventory system.

Online inventory displayed by WooCommerce should ultimately be derived from the canonical inventory apps through a controlled integration. Until that integration is implemented and tested, do not silently treat an independently entered WooCommerce stock number as authoritative.

WooCommerce is the source of truth for customer facing online order state and web checkout state. If completed ecommerce orders are later imported into Sales Manager for consolidated analytics, they must be linked without creating a duplicate sale.

## 17.5 Price authority

Price ownership depends on sales channel.

* Sales Manager owns event and POS price books, event currency prices and event discount rules.
* WooCommerce owns the price actually presented and charged by the online store.
* A future synchronization layer may share base prices, but synchronization must be explicit. Do not assume an event price and an online price are always identical.
* Cost data and sale time cost snapshots must not be confused with retail selling prices.

## 17.6 Integration rules

1. One business fact should have one authority.
2. Do not create a second permanent stock counter in Sales Manager or WooCommerce.
3. Preserve existing stable IDs for Body, Design, Color, Size, accessory design and SKU wherever possible.
4. Cross app synchronization should use explicit adapters or APIs rather than copied data with unclear ownership.
5. Stock changes must be idempotent and auditable.
6. Unknown and zero remain different states.
7. Never infer an exact SKU from an unresolved sale merely to make systems agree.
8. Customer facing copy, images and translations belong to the website, not the inventory apps.
9. Before changing a cross app contract, read the current handoff files for every affected app.
10. The website is a sales channel and presentation layer. The inventory apps remain inventory authorities. Sales Manager remains the event sales and business operations layer.


## 共通カラー参照の検証記録 2026年10月8日

実登録の報告：13色、Japan Black新規追加、共通メタデータ版1、数量変更なし。Tシャツ在庫管理はDraft PR #26、機能ソース1e6736956f45fcf249504cced916b9bb063d741a、CI 37735164575が成功。Sales ManagerはDraft PR #115、機能ソースf3a009bb53b27d023f354084db024b7983337699、CI 37735166632が成功。WebsiteはDraft PR #3、機能ソース2855520ac900540485b3d05ae58766e346f2db77、CI 37735164243の全工程が成功。

同一参照モジュールのSHA256はb171aeaddb6375840b6612878a5ff50a785572766b54b71fbc08e66d5001b015。既存APIの認証・数量0と未知・SKU照合・参考価格・CMSブラウザー回帰も成功。TシャツとSales Managerの実ブラウザー表示は未確認。各mainと公開アプリは変更していない。WordPress ZIPは0.46.0、staging読取APIは0.37.1で今回の新しい参照コードはまだ未デプロイ。次は各アプリの公開方針に沿った反映と実機確認、WordPressメーカー画面への共通対応参照を接続する。既存WooCommerce属性を無断で改名しない。
