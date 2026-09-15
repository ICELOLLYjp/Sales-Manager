# ICELOLLY Sales Manager — PROJECT HANDOFF

Last reconciled: 2026-09-16
Repository: `ICELOLLYjp/Sales-Manager`
Reference `main` at reconciliation: `7f2d2d8fb7ee19f50e8eb87af21532c690fc5098`

This file is the canonical handoff for future development chats. It separates **decided specifications** from **current implementation state** and from the **remaining backlog**. Do not infer that a decided specification is already implemented unless it is explicitly marked as implemented below.

---

# Part 1 — Decided specifications, constraints, and data model

## 1. Development and operating principles

- Sales Manager is the central web app for event sales, sales records, inventory, cost, payments, expenses, reconciliation, and final profit.
- iPhone is the primary production device. UI/UX decisions should prioritize fast one-handed event operation. Desktop remains supported.
- Existing T-shirt inventory, accessory inventory, and Pinkoi product management must remain connected. Do not create a second independent real-stock authority inside Sales Manager.
- Do not intentionally change existing products, SKUs, prices, inventory, or Firestore structures when implementing unrelated features.
- `ICELOLLYjp/Sales-Manager` / `main` is the source of truth for application code.
- Always inspect the latest `main` before editing. Do not base changes on an old local file.

## 2. Sales Session model

The management unit is a **Sales Session**.

Planned session types include:

- Event
- Consignment
- Wholesale / Buyout

Event Sessions associate at least:

- country / city / event name / dates
- currency / FX rate
- booth fee / flight / hotel / shipping / transport / interpreter / other expenses
- sales / gross profit / final profit

Supported currencies include:

`JPY / TWD / HKD / SGD / THB / USD`

Selecting a Session in POS determines the POS currency.

An Event Session close is not merely a screen state; it is tied to inventory verification and reconciliation.

## 3. Real-stock authorities

### T-shirt

Canonical real stock:

` t shirt stock authority = tshirtStock/master.inventory_v2 `

`tshirtStock/shared` is **not** the canonical authority.

T-shirt hierarchy:

`Body → Design → Color → Size`

Default size order:

`S / M / L / XL / XXL`

Different selling names may be shown in Sales Manager or Pinkoi, but inventory operations must use canonical IDs / inventory keys.

### Accessories

Canonical real stock:

`accessoryStock/shared`

Sales Manager accesses existing accessory stock through adapters.

## 4. Product / SKU structure

Primary product catalog:

`products`

SKU / Variant catalog:

`productVariants`

T-shirt Variant ID convention:

`tshirt__{bodyId}__{designId}__{colorId}__{sizeId}`

T-shirt inventory key:

`tshirt:body|design|color|size`

Accessory inventory key:

`accessory:sourceId|stockField`

Display names and internal inventory keys must stay separate.

## 5. Pinkoi relationship

Pinkoi-side collections include:

- `pinkoi_bodies`
- `pinkoi_designs`
- `pinkoi_colors`
- `pinkoi_inventory`
- `pinkoi_products`

Pinkoi inventory values are not the canonical real-stock authority. Real T-shirt stock is always `tshirtStock/master.inventory_v2`.

Pinkoi design names may differ from inventory design names. Explicit links are preferred over fuzzy name matching.

Known mappings:

- Gulls and Lemons → `design_gulls_and_lemons` → `design_1opuhzd` → Gull
- Space Odyssey RAY → `design_space_odyssey_ray` → `design_a66xhg` → Rays
- Squids Night → `design_squids_night` → `design_yvdify` → Squids

## 6. POS categories

Internal categories:

- `tshirt`
- `pierce`
- `earring`
- `drop_pierce`
- `drop_earring`
- `sticker`
- `postcard`
- `art_print`

Japanese labels:

- tshirt → Tシャツ
- pierce → ピアス
- earring → イヤリング
- drop_pierce → ドロップタイプピアス
- drop_earring → ドロップタイプイヤリング
- sticker → ステッカー
- postcard → ポストカード
- art_print → アートプリント

## 7. Quick sale vs SKU sale

POS supports both **Quick** and **SKU** sale lines, including mixing them in one cart.

### SKU sale

- Records an exact Variant.
- Stores Variant ID / inventory key / inventory source.
- Updates the canonical real stock at checkout.

### Quick sale

- Can be sold without identifying a SKU.
- The system must **never arbitrarily choose a SKU** and mutate its stock.
- Unresolved tracked Quick sales remain pending allocation / unidentified until later reconciliation.
- A Session must be able to stop POS or finish with unresolved Quick sales instead of forcing a false allocation.

