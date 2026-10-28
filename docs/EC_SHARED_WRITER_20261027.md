# EC shared manual stock writer — 2026-10-27

Implemented and tested, **isolated server only / not deployed**. Based on Sales-Manager #123 `6eda78bcb89e33784249dd43e3b9b4420f5b11ba`; reuses `isolated/method-b/inventory.mjs` and its existing authenticated HTTP route. No second physical-stock authority or copy of the server implementation was added to Website.

## Completed unit

The same manual-edit API handles T-shirt exact Body/Design/Color/Size and accessory design ID plus piercing/earring. It reads canonical stock, reservation evidence and the operation receipt in one Admin transaction. It preserves unrelated SKU quantities, metadata and Timestamp values. The caller supplies only the existing operation ID, SKU, expected quantity/revision and new absolute quantity; arbitrary maps, paths, patches and caller-computed availability remain rejected.

Absolute quantity must be nonnegative and at least active EC holds/confirmed allocations plus remaining event commitments. Equality is allowed. Missing, incomplete, duplicate, malformed or overflowing evidence is a conflict, not zero availability. No TTL-based automatic release is implemented. Existing document-level CAS intentionally rejects stale different-SKU edits as well as same-SKU edits; the UI must reread and ask the operator to reconcile rather than silently reapply the number.

`inventoryReservations` is an **isolated producer contract**, co-located on `tshirtStock/master` or `accessoryStock/shared`:

```json
{"schema":"inventory-reservations-v1","complete":true,"entries":[
  {"id":"order-line-1","kind":"ec","state":"confirmed","sku":{"designId":"a","quantityField":"piercing"},"quantity":2},
  {"id":"session-sku-1","kind":"event","state":"held","sku":{"designId":"a","quantityField":"piercing"},"quantity":1}
]}
```

Only trusted server producers may set `complete:true` after reconciling all reservation sources. Never seed an empty ledger from missing production data. Every quantity/hold change must use the canonical document transaction and advance `inventoryRevision`, including hold create/confirm/release that leaves physical stock unchanged. Confirm replaces the same commitment identity, not a second row. Released rows do not count; unknown states fail closed. The 1,000-entry bound is an isolation guard, not a production retention/scaling policy.

Receipt schema is `manual-inventory-server-v2`. It atomically stores the normalized intent, historical reservation ledger, computed floor/hash and result. Identical replay validates historical evidence and does not apply a fresh write under today's holds. Altered intent/proof and old v1 receipts require reconciliation. **No automatic v1 receipt conversion or resubmission with a new ID.**

## Actual validation

Firestore Emulator 1.22.0 + Auth Emulator (firebase-tools 15.33.0), Node 24.21.0, Java Temurin 21.0.12.1+1, firebase-admin 14.4.0, Firebase JS 11.0.2, rules-unit-testing 4.0.1. Fixed loopback hosts 8087/9098, project `demo-icelolly-method-b`, synthetic identities/data only. Existing locked SDK dependencies were reused locally.

**37 passed, 0 failed, 0 skipped**: the existing 25 manual API cases (B17 now requires negative counts to fail) plus F01–F12. Both canonical schemas, combined EC/event floor and exact equality, unknown evidence, held/confirmed duplicate identity, released holds, other-SKU preservation, overflow, a/b/a, concurrent count/reservation, reservation-only ABA, original-ID lost-reply recovery, authentication rejection/revocation, direct client write denial, tampered/legacy receipts and real transaction rollback are covered. F08/F09 use a clearly labelled fixture reservation producer; they do not prove a real EC/event producer is connected. B19 is the injected real transaction failure case; F11 checks rejection preserves evidence.

Evidence: [JSON](evidence/ec-shared-writer-20261027.json), [raw TAP](evidence/ec-shared-writer-20261027.tap), [launcher](evidence/ec-shared-writer-launch-20261027.log). JSON fingerprints the executed sources. An initial sandbox hub timeout and Java SecurityManager class-loading failure occurred before tests. The successful run used the existing Node loopback egress guard and fixed demo/emulator configuration **without Java SecurityManager**; it is not evidence of JVM OS-level egress isolation. Emulators were shut down after the run.

