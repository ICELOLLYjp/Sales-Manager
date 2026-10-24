# Typed cancellation candidate — 2026-10-22

Base: PR #123 at 907985dc8723efdfda74c9eb27b85db80624ae43.
Additive offline work only. The existing transaction hard stop is unchanged.

## Implemented and reviewed

- timestamp-codec.mjs separates timestamp instances from JSON-shaped values,
  validates seconds/nanoseconds without millisecond loss, rejects Proxy, prototype
  forgery without trusted provenance, accessors in plain containers, sparse arrays,
  cycles, symbols, undefined, nonfinite numbers and negative zero. Typed hashing
  tags every container/scalar, so a JSON timestamp tuple cannot collide by shape.
  Copy preserves timestamp object identity; DTO conversion never creates instances.
- void-proof-candidate.mjs validates the saved original with the existing pure
  sale contract and permitted original actor UID. It binds the full original
  snapshot (including audit values), serverSaleV1, original lock/movements,
  cancellation intent, cancellation actor/time, exact after-sale and row returns.
  Original result, fingerprint, items, metadata and original movements survive.
- Same-intent cancellation and both sale retry/query decisions are executable
  offline adapters. They return the original sale result and voided status with
  newCommit=false / mayCreateSale=false. Unknown states, missing/extra movements,
  different intent, old schemas and modified audit evidence are rejected.
- Initial open session and stock/summary validity reuse boundaryPlan. Existing
  U/B/D tests verify SKU aggregation, revision once per stock document, and the
  eight-write single-boundary projection. This addition is NOT a transaction.

## Trust boundary and deliberately incomplete parts

The only accepted new schema is **void-timestamp-candidate-v1**, NOT a production
serverVoidV1 receipt. Never persist this candidate or accept it from HTTP.
The constructor and fromTrustedRead callback are trusted adapter dependencies.
The callback must establish provenance from a validated SDK snapshot; accepting
all instanceof values is insufficient. This SDK reader is not implemented.
The tests use a frozen TestTimestamp and a private WeakSet, not Admin Timestamp.

Replay additionally requires independently held originalHash and candidateHash.
These bind coherent audit rewrites as well as single-field tampering. They are
test trust anchors, not authentication, signatures, storage receipts, or commit
acknowledgements. Computing either from the untrusted record under examination
and calling that verification would be circular. No durable source for these
anchors is implemented, and no new collection or receipt schema is invented.

The candidate retains beforeState for offline reconstruction only; it is not a
size-bounded storage design. Typed state metadata stays in the candidate intact.
DTOs are used only for the existing business planner, never as database writes.
Unsupported timestamp-containing business fields may fail original proof hash
comparison; the codec does not silently rewrite the old serverSaleV1 hash format.

sales.mjs at the pinned head excludes createdAt/updatedAt from sale/movement core
hashes and writes serverTimestamp transforms. Those transforms are unresolved
until commit, so the test's resolved audit time cannot be substituted for them.
Next minimal work is a trusted SDK reader plus a bounded persisted-proof contract
that reconciles resolved server timestamps without synthesizing old audit data or
post-commit receipt patching. Then connect the same verifier to commitSale/result
and the atomic writer, preserving read-before-write and authenticated UID/email.
Real auth revocation and isolation guards remain responsibilities of http/runtime.

## Measured verification

Node v24.21.0, standard libraries only: new T01–T21 **21 PASS / 0 FAIL**.
Rechecked U01–U21, B01–B14, D01–D13: **48 PASS / 0 FAIL**.
Combined run: **69 PASS**, zero failures/cancelled/skipped/todo, exit 0.
Ten inherited source/test files exactly match the pinned GitHub contents.
Clean child environment, explicit file read allowlist, disabled web globals,
denied writes/child/worker/addons and static dependency audit were used. This is
not an OS firewall claim. Full TAP/runner/protection manifests remain local;
typed-evidence.json records portable source hashes and the measured counts.

No SDK load, emulator, install, authentication, Firestore, CI dispatch or deployment.
True Admin Timestamp, V01–V10, authorization, atomicity and commit acknowledgement
remain **UNPROVEN**. Environment gate remains FAILED (prior 106/224 missing,
hub timeout, home/ADC/outbound isolation unproven; not rerun here).
void-timestamp-proof-gate-closed remains unconditional, before DB access.