## 8. Transactions and idempotency

Sales records:

`salesTransactions`

Inventory movements:

`inventoryMovements`

Idempotency locks:

`transactionLocks`

The same Transaction ID must not be counted twice. A duplicate ID with conflicting content is a conflict.

Voids do not delete the original transaction; use `status: voided`. Exact SKU inventory must be restored when an SKU sale is voided.

## 9. Inventory movement reasons

Reasons include:

- `sale`
- `return`
- `loss`
- `theft`
- `damage`
- `gift`
- `sample`
- `stock_adjustment`

Sales and manual inventory changes remain distinct historical causes.

## 10. Event inventory principle

Event inventory means **inventory physically brought to the event**, not the company-wide real stock.

Therefore:

- Bringing stock to an event does **not** decrement company stock.
- Exact SKU sale **does** decrement company stock at checkout.
- Closing an event must **not** decrement exact SKU sales again.
- An event physical count must never overwrite company-wide canonical inventory as if they were the same concept.

## 11. Restock / Opening correction

Event-internal inventory logic includes:

- Restock for stock added during the event.
- Opening correction for correcting an erroneous opening quantity.

These are event-flow records. Merely recording them must not double-change company real stock.

Base theoretical event stock:

`Opening + Restock + Opening correction − exact SKU sales`

## 12. Checkpoints

Event inventory should support physical checkpoints such as:

- intermediate count
- daily close
- final count

Checkpoint state should include the sale state and Restock / correction state at capture.

If a SKU has had no sale, Restock, or correction since the prior checkpoint, it can be reused instead of recounted.

UI distinction:

- `✓ 再カウント不要`
- `要再確認`

The goal is to recount only changed SKUs at final close.

## 13. Event finalization

Final close sets Session status to `closed` and records close time / user.

Never:

- subtract exact SKU sales twice,
- apply Restock / Opening correction as extra company-stock mutations at close,
- force unknown Quick sales into arbitrary SKUs.

The Public Garden test Session from 2026-09 remains a test record and should not be forcibly closed just to validate the new flow. Validate the improved flow end-to-end at a future event.

## 14. Event inventory UI direction

T-shirt event inventory uses a paper-stock-sheet-style matrix.

Vertical:

`Design / Body / Color`

Horizontal:

`S / M / L / XL / XXL`

A valid size cell should remain operable even when the opening quantity is zero.

Each cell may expose theoretical quantity, opening quantity, sales, Restock, correction, and physical quantity.

On iPhone, quantity entry should prioritize a large:

`− / quantity / +`

control.

## 15. Unresolved SKU policy

Differences and Quick sales may leave products unidentified.

- Show unresolved sales as a manageable list/group, not as dozens of error messages.
- Use price, category, body, physical count, and other evidence to narrow candidates.
- Candidate suggestions are suggestions only.
- Never auto-confirm an uncertain SKU.
- The system must support stock/products that were not part of the initial event setup.

## 16. Negative stock policy

Event operation must not stop checkout merely because system inventory reached zero.

When opening stock was missing or stock was added mid-event, SKU sales may legitimately push event or company stock negative until reconciliation.

Record a warning / needs-review state, then fix later.

## 17. Discounts and set pricing

Physical inventory movement always follows the physical quantity sold, while revenue follows the actual discounted/set price.

Distinguish:

- set discount / set price
- line discount
- order-wide discount

Current base application order:

`normal price → set discount → line discount → order discount`

Future promotion configuration should support category/product targeting, mixed counts, N-or-more, fixed set price, total discount, per-item discount, percent discount, and tiered offers.

## 18. Current Singapore price rules retained as business reference

- Sticker SGD 5; 3 = 13; 5 = 20
- Postcard SGD 5; 3 = 13; 5 = 20
- Earrings SGD 22; 2 items = SGD 4 off → 40
- Drop Earrings SGD 26; 2 items = SGD 4 off → 48
- A3 Art Print SGD 25; 2 = 45
- Pigment T-shirt SGD 52
- Organic Cotton T-shirt SGD 55
- Made in Japan T-shirt SGD 85
- Any two T-shirt Bodies: SGD 8 off

Mixed-group direction includes:

- T-shirt Bodies
- Sticker + Postcard
- Pierce + Earring
- Drop Pierce + Drop Earring

## 19. Cost data

Costs use effective-date history.

T-shirt cost priority:

