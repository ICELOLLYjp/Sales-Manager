# ICELOLLY Sales Manager — PROJECT HANDOFF

Last reconciled: 2026-09-16
Repository: `ICELOLLYjp/Sales-Manager`
Reference `main` at reconciliation: `5de9d2ec653c78597254500f68591340f847e2d7`

This is the canonical handoff for future development chats. Inspect latest `main` before editing; this file describes the intended invariants, what is already implemented, and what still needs work.

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

Wise / PayNow many-to-many reconciliation, Gmail expense candidates, and full final-profit reconciliation remain future work.

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
- Gmail expense candidate extraction including attachments/PDFs
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

Do not add another large inventory-close model before the next real-event field test. Amount-only later allocation and normalized T-shirt sales aggregation are implemented. The next focus should normally be field-testing these flows, especially duplicate taps, negative stock, void-after-classification, and mixed exact/Quick T-shirt reporting, unless a higher-priority defect is found.
