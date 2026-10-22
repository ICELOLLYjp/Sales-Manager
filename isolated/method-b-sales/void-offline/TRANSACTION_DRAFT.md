# Unconnected transaction draft — 2026-10-22

The original eight offline modules and their 35-test evidence remain unchanged.
`void-transaction.draft.mjs` adds a strict POST `/v1/sales/void` input parser,
an offline atomic-write-set projection, and a single Admin-transaction body draft.
It is not imported by sales.mjs, http.mjs or runtime.mjs. No listener is created.

The draft reads sale/lock plus the union of transactionId and document-ID-prefix
movement queries; checks replay before the initial open-session restriction;
reads stock by saved SKU; plans stock revision once per document, row-specific
return creates, sale/lock updates, session summary and event sold-count reversal.
Original movement documents, sale ID, price/cost snapshots and serverSaleV1 are
preserved. An existing-record reconciliation draft returns the original sale
result with currentSaleStatus=voided and never enters new-sale creation.

## Hard stop and remaining compatibility work

Every transaction/reconciliation entry fails with 503
`void-timestamp-proof-gate-closed` BEFORE touching the DB. There is no enabling
environment variable or injectable bypass. The transaction body is NOT tested
or usable. Future `codec` methods are required interfaces, not implementations.

The pure boundary rejects non-JSON objects, while sales.mjs requires real
Timestamp instances and trusted actor UIDs. JSON conversion alone would lose
type provenance and cannot establish a valid persisted void proof. The offline
candidate includes before-state data and is not the final storage schema.
Both offline candidate schemas must remain rejected as server receipts.

Next smallest work: implement and review a real-Timestamp/verified-actor codec
and persisted serverVoidV1 schema, including original snapshot authentication
under the existing isolated Admin boundary, original/return movement coverage,
serverTimestamp/hash handling and preservation of untouched Timestamp metadata.
Then connect the SAME verifier to commitSale/result and the fixed HTTP route.
Use the parent validation ApiError class in the actual HTTP integration (the
preserved offline validation copy has a different class identity). Retain the
existing auth revocation, UTF-8/body limits, loopback and runtime checks.
Do not enable a void-only writer before both sale reconciliation paths work.

## Actual offline verification

Node v24.21.0, 2026-10-22: D01-D13 = 13 PASS, 0 FAIL/cancelled/skipped/todo, exit 0.
These cover route/payload rejection, offline write-set fields, snapshot-preserving
patch shape, row returns, per-stock revision and the pre-DB hard stop.
No transaction body, SDK, real Timestamp, auth or commit acknowledgement tested.
The first preflight rejected the word `import` in a comment; no tests ran in that
attempt. The comment was clarified, the unchanged safety scanner then passed.
Sources were statically checked; clean child environment, read allowlist,
disabled web globals and denied write/child/worker/addons matched the 35-test run.

The separate original suite reproduced 35 PASS / 0 FAIL this session.
Historical API 25/19 and prior pure 21 are not new results.
Environment gate remains FAILED (106/224 dependencies missing, hub timeout,
home/ADC/outbound isolation unproven). V01-V10, real atomicity and permissions
remain NOT PASSED. No emulator, installation, download, deployment or real data.