Reproduce with the locked dependencies and local emulator binaries: `firebase emulators:exec --only auth,firestore --project demo-icelolly-method-b --config firebase.json "node run-tests.mjs"` from `isolated/method-b`, with `FIRESTORE_EMULATOR_HOST=127.0.0.1:8087` and `FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9098`. Do not supply production credentials. The existing runtime refuses non-emulator addresses.

Website #34 remains based on `187204caf36a219ee9de576be4b88b8e566da0c9`. Its PHP/SQLite implementation was not changed: all **50 LF-normalized source hashes** in the saved 158 PASS report match. Those 158 are reused evidence, not rerun or added to the new 37. See [reuse check](evidence/ec-shared-writer-sqlite-reuse-20261027.json).

## Reconciled repositories and remaining writers

- Website main `6d5971d75712b58baf73005a38cb13f79012c36e`, Draft #34 `187204caf36a219ee9de576be4b88b8e566da0c9`.
- T-shirts-Stock main `d39c818fccd57de304812d8188a51a068ab68a36`, Draft #41 `4f87a7d61c6acd6e496f3324474d6d4a38201548`.
- Accessories main `366205b677e6997c5e1a6a3852e0ef44fd336d9b`, Draft #22 `cd7107db45c1abe3ed8450cea72402b5a73f84b3`.
- Sales-Manager main `4c8b45d81df1755ba7a450c3476868631f51fdd6`, Draft #123 at the base above. #124 is a separate POS catalog display fix, not this writer connection.

T/A #41/#22 contain method-A client writers; main still has direct map/document writes. Neither is switched to the method-B HTTP API here. T-shirt `setFinishedInventoryAbsolute`/`saveMasterInventoryAndSync`, accessory `saveDesigns`/initialization/metadata autosave, production completion/material consumption, Sales POS/void/close/later allocation/Quick/offline queues, and `isolated/method-b-sales/manual-compat.mjs` remain **unconnected to the new floor contract**. The sales suite uses that independent compatibility module, not the changed module; it was not rerun or declared hold-safe. Real Auth signatures/IAM, old-browser/SW behavior and production Rules remain unverified.

Next implementation: connect authoritative EC/event commitment producers (including identities, confirmations, release and revision) and the two client manual-edit entry points; remove whole-document fallback and preserve pending operation IDs on uncertain replies. Then close production/POS/void/final-count/queue writers over the same boundary. No release of unconfirmed event SKUs or guessed Quick mappings. A real count below holds needs an operator exception workflow and purchase stop; rejection alone does not solve the physical discrepancy.

Staging requires those writer gaps, identity/Rules/IAM checks, backup/independent restore, stop/reconciliation procedure and explicit deployment approval. HPOS/Stripe and mixed production capacity remain subsequent integration work. This change enables neither purchases nor real reservations. No production/Staging/Rules/IAM/Stripe changes, merge or deployment occurred.

## Preservation and save

Original dirty Website worktrees were left intact. Current stock changes and the separate six consent files were copied with binary patches and SHA-256 manifest into local `shared-writer-preserved-20261027`; consent changes were not integrated. Work was done in separate checkouts. Save uses a dedicated Draft based on #123, `[skip ci]`, fresh HEAD comparison, expected-SHA CAS and `force=false`. Website #34 receives only the concise cross-repository pointer.


## 2026-10-27 Codex: reservation producer and T-shirt API connection

Server producer, source/SKU binding, reconciliation checkpoint and read-only result lookup implemented. Final affected suites: manual API 38, producer 20, T-shirt client+A1 23, actual client to HTTP/Auth/Firestore 3 PASS, all 0 FAIL / 0 SKIP. SQLite 158 reused after 50 source hash matches. See [implementation, evidence and remaining gates](EC_RESERVATION_PRODUCER_20261027.md). Disabled/unreleased; real Woo/Session adapters, all old writers, production identities/Rules and Staging acceptance remain incomplete. No deploy, purchase enablement, real stock write or merge.

