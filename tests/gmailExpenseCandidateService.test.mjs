// Run with: node --experimental-default-type=module tests/gmailExpenseCandidateService.test.mjs
import assert from "node:assert/strict";
import { normalizeGmailExpenseCandidate, groupGmailExpenseCandidates } from "../js/services/gmailExpenseCandidateService.js";

const first = { account: "fjmthrs@gmail.com", messageId: "abc123", date: "2026-09-05", merchant: "Rack rental", amount: 100, currency: "SGD", invoiceNumber: "PG-001", status: "paid_evidence" };
const second = { ...first, account: "icelolly.zakka@gmail.com", messageId: "def456", status: "invoiced" };
const result = groupGmailExpenseCandidates([first, first, second]);
assert.equal(result.candidates.length, 2, "same Gmail source must be idempotent");
assert.equal(result.duplicateGroups.length, 1, "cross-account duplicate must be flagged, not dropped");
assert.deepEqual(result.accountCoverage, { "fjmthrs@gmail.com": 1, "icelolly.zakka@gmail.com": 1 });
assert.equal(normalizeGmailExpenseCandidate({ ...first, amount: null }).amount, null, "unknown amount must remain unknown");
assert.equal(normalizeGmailExpenseCandidate(first).reviewRequired, true);
assert.throws(() => normalizeGmailExpenseCandidate({ ...first, account: "unknown@gmail.com" }), /Unknown Gmail account/);
assert.throws(() => normalizeGmailExpenseCandidate({ ...first, amount: "invalid" }), /Invalid amount/);
assert.throws(() => normalizeGmailExpenseCandidate({ ...first, status: "posted" }), /Invalid evidence status/);
console.log("Gmail candidate normalization tests passed");