`SKU override → outsourced all-in → Body cost → Missing`

Use historical cost snapshot at the time of sale. Later edits to cost masters must not rewrite past sales cost.

## 20. Stripe principle

`salesTransactions` remains the sales source of truth.

Stripe is payment evidence, not a second sales ledger.

Stripe payment metadata should link back to the existing Sales Manager transaction.

A paid Stripe Checkout whose Sales Manager commit failed must be recoverable.

Refund order:

`Stripe refund → Sales Manager void → inventory restore`

Stripe secrets must never be stored client-side.

## 21. Wise / PayNow / external payments

External payments are evidence for reconciliation, not automatic generators of new Sales Manager sales.

Reconciliation must eventually support many-to-many:

- 1 POS sale ↔ multiple external payments
- multiple POS sales ↔ 1 external payment
- multiple ↔ multiple

Candidate fields include:

- `reconciliationGroupId`
- `salesTransactionIds`
- `externalPaymentIds`
- `matchedAmount`
- `status`

## 22. Gmail expenses

Gmail integration should find event-related expenses such as flight, hotel, booth fee, ads, shipping, transport, etc.

Email extraction must create **candidates**, not auto-confirm expenses. A person confirms before Session registration.

Long-term event close should show:

`POS sales → actual receipts → unmatched/missing sale detection → expenses → final profit`

## 23. Offline principle

Event POS must continue when connectivity is unstable.

Offline sales use a local queue and reuse the same Transaction ID after reconnection.

Quick sales are queueable. Exact SKU sales should also be operable from local event state.

Do not formally close a Session while unsynced checkout data remains.

## 24. Major Firestore collections

Important collections include:

- `tshirtStock`
- `accessoryStock`
- `pinkoi_bodies`
- `pinkoi_designs`
- `pinkoi_colors`
- `pinkoi_inventory`
- `pinkoi_products`
- `products`
- `productVariants`
- `salesSessions`
- `salesTransactions`
- `inventoryMovements`
- `transactionLocks`
- `stripePayments`

`stripePayments` is intended to be handled through Firebase Functions / Admin SDK rather than direct client writes.

## 25. Security constraint

The intended product specification is that Sales Manager Firestore access is limited to authenticated, allowed staff users.

**Important mismatch to verify:** repository `firestore.rules` currently allows any signed-in user to read/write all documents. Confirm the actually deployed Rules before changing security code.

## 26. Technical safeguards

- Always edit from latest `main`.
- Preserve existing Firestore data and SKU identities.
- Never replace the T-shirt real-stock authority with another collection.
- Never arbitrarily decrement an SKU for unresolved Quick sales.
- Never double-decrement exact SKU sales during event close.
- Never create duplicate Sales Manager sales from external payment imports.
- JavaScript changes should be syntax-checked before delivery/deployment when local execution is available.
- Do not consider a desktop-only interaction design complete; iPhone usability is required.

---

# Part 2 — Current implementation status

Legend:

- **Implemented**: code exists on current `main` and is wired into the application.
- **Partial**: core code exists, but integration / UX / field validation remains.
- **Not implemented**: decided/planned, but no completed current flow exists.
- **Needs field test**: code exists, but production event behavior remains to be proven.

## Implemented

### POS / transactions

- Quick and exact SKU sale lines can coexist in one cart.
- Exact SKU transactions record Variant/inventory identifiers.
- Exact SKU sales mutate canonical T-shirt/accessory stock at checkout.
- Transaction IDs and transaction locks provide idempotency.
- Voids retain history and restore exact SKU stock.
- Negative event/global stock does not block a sale; warning data is recorded.
- Offline sales queue and POS offline snapshot are implemented.
- POS has a direct shortcut to the active Session's transaction history.
- Transaction history supports search/filtering by item/design/size/ID, amount, Stripe/non-Stripe, and active/voided status.
- iPhone cart layout fixes are installed.

### Event inventory flow

- `inventoryCount.flowEntries` supports `restock` and `opening_correction`.
- `inventoryCount.checkpoints` supports `checkpoint`, `daily_close`, and `final_count` types.
- Checkpoints capture `soldByVariantSnapshot` and `flowEntryCountAtCapture`.
- Unchanged SKUs can reuse prior physical counts and display `✓ 再カウント不要`.
- Changed SKUs display `要再確認`.
- T-shirt inventory board uses Design/Body/Color rows and S/M/L/XL/XXL columns.
- Zero-opening T-shirt size cells can be created from master options and operated.
- Large iPhone steppers are present for count inputs.

