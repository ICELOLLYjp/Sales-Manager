> 2026-10-28 follow-up: isolated Woo/HPOS temporary-hold adapter now tested; see [current slice and evidence](EC_WOO_PRODUCER_20261028.md). Production integration remains incomplete.

# Event release source gate — 2026-10-28 JST

Isolated implementation, not deployed. Extends Sales-Manager Draft #127 at `5da4f0aae8c2edc2f652fe6f5eb01a91e6c3cca9`. One vertical slice of priority 1: native Session/sales source reads → reconciliation gate → shared reservation producer → atomic revision/ledger/receipt → same-ID replay. Woo/HPOS adapters and full producer source coverage are not complete.

## Event operating boundary

Taipei Pinkoi Design Fest is 2026-10-30 through 2026-11-01. Existing POS and stock operation must remain intact. The 2026-10-27 20:23 quantities (180 shirts / 31 groups, production tasks 49) are historical references only, never seed data or available-to-sell quantities. All EC purchases stay stopped; reopening is manual after the event and reconciliation. No live stock, production, staging, Rules/IAM, payments, deployment, merge or purchase enablement is part of this change.

## Implemented behavior

`event-release.mjs` reads native `salesSessions/{id}` and the `salesTransactions` query by `sessionId`. These are the actual collection/field contracts used by `js/services/eventCloseService.js`, verified against GitHub #127 (blob `48b0fb78e3fc6d6524d22d8da244f057a781dcf9`). Only synthetic data uses these shapes in the Emulator.

Every fresh event release, including zero remaining, now requires namespace `sales-manager`, closed Session, Timestamp finalization/adjustments, zero unclassified difference, and a privileged `inventoryEventReconciliations/{hash(normalizedOperation)}` record. The record binds the exact operation (including SKU, source, quantity, operationId and expected canonical revision) and the current Session and sales/void document versions plus content hashes. Unknown/missing review is a 409 `event-reconciliation-required`; no fresh receipt or inventory update occurs. Client callers cannot supply paths, source manifests or review flags.

Required explicit review attestations: physical count reviewed, all devices synced, sales and voids reviewed, unresolved count zero, manual release approved, review ID and Timestamp. **No production issuer exists.** This is a privileged review contract, not automatic proof that an offline device has no pending sales. No server-only query can prove that. Tests seed review records through the demo Admin SDK only; existing emulator Rules deny all client writes, including these records. Production Rules are unchanged and unverified.

Stock, EC/event ledger, authority, Session, sales query and review are read in the same transaction. Source ABA (even identical final data with a newer updateTime), delayed inserts, cancellation updates or deletion invalidate an earlier review. Stock revision races reject with `inventory-conflict`; a new operation requires fresh explicit review, not blind retry. The transaction preserves physical stock on release, advances revision, updates the authority and stores historical source proof in the receipt atomically.

Same operation replay validates the historical proof and returns the previous result without releasing again or rereading it as a new operation. Later source changes do not turn historical success into a new write. Pre-gate event release receipts without proof fail closed and require reconciliation. No automatic receipt migration or new-ID retry. No TTL, event date or Session-close auto-release.

Bounded to 1,000 transaction documents; larger events reject and need a reviewed scaling design. Full-session reconciliation is intentionally required here; per-SKU partial release is not yet implemented. Reconciliation records are not a second stock authority and cannot initialize a missing reservation checkpoint.

## Validation and preservation

See `docs/evidence/event-release-20261028.json` and raw logs. Only affected producer and new gate tests were run. Existing manual 38 and UI suites were not rerun. SQLite 158 PASS is reused evidence after all 50 LF-normalized source hashes matched; not a new run.

Initial sandbox startup timed out on loopback hub before tests. Bounded local execution with no credentials, fixed demo project, fixed loopback endpoints and the existing Node network guard started the actual Firestore/Auth emulators. Java OS-level outbound isolation is not claimed. SDK metadata-discovery warnings are retained in raw evidence, not hidden.

The first 32-case run had producer 20 PASS and gate 11 PASS, with one cancelled/timeout case: the test awaited a source write while its own transaction held that source query lock. That test harness deadlock was replaced with concurrent canonical count vs reviewed release. Final gate-only rerun verifies the corrected suite; initial successes are not double-counted.

26 local git work copies inspected, 97 dirty files copied with worktree/index binary patches to `resume-preserved-20261028/manifest.json`. Six separate consent files match their prior preservation hashes and are not integrated. Original copies remain untouched. All three referenced PR heads and four repository main heads matched the stated baseline. Sources under `sources/` are untouched.

## Remaining connection and Staging gate

This is not a completed migration: Woo/HPOS order evidence, initial event hold/confirm adapters, trusted reconciliation issuance, device synchronization proof and purchase-stop enforcement still need implementation/integration. Existing direct/full-map writers, production completion, POS/void/close/later-SKU/offline queues and Accessories UI are unchanged. Late writes **after** a successful release cannot be prevented by this gate alone: old writers must be closed and devices drained/fenced before any real review can be issued. Do not connect this code to live data during the event.

Next: complete source-backed hold/confirm adapters and review issuance under a frozen writer boundary; then Accessories manual API connection and old writer/queue closure. Scoped Staging requires those closures, real service authentication/Rules/IAM validation, backup/independent restore, explicit stop/reconcile procedure, HPOS/payment acceptance as applicable, and separate explicit authorization. Keep EC stopped until event physical count, unsynced sales and cancellations reconcile; reopening remains a separate manual action.
