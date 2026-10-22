# Offline void decision preservation (2026-10-22)

Candidate-only code, not an API or persisted serverVoidV1 proof. No runtime import or deployment.
Preserved unchanged from the reviewed 2026-10-21 source. Base PR head: 60910d6f3500301eb69e57b98c371bff30d7adc1.

## Use and evidence
The eight modules are the minimum dependency closure for U01-U21 and B01-B14.
Run the two explicit test files with standard Node test runner (no npm install or Firebase SDK).
Use a clean child environment, audited local imports only, Node permission read allowlist for these files, no write/child/worker/addons, and disable fetch/WebSocket/EventSource before loading tests.
Do not run the parent API test runner or start an emulator.

Reproduced 2026-10-22 with Node v24.21.0: 35 tests, 35 pass, 0 fail/cancelled/skipped/todo, exit 0.
U01-U21: pure decisions. B01-B14: JSON-only observed-record boundary.
The child inherited SystemRoot only; preflight also allowed Node's test-worker ID.
No SDK, credentials, home reads or network calls in the audited import closure.
This is not an OS firewall isolation claim.
Prior manual API 25 / sale API 19 and earlier pure 21 are separate historical evidence, not additional current passes.

The 23-file prior manifest matched. Protected reference groups 264 / 23 / 3 / 14 / 41 matched their prior hashes (overlapping groups are not summed).
Plan section 3 and prior sales/validation/manual-compat/api-test blob references match the unchanged PR head.

## Boundaries
trustedAnchor is not authentication or commit acknowledgement. Never accept it, beforeState or audit identity from HTTP.
offline-void-boundary-v1 and void-pure-candidate-v1 MUST NOT be accepted as persisted cancellation proof.
Real Timestamp normalization, trusted actor, atomic Admin transaction and commit/result integration remain adapter work.
Environment gate remains FAILED: 106 of 224 emulator dependency locks missing, hub socket timeout, home/ADC/outbound isolation unproven.
No emulator/install/download/real Firestore access. V01-V10, atomicity, permissions, real Timestamp and commit acknowledgement are NOT passed.

## SHA-256 (preserved bytes)
- validation.mjs: `23df06e9ad24788ca300a5cab138130b058e4aab55b9099c7d6ca3bfeb77b8af`
- sale-primitives.mjs: `a2ac5d72a510573e9b1cb87c567b6952a4ea5d3b8e61a0b7623116d044ea6ac8`
- void-pure.mjs: `07369f31bf97982189b06943a61ff33259540d63f352848c6d0720d986700228`
- fixture.mjs: `17aac8deeb5e3120196c65394ac9e1349875eefa3f44c25715c539e83c0aa4b8`
- void-pure.test.mjs: `82798796533908d2c9858fde148650c077a6ac8602c2f64bdf0b1cda2b64b872`
- void-boundary.mjs: `be7df44bf31d9124291483990024d78d099bb817d8b434f24f9a6e5204325e69`
- boundary-fixture.mjs: `93b65f1e98d787fffd726d4dceca34c409be499029f72ceb2ade879fb33272e8`
- boundary.test.mjs: `443f4dea983486f7a0ef2ab1bfe992e7cb80c221d1860cbaeb9b2e3b0485970a`