### External count pages

- `ICELOLLYjp/T-shirts-Stock/event-count.html` exists.
- `ICELOLLYjp/Accessories/event-count.html` exists.
- Both support `open` and `pending_allocation` Sessions.
- Both support `?session=<sessionId>` selection.
- Both support draft count and confirmed event closing count.
- Registered zero-stock SKUs remain countable.

### Quick / close workflow

- Individual Quick unit allocation to SKU exists.
- Automatic Quick inference exists for exact category-count matches where the physical difference uniquely supports an allocation.
- Unknown Quick sales are grouped by category + unit price (+ T-shirt body when available).
- Unknown sales are presented as `未特定販売`, not as a hard error.
- `pending_allocation` provisional state exists.
- POS can be stopped without counting via `棚卸はあとで`.
- Unsynced offline sales block no-count provisional close.
- A Session can formally close while leaving unresolved Quick sales unidentified.
- Exact SKU sales are not re-decremented in the new close service.
- Event close actions are consolidated in `eventCloseHubUi.js`.
- Stage text is clarified by `eventCloseStageUi.js`.
- Sessions list state badges/order are handled by `sessionStatusUi.js`.

### Cost

- Effective-date category / T-shirt Body / SKU cost history exists.
- T-shirt cost resolution includes `sku_override`, `outsourced_all_in`, then Body fallback.
- Sale-time cost snapshots exist so historical sales do not automatically change when current costs are edited.

### Stripe

- Client Stripe service exists.
- Firebase Functions Stripe backend exists.
- Checkout creation, status lookup, expiry, committed-state marking, refund, and recoverable-payment listing exist in code.
- Stripe secrets are server-side Functions secrets.
- `stripePayments` is separate payment evidence linked to Sales Manager transaction IDs.

## Partial / integration debt

### Two event-close models still coexist

The project currently contains both:

1. `flowEntries / checkpoints / final_count` inventory-flow model, and
2. `closing / quickAllocations / pending_allocation / unidentifiedQuick` newer close model.

The old `inventoryFlowFinalizeService.js` requires an `open` Session, a complete `final_count`, zero mismatch, and zero unallocated tracked Quick sale. The newer close path can use `pending_allocation` and can preserve unidentified Quick sales.

These must be unified rather than extended independently.

### Restock / Opening correction integration

Restock and Opening correction are implemented in `flowEntries`, but the newer unidentified-Quick close flow does not yet treat all flow history as one canonical event-stock equation across every path.

### Daily close

`daily_close` exists as a checkpoint type, but the operational UX for:

`Day 1 close → next-day opening → Day 2 sales → final close`

is not finished.

### T-shirt category aggregation

The `SALTY`/design-name category display problem is patched in UI by `posUxEnhancements.js`, but the underlying analytics path should be normalized to aggregate by category ID, with Design / Body / Color as separate dimensions.

### FX / profit

Manual Session FX exists. Automated rates, historical rate sources, actual payment-provider rates, and full profit reconciliation do not.

### Stripe field validation

Stripe code is present, but deployment configuration, Functions secrets, webhook state, and event-day end-to-end field behavior must be validated separately from repository code existence.

## Not implemented

- Full Consignment workflow comparable to Event workflow.
- Full Wholesale / Buyout workflow comparable to Event workflow.
- Event-only unregistered product entry and later linking to formal SKU.
- Post-close linking of unidentified Quick sales to discovered SKUs with idempotent inventory correction.
- Generic promotion builder covering all planned offer types.
- Wise / PayNow many-to-many reconciliation.
- Gmail two-account expense candidate extraction including PDF receipts.
- Full analytics dashboard.
- Lost-sales / opportunity-loss capture.
- Automatic/current/historical/actual-provider FX stack.
- Structured Session notes / event review.
- Short Sales Manager URL redirect for Stripe QR.
- Help / Quick Start.

## Known specification mismatch

Repository `firestore.rules` currently defines `allowedUser()` as `signedIn()` and then permits all document reads/writes to authenticated users. This does **not** match the intended allowed-staff-only policy described in project discussions. Confirm actual deployed Rules before changing this.

---

# Part 3 — Remaining development backlog and priority

This section removes items that are already substantially implemented. It retains only genuinely unfinished work or integration work.

## P0 — Stabilize the event inventory model before adding more features

### P0-1. Unify the two event-close models

Create one canonical event inventory equation and close pipeline that understands:

