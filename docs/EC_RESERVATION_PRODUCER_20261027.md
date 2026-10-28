> 2026-10-28 follow-up: isolated Woo/HPOS temporary-hold adapter now tested; see [current slice and evidence](EC_WOO_PRODUCER_20261028.md). Production integration remains incomplete.

> 2026-10-28: Event release now requires native Session/sales snapshot reconciliation in the same transaction, including zero remainder. See [current implementation and event restrictions](EC_EVENT_RELEASE_20261028.md). Final affected tests: producer 20 + release gate 12 PASS; no deployment or purchase enablement.

# EC/event reservation producer and first UI connection — 2026-10-27

Implemented, emulator-tested, **not deployed / migration not complete**. Extends Draft #127 at `27d886883e12dae1c455d192e92777eb822319b9`; keeps existing canonical stock and the manual API. No real order, stock, payment, Rules/IAM or Staging writes.

`isolated/method-b/reservations.mjs` exports `produceReservation({db,auth}, token, input)`. It verifies a revoked-token-aware Auth token against separate EC/event server identities and producer claims. Operator browser tokens cannot produce holds. Runtime still requires the fixed demo/emulator addresses. These synthetic identities are not production identity configuration; no public HTTP producer or Functions deployment entrypoint is added.

Input: existing version/operationId/stock/SKU/expectedRevision/expectedQuantity/quantity plus kind, action, and `{namespace,documentId,lineId}` source. EC uses stable site/order/line identity; event uses stable source/Session/SKU-line identity. The server hashes this plus canonical SKU for commitment identity, and stores an immutable source-to-SKU binding to reject accidental rebinding. Confirm replaces held state in place. Release retains the row and advances revision, including explicit zero remaining after all sales. No TTL/Session-close guessed release. A new operation ID cannot create the same hold or release twice.

Event `sale` atomically decrements physical stock and the confirmed event remainder; `return` requires `returnOf` identifying an original server sale receipt, exact source/SKU and full sold quantity. A separate atomic return marker prevents replay under another ID. Partial returns, returns after final release, existing POS/void/close semantics and legacy receipts require further integration; this is not a replacement for the existing POS path.

Every fresh operation checks expected quantity/revision, all EC+event holds, server checkpoint, and writes stock+ledger+revision+authority hash+receipt together. Historical replay validates normalized intent, server actor, historical authority/ledger, transition and exact result. It returns the original result without another write. Unknown/missing stock, incomplete evidence, malformed receipt and insufficient stock fail closed.

## Completeness and migration boundary

`inventoryReservationAuthorities/{stock}` is a server-only **reconciliation checkpoint**, not another physical-stock authority. It contains schema `reservation-authority-v1`, canonical path, ledgerHash, ecComplete/eventComplete, reconciliationId and Timestamp reconciledAt. A future privileged migration must freeze old writers and reconcile both authoritative sources before creating it. No normal API can create a checkpoint or accept a caller's complete flag; missing checkpoint always rejects producer calls. Tests seed synthetic checkpoints explicitly; real migration/reconciliation is **not implemented or run**.

Producer-managed stock is marked `inventoryReservationAuthority:1`. The manual API requires a matching checkpoint for marked documents or when a checkpoint exists. Unmarked legacy v1 fixtures remain compatible with #127. Therefore neither this compatibility mode nor one UI handler proves old browser writes are closed. New clients also cannot repair a ledger by asserting complete.

Manual API adds POST `/v1/inventory/manual-edit/result`, using the exact persisted operation payload and the same verified operator auth. It returns validated historical receipt or `status:unknown`; unknown lookup never writes. Unknown is not authorization to allocate a new operation ID.

## Actual validation and artifacts

- Manual HTTP/Auth/Firestore: **38 PASS / 0 FAIL / 0 SKIP** (existing affected 37 plus read-only receipt lookup). See `evidence/reservation-manual-and-initial-producer.tap`; the 18 intermediate producer results in that file are superseded, not double-counted.
- Final producer: **20 PASS / 0 FAIL / 0 SKIP**, `evidence/reservation-producer-final.tap`: same/different SKU concurrency, reserve/count/sale race, combined floor, zero/unknown/missing, same-identity confirm, duplicate hold/release/return, stale revision, forged receipts, service/browser auth separation, disabled auth, direct old writes denied, lost reply/restart, rollback, source rebinding and sold-out release.
- T-shirts-Stock client+A1 regression: **23 PASS / 0 FAIL / 0 SKIP**; real new client → HTTP/Auth/Firestore: **3 PASS / 0 FAIL / 0 SKIP**. T-shirt Draft evidence contains raw TAP and shared hash manifest.
- SQLite **158 PASS reused**, all 50 LF-normalized source hashes match; no PHP/SQLite rerun. Source/evidence hashes and earlier failed runs are recorded in `evidence/reservation-producer-20261027.json`.

First attempt found 13 producer failures from passing extra producer fields into the strict manual normalizer; fixed before final tests. A1 UI fixtures initially lacked the new mode predicate (2 failures), fixed explicitly in legacy mode. Initial sandbox hub startup timed out before tests; approved local emulator execution succeeded with Node loopback guard. This does not establish JVM OS-level outbound isolation.

Reproduce with the existing locked dependencies and emulator config: `firebase emulators:exec --only auth,firestore --project demo-icelolly-method-b --config firebase.json "node --test --test-concurrency=1 --test-timeout=60000 --test-reporter=tap api.test.mjs reservations.test.mjs"`. Use fixed hosts 127.0.0.1:8087 / 9098 and no real credentials. UI integration test requires METHOD_B_TEST_DIR pointing at this directory and is launched separately against fresh emulators.

## Remaining shortest path to acceptance

1. Connect verified Woo order/HPOS notification and authoritative event Session adapters to this producer, with original source IDs, stop/reconcile handling, and privileged complete-source migration. Existing SQLite stays a contract model, not stock authority.
2. Finish T-shirt remaining controls and Accessories UI/metadata/init paths; production completion/material consumption; all full-document writers, migrations, service workers and offline queues. T-shirt direct quantity input has a disabled-by-default API connection; whole writer closure remains incomplete.
3. Migrate Sales Manager POS/void/end/final counts/later SKU/Quick/legacy queues to shared floor/revision receipts without double decrement or guessed identities. Existing method-b-sales compatibility writer is not migrated.
4. Validate real service auth/IAM/deny-write Rules, backup/restore and stop/reconciliation; HPOS/Stripe sandbox workflow and per-SKU concurrent acceptance. Only then seek scoped Staging deployment approval. Production publication/purchases/reservations remain disabled pending explicit approval.

Original worktrees and six consent files were copied to `producer-preserved-20261027` and left unchanged. Only selected files are saved. GitHub saves use fresh head checks, expected-SHA CAS, force=false, [skip ci], Draft and no merge.

