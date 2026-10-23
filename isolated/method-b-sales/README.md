# Isolated sales API — not connected to products

2026-10-24: the isolated harness now binds `POST /v1/sales/void` and voided
commit/result replay to the existing protected reader. It is enabled only when
the trusted harness supplies `rt.voidSales` after loading deny-write Rules and
checking client write rejection. The default runtime still has no void binding.
The tests alone attest their fresh demo database and known fixture/Admin writers;
that attestation does not transfer to a deployed database. Hashes do not protect
against a malicious trusted Admin. No product entrypoint or deployed Rules change.

Use `emulator-isolated.mjs`, not the old locally preserved `emulator-run.mjs`.
It preserves Java SecurityManager and loopback-only socket permissions. The
official Firestore 1.22.0 ELF/JAR requires disabling only URLClassPath's LOC-header
check, after its pinned SHA-256 passes. Rules CPU accounting additionally needs
ManagementPermission control. Node guard handles normalized connect arguments
and blocks direct DNS/UDP. Both runtimes must pass egress-denial and IPv4/IPv6
loopback preflights. Each run has a fresh dummy HOME, no inherited credentials,
and metadata discovery disabled. These guards cover the reviewed trusted runtime;
they are not an OS sandbox for hostile native code.

Windows prerequisites retained under ignored `artifacts/`: Java 21 in `java/`,
verified JAR in `emulator-cache/`, Firebase CLI 15.33.0 installed from the retained
`tools/package-lock.json` (use `npm ci --ignore-scripts`, never an unpinned install).
Compile the probe using Java 21 JDK: `javac -d artifacts LoopbackProbe.java`.
From this directory run:

```
node emulator-isolated.mjs "node --test --test-reporter=tap --test-timeout=60000 void-api.test.mjs"
```

Measured results and source hashes: `void-integration-results.json`. Raw logs and
before/after snapshots remain in ignored `artifacts/`. V07 uses a session-close
transaction fixture, not a delivered close API. Real Auth/IAM, old POS writers,
queues, partial cancellations, payments/refunds and deployment remain out of scope.
The three pre-existing local files were byte-preserved with a second copy in
`artifacts/resume-original-20261024/`; their unsafe/incomplete runner is not published.

Reproduction review (2026-10-24): clean checkout of GitHub `951edf3`, with
`core.autocrlf=false`, app lock (224 installed packages) and retained tools lock
(727 installed packages, SHA-256
`c9a9fdd60272ed7de975dd5bedfd76d87ff4fa6a27058180bddb9c25996ea7cc`).
Run `npm ci --ignore-scripts --no-audit --no-fund` in this directory and in
`artifacts/tools` during dependency acquisition only. Copy the retained Java 21
and checksum-verified JAR into the paths above; recompile `LoopbackProbe.java`
with JDK 21. The tools lock and binaries are local prerequisites, not contained
in GitHub: GitHub alone is not a complete environment archive. Check all five
ports are unused before each run; never stop another process to free them.
The OS sandbox may deny loopback; a run outside that sandbox must retain both
application guards and pass both preflights. Never remove either guard.

V01 now passes the exact original token to `verifyIdToken(token,true)` before
and after revocation, requires `auth/id-token-revoked`, and verifies HTTP 401
with an unchanged Firestore snapshot. It waits past the token's `auth_time`
second before revocation and checks the returned valid-after time. Disabling a
user similarly requires `auth/user-disabled`; fresh login/restoration is checked.
Malformed-token rejection is separate from these checks. Auth Emulator issues
unsigned `alg=none` tokens and the Admin SDK uses its emulator verifier (and
checks revocation even when checkRevoked is omitted). These are unmodified
emulator-token lifecycle results, NOT evidence for production RS256 signatures
or IAM. No JWT claims are edited and no auth mocks replace emulator evidence.
`artifacts/auth-evidence.json` records outcomes/times without saving tokens.

Actual close-path static comparison at `951edf3` (not an integration pass):
`js/services/eventCloseService.js` filters voided sales (line 307), reads session
and sales in preflight (592), requires opening/closing counts, and compares
status/count timestamps/lastTransactionAt/lastVoidAt (532, 1478) in its final
transaction. It writes an event-close lock, adjustment movements and close
summary (1851-2059); exact sales are not added to the adjustment movement list.
The isolated void writer updates lastVoidAt, but V07/V07b do not exercise these
preflight reads, counts, lock/movements or adjustment calculations.
`eventCloseFlowCompatService.js` additionally updates opening/recovery state
before and after the base call (68 onward); `eventCloseServiceCompat.js` also
prepares outside-opening allocations. Those client writes conflict with this
harness's deny-write boundary. No real close service was invoked or migrated.
Minimum next close work: inject only the Firebase state/SDK boundary into the
real service and wrappers in a dedicated demo harness; test void-then-close
without a second stock decrement, and void racing preflight/finalization with
changed-data rejection/retry. Keep those results separate from V07b and do not
relax deployed or isolated Rules to make the old writer work.

Approved scope: docs/METHOD_B_SALES_MINIMUM_SPEC_20261014.md. Fixed demo project,
Firestore 127.0.0.1:8088, Auth 127.0.0.1:9099, HTTP loopback ephemeral port.
No deployment entrypoint. Do not import from product JS, Functions, or Service Worker.
Only synthetic data; no production credentials. Existing manual API and its 25 tests unchanged.

Install fixed dependencies: `npm.cmd ci --prefix isolated/method-b-sales --ignore-scripts --no-audit --no-fund`.
Use existing Java21 and Firebase CLI as documented in ../method-b/README.md, substituting
`--project demo-icelolly-method-b-sales --config isolated/method-b-sales/firebase.json`.
Check ports 8088/9099/9153/4403/4503 are unused; do not stop unrelated processes.
With those fixed FIRESTORE_EMULATOR_HOST/FIREBASE_AUTH_EMULATOR_HOST variables set,
run `node isolated/method-b-sales/run-tests.mjs`.

The test hooks are constructor-only function arguments, never HTTP payload/environment commands.
Cost helpers are a frozen read-only copy of Sales dc8f14a transactionService lines 723–1053.
No product source is imported. Full POS migration, discounts, FX, queues, void/close APIs,
EC reservation and deployment remain excluded.

Validation: 19 scoped cases passed on 2026-10-14; see
../../docs/METHOD_B_SALES_VALIDATION_20261014.md for evidence and limitations.
manual-compat.mjs is byte-identical to ../method-b/inventory.mjs; its relative
runtime import binds to the sales demo only. P10 is a new algorithm integration
case, not a rerun of the old 25 tests or a claim about the old HTTP deployment.