- Opening
- Restock
- Opening correction
- exact SKU sales
- Quick allocations
- physical checkpoints
- closing physical count
- discrepancy reasons
- unidentified Quick
- provisional POS stop
- formal close

The close pipeline must preserve these invariants:

- exact SKU sales were already deducted at checkout,
- Restock / Opening correction are event-flow history and are not extra company-stock mutations,
- unidentified Quick is not forced into an SKU,
- no inventory movement is applied twice.

### P0-2. Make Restock / Opening correction canonical across all close paths

Current `flowEntries` implementation must be consumed by the newer pending/unidentified close pipeline.

Desired event-stock equation:

`Opening + Restock + Opening correction − exact SKU sales − identified Quick ± recorded discrepancy adjustments = physical closing`

### P0-3. Introduce event-only unregistered product rows

Add `未登録商品を追加` to T-shirt/accessory event count where needed.

Do not invent a canonical SKU immediately. Keep the event-only row separate until later linking.

Suggested fields include:

- event temp ID
- source app
- category
- label / detail
- body/color/size when known
- opening quantity / opening-known flag
- closing quantity
- `unregistered` / `linked` status
- linked Variant ID

### P0-4. Support post-close resolution of unidentified Quick

When an unidentified sale is later discovered:

- link it to a Variant,
- decrement canonical stock exactly once if it had never been applied,
- create an idempotent inventory movement,
- update unidentified counts/groups,
- update sold-by-Variant analytics,
- preserve the original closed Session history.

### P0-5. Validate Firestore security state

Confirm the actually deployed Firestore Rules and align them with the intended staff allowlist model. Do not assume repository Rules equal production Rules.

## P1 — Complete practical multi-day event operation

### P1-1. Daily close / next-day path

Finish an explicit flow for multi-day events:

`sales → intermediate count → daily close → next-day opening → sales → ... → final count → final close`

Daily close must not perform company-stock double mutations.

### P1-2. Daily inventory history

Show day-by-day inventory evolution, including:

- opening
- exact sales
- Quick allocation state
- Restock
- Opening correction
- checkpoint physical count
- closing / carry-forward

### P1-3. Final recount reduction UX

The underlying reuse logic exists. Improve the event-day UX so only changed SKUs are presented as actionable final-count work.

### P1-4. Physical count exceeds expected quantity

Make excess physical inventory explicitly explainable by:

- missing Restock
- opening correction
- count correction
- unregistered/mid-event product
- other recorded reason

Do not hide excess stock by silently rewriting opening stock.

### P1-5. Event inventory board polish

Retain paper-stock-sheet mental model and improve:

- normal stock vs Restock visual distinction
- priority-item highlighting
- stronger SOLD OUT emphasis
- quick +1/+2 / large touch controls where useful
- clear current theoretical vs physical quantity

Event UI standard:

> One screen should make it clear what exists, what sold, what was added, and what sold out.

## P2 — POS speed and operational cleanup

### P2-1. Fastest POS / amount-only register

Create a minimal flow where the operator enters only an amount and immediately records an unclassified sale.

### P2-2. Amount-only Stripe QR

From the amount-only register, generate Stripe Checkout / QR without first classifying a product.

The sale must remain clearly marked as unclassified for later allocation.

### P2-3. Later allocation of unclassified sales

Allow amount-only/unclassified sales to be linked later to category/SKU without duplicating revenue or inventory changes.

### P2-4. POS redraw/performance

Reduce unnecessary post-checkout full rerenders and Firestore reads, especially on iPhone.

### P2-5. Finish POS overall layout cleanup

Keep transaction history access near POS and reduce navigation steps during events.

## P3 — Sales aggregation and analytics foundation

### P3-1. Normalize aggregation dimensions

Use `category = tshirt` for category reporting.

Treat these as separate dimensions:

- Design
- Body
- Color
- Size

Do not use Design labels as substitute category names.

### P3-2. Analytics dashboard

Add at least:

- popular Size
- popular Design
- popular Color
- product sell-through rate
- SOLD OUT analysis
- Restock effect
- event comparison
- country comparison
- city comparison

### P3-3. Opportunity-loss analysis

Add an explicit signal for customer demand that could not be fulfilled. Negative inventory alone is not enough to infer lost sales.

## P4 — Pricing / promotions rebuild

Build a promotion model that can represent:

- multiple selected products/categories
- mixed counting
- N or more
- fixed set total
- total discount
- per-item discount
- percentage discount
- tiered pricing

UI wording must make `SGD 4 off` impossible to confuse with `set price SGD 4`.

Preserve existing working prices while migrating.

