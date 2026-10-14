# Isolated sales API — not connected to products

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
