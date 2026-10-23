# Transaction reader: unconnected pre-integration adapter

2026-10-23. Reviewed base: `6f9466b4965dee80c7c9dddcbef34c0f5cb217c7` (PR #123).
No SDK loaded, no credentials read, no database/emulator access. No existing
route, Rules, writer or runtime changed. This is not a usable cancellation API.

## Implemented contract

`transactionReader` accepts trusted server dependencies only. Request input is
the existing exact void intent or normalized commit/result input; it cannot
supply actor, snapshot, revision, trust attestation or receipt. There is no
HTTP route or runtime import. The public `protectedVoidApi` gate stays closed.

Boundary attestation must return exactly true before opening the transaction
and on each attempt. Missing/false/UNKNOWN refuses before reads. This callback
must represent externally verified protection for the selected database and
trusted Admin writer inventory; it is not an implementation of that protection.
No stored hash/schema/UID substitutes for it. Do not wire a constant true into
an actual adapter. Coherent wholesale rewriting by a trusted malicious Admin
remains outside the threat model, as demonstrated by existing W06.

Token verification calls `verifyIdToken(token, true)` before the transaction and
again on each attempt, validates the allowed UID and verified email, and passes
only the actor fields needed by the core. These are fake-port tests, not proof
of actual token revocation or atomicity between Auth and a database commit.

Each attempt reads exact sale/lock document paths, and the union of movements
selected by transactionId, reversalOfTransactionId and document-ID prefix.
The third association (reversal field) additionally catches a return with a
non-prefix ID and altered transactionId. Duplicate query rows must agree.
The session is read by the saved sale sessionId. Initial cancellation reads
stock documents using original saved SKU coordinates; expectedRevisions are
derived from those same snapshots, never from HTTP. Core checks reject an
older-than-sale/invalid/overflowed revision and inconsistent summaries.
Retries reread and recalculate against current stock; no cached write plan.

The adapter validates via protectedVoid, prepares all encodings and document
references, then stages updates/create-only returns. No reads follow writes.
Original sale items/cost/price snapshots, serverSaleV1, fingerprint and original
movements stay unchanged; only the existing cancellation audit/status fields
change on sale/lock. Nested stock metadata is copied with its Timestamp type.
The runner's fake commit preserves unrelated session fields as patch updates.

Both `commitReplay` and `resultReplay` use the same protectedVoid verifier and
return the original sale result with currentSaleStatus=voided, without writes.
They are ONLY branches for voided records, not replacements for commitSale or
saleResult. Missing/ordinary completed sales are rejected by these branches.
Future wiring must add these branches inside existing transactions before the
completed-only proof check, preserving the normal creation path. No such wiring
is included: all real integration conditions remain unproven.

## Source findings and writer inventory

- `sales.mjs`: imports Admin Timestamp/FieldValue/FieldPath. commitSale builds
  serverSaleV1 from canonical request, result, effects, sale and per-row movement
  hashes; creates sale/lock/movements inside the same transaction. Audit fields
  use FieldValue.serverTimestamp(). Existing records() queries transactionId
  plus ID prefix. checkProof requires instanceof Timestamp, completed/committed
  and original movement count; it cannot accept a valid voided sale today.
- `http.mjs`: verifyIdToken(token,true), fixed fixture UID allowlist and verified
  email. `runtime.mjs` imports SDK at module evaluation and gates emulator hosts
  and demo project, but does not establish complete home/ADC/outbound isolation.
  These files were inspected as text only, never imported/executed.
- `manual-compat.mjs`: Admin transaction reads stock and receipt, compares
  expectedRevision/quantity, updates stock revision and creates server receipt;
  uses Admin Timestamp and serverTimestamp. This is another trusted stock writer,
  not proof that legacy writers have been excluded.
- Root `firestore.rules`: allowedUser() is signedIn(). Top-level wildcard allows
  authenticated writes to sale/lock/movement/session and product/variant docs.
  Stock master/shared updates require revision+1/protocol1, not an Admin-only
  writer. Any authenticated client capable of direct SDK requests can rewrite
  evidence collections under these source Rules. UI email restrictions do not
  close that boundary. This is source analysis, NOT deployed Rules verification.
- `js/services/transactionService.js`: commitQuickSale and voidSaleTransaction
  obtain the client db through firebase.js/inventory-firestore.js and directly
  set/update sale, lock, movement, session and stock in client transactions.
  Existing cached clients/old tabs/SW can therefore remain direct writer paths.
- `docs/METHOD_B_WRITE_PATHS.md` also inventories event close, late SKU,
  fast-amount allocation, session lifecycle/count/flow, T-shirts/Accessories
  master editors and external counts. These are documented additional writers;
  their current code outside the fetched files and deployed grants are UNKNOWN.
- `isolated/method-b-sales/firestore.rules`: all client writes denied; reads
  limited to three fixture UIDs with verified email. Its deployment and Admin
  permissions are UNKNOWN. External Admin/service accounts, console users,
  IAM roles and other projects/apps are UNKNOWN; no live discovery was attempted.

## Test evidence and limits

33 fetched reference files were compared byte-for-byte by Git blob SHA to the
base tree, including all 17 existing offline .mjs modules/tests. Original local
working trees and historical evidence were not modified. The independent work
directory contains exact fetched sources, source-comparison.json and the runner.

Measured final run: existing 107 + R01-R20 20 = **127 PASS, 0 FAIL**;
cancelled/skipped/todo 0, Node v24.21.0. See reader-tests.tap and
reader-evidence.json (source hashes and static import audit included).
The PowerShell runner clears child environment to SystemRoot only, pins the
Node executable hash, uses --permission, exact file read allowlists, no write,
child, worker or addon permissions, and --test-isolation=none. Preflight disables
fetch/WebSocket/EventSource. Static audit permits only reviewed local modules
and node:crypto/util/test/assert; rejects external/dynamic loaders and process
access outside preflight. No OS firewall/network sandbox guarantee is claimed.
Only this reviewed offline module graph ran; SDK/runtime files are excluded.

Tests cover source-path mismatch, token/actor and Timestamp spoofing, revoked
retry, boundary loss, complete read-before-write ordering, missing/extra/orphan
returns, revision conflicts/retries, metadata, duplicate void and stale sale
replay, absent/session evidence, reference preparation failure, and unknown ack.
The fake runner's retries/commit/ack model is not actual Firestore evidence.

## Remaining gates / smallest next step

Actual Timestamp provenance must be supplied by a trusted SDK reader to
timestampCodec; instanceof alone is insufficient. Real sentinel encoding,
query completeness/index behavior, SDK read-only options, transaction retry and
atomicity, authorization and commit acknowledgement remain UNKNOWN. V01-V10
are NOT passed. Emulator dependency/home/ADC/outbound blockers remain unchanged.

Next: review a bounded, disabled SDK binding for the exact injected interfaces
(Timestamp provenance, FieldPath, sentinel, auth and environment attestation),
then resolve the existing safe-environment gate before any SDK/emulator test.
Keep the old-writer exclusion gate and production prohibition. No Rules/IAM or
old-writer changes are authorized here. User configuration is not needed now.