## P5 — Payment reconciliation

### P5-1. Generic reconciliation layer

Keep `salesTransactions` as the sales source of truth.

Model Stripe / Wise / future PayNow as external payments.

Implement many-to-many reconciliation groups.

### P5-2. Missing-sale / unmatched-payment detection

Surface:

- payment with no matching POS sale
- POS sale with no matching payment when one is expected
- partially matched payment groups

### P5-3. Wise / PayNow integration

Implement only after the generic reconciliation model is stable.

## P6 — Expenses and final event profit

### P6-1. Gmail expense candidates

Use two Gmail accounts where authorized.

Extract candidate expenses including:

- booth fee
- flight
- hotel
- shipping
- transport
- advertising
- other

Include PDF receipts/attachments where possible.

A person must confirm before creating the final expense record.

### P6-2. FX model

Support distinct rate concepts:

- sale-date FX rate
- payment-date FX rate
- current rate
- actual Stripe/Wise applied rate
- fixed historical JPY conversion used for already-recorded accounting

Historical converted values must not silently change when current FX changes.

### P6-3. Final reconciliation

Event financial close should combine:

`sales → external receipts → reconciliation gaps → expenses → final profit`

### P6-4. Session notes / event review

Store qualitative notes / lessons for later event comparison.

## P7 — Help and product UX

### P7-1. Help / Quick Start

Add in-app documentation for event operation, especially:

- starting a Session
- POS
- Restock
- checkpoint
- provisional POS stop
- final count
- unidentified sales
- final close

### P7-2. Final navigation direction

Long-term information architecture:

`販売 → 在庫 → 日次締め → 収支 → 分析`

---

# Appendix A — Historical “future update” memo

The following items were previously recorded as not-yet-implemented. Some are now implemented; retain this list as historical planning context rather than current status.

## Event inventory management

- intermediate Restock
- Opening correction ±
- daily close
- daily-close path
- daily inventory trend
- automatic SKU allocation of Quick sales
- physical count greater than inventory-app quantity with reason management

## Fast POS

- amount-only register
- amount-only Stripe QR generation
- later SKU allocation of unclassified sales

## Analytics

- popular Size
- popular Design
- popular Color
- product sell-through rate
- SOLD OUT analysis
- Restock effect
- opportunity loss
- country / city / Event comparison

## UI

- paper-inventory-sheet-based event inventory board
- black = normal stock
- red = Restock
- T-shirt category identification
- priority product highlight
- SOLD OUT emphasis
- larger operation buttons
- overall POS cleanup

## Finance

- automatic payment-date FX rate
- sale-date FX rate
- current FX rate
- actual Stripe / Wise applied rate
- fixed historical converted amounts

## Other

- Session notes / impressions
- Wise / PayNow integration

---

# Appendix B — Current key files

Core app:

- `index.html`
- `js/app.js`

POS / transaction:

- `js/services/transactionService.js`
- `js/services/offlineQueueService.js`
- `js/transactionHistorySearch.js`
- `js/posUxEnhancements.js`

Event inventory:

- `js/inventoryFlowPanel.js`
- `js/services/inventoryFlowService.js`
- `js/services/inventoryFlowFinalizeService.js`
- `js/services/inventoryCountService.js`
- `js/services/eventCloseService.js`
- `js/services/eventCloseServiceCompat.js`
- `js/services/unidentifiedQuickService.js`
- `js/services/closeWithUnidentifiedService.js`
- `js/services/provisionalWithoutCountService.js`
- `js/quickAllocationUi.js`
- `js/eventCloseHubUi.js`
- `js/eventCloseStageUi.js`
- `js/sessionStatusUi.js`

Cost / pricing:

- `js/services/costHistoryService.js`
- `js/services/priceBookService.js`

Stripe:

- `js/services/stripePaymentService.js`
- `functions/index.js`
- `stripe-result.html`

External event-count apps:

- `ICELOLLYjp/T-shirts-Stock/event-count.html`
- `ICELOLLYjp/Accessories/event-count.html`

Security/config:

- `firestore.rules`
- `firebase.json`

---

# Next implementation focus

Before adding another independent event feature, work in this order:

1. unify event inventory / close models,
2. integrate Restock + Opening correction into the new close path,
3. add unregistered event item handling,
4. add post-close unidentified-SKU resolution,
5. finish daily-close / next-day operation,
6. then move to fastest POS and analytics.

When a feature is completed, update this file in the same change set so future chats do not depend on reconstructing old conversation history.
