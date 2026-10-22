# Offline trust and timestamp contract

Base: 040dfb30a6aed3b00c75fb038aeb6e1452bcfd70 (PR #123).

`void-contract.mjs` implements structural ancestor checks, an unconditional
durable-acceptance refusal, an inspectable write-time/read-time contract, and
shared candidate reconciliation for commit retry and result query. No API is
connected. `void-timestamp-proof-gate-closed` is unchanged before DB access.

No durable independent trust anchor was established. Existing serverSaleV1,
transactionLocks and row movements are in the same mutable trust domain.
Their hashes, allowed actor UID and Timestamp shape cannot authenticate a
coherent rewrite. C03 explicitly demonstrates this limitation. An in-memory
held digest or WeakMap plan is not restart-safe storage or independent evidence.
`acceptPersisted` always throws `independent-anchor-unproven` (503).
No HMAC, secrets, collection, infrastructure or Rules changes were introduced.

The injected codec and sentinel predicate are trusted adapter dependencies,
never request input. Test doubles use a private WeakSet and exact sentinel
identity. Real SDK provenance and identity authentication are not implemented.
The ancestor snapshot is typed-hashed including its audit values; existing
sale-server-v1 business hashes retain their original format. The write contract
binds actor, intent, session, original hash, before-state hash, revisions, exact
operations, paths, values and explicit timestamp slots. Sentinel values are
excluded from the semantic hash. Read inspection requires resolved typed values
at every slot and equal timestamps across this proposed atomic write group.
It compares update/create payload projections, NOT complete DB snapshots.
Equal timestamps do not prove an atomic commit, trusted clock or acknowledgement.

The legacy DTO planner's zero time is internal scaffolding only. Every emitted
audit slot is replaced by the injected sentinel. Its candidate serverVoidV1 is
removed: it hashes a resolved time, so replacing that time with a transform is
not a valid persisted-proof design. Outputs remain **unpersistable**, including
DTO-converted metadata; do not pass them to an Admin writer. No persisted proof
is claimed and no post-commit proof patch is proposed. The existing typed
candidate replay path remains separate from this write-shape inspection.

Measured: Node v24.21.0; inherited U/B/D/T 69 PASS, new C01-C16 16 PASS;
total 85 PASS, 0 FAIL/cancelled/skipped/todo. Standard-library import allowlist,
clean child environment, explicit file-read permissions, web globals disabled,
no child/worker/addons; no SDK, credential read or network operation in tests.
This is not an OS firewall or environment-gate certification. Local TAP and
runner retained separately; contract-evidence.json records portable hashes.

Next: establish independently verifiable durable provenance (or explicitly
validated protected-writer provenance within the existing threat model), then
a bounded persisted proof preserving native metadata and transform semantics.
Only after those checks may all existing sale proof branches and the void path
share the verifier inside one Admin transaction. Environment gate, real SDK
Timestamp/authentication/atomicity/ack, V01-V10 and relevant API regressions
remain unproven. Emulator and all live services remained untouched.
