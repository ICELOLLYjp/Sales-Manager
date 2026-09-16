"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  candidateDocumentId,
  normalizePreviewCandidate,
  candidateWrite
} = require("../candidateStorage");

const account = "fjmthrs@gmail.com";
const raw = {
  account,
  messageId: "message_123",
  threadId: "thread_123",
  date: "2026-09-14",
  sender: "Grab <no-reply@grab.com>",
  subject: "Your Grab E-Receipt"
};

test("candidate document ID is deterministic and account-scoped", () => {
  assert.equal(candidateDocumentId(account, raw.messageId), candidateDocumentId(account, raw.messageId));
  assert.notEqual(
    candidateDocumentId(account, raw.messageId),
    candidateDocumentId("icelolly.zakka@gmail.com", raw.messageId)
  );
});

test("preview candidate keeps metadata only", () => {
  const candidate = normalizePreviewCandidate({ ...raw, body: "PRIVATE", snippet: "PRIVATE" }, account, "2026-09");
  assert.equal(candidate.account, account);
  assert.equal(candidate.subject, raw.subject);
  assert.ok(!JSON.stringify(candidate).includes("PRIVATE"));
});

test("new writes are unreviewed and never posted as expenses", () => {
  const candidate = normalizePreviewCandidate(raw, account, "2026-09");
  const write = candidateWrite(candidate, false, "staff@example.com", new Date("2026-09-17T00:00:00Z"));
  assert.equal(write.reviewStatus, "unreviewed");
  assert.equal(write.reviewRequired, true);
  assert.equal(write.expenseScope, "unassigned");
  assert.equal(write.eventId, null);
  assert.equal(write.expensePosted, false);
  assert.equal(write.amount, null);
});

test("rescans do not overwrite review or accounting fields", () => {
  const candidate = normalizePreviewCandidate(raw, account, "2026-09");
  const write = candidateWrite(candidate, true, "staff@example.com", new Date("2026-09-17T00:00:00Z"));
  for (const field of ["reviewStatus", "reviewRequired", "expenseScope", "eventId", "eventName", "amount", "currency", "paymentConfirmed", "expensePosted", "createdAt"]) {
    assert.equal(Object.hasOwn(write, field), false);
  }
});

test("candidate validation rejects mismatched accounts", () => {
  assert.throws(
    () => normalizePreviewCandidate(raw, "icelolly.zakka@gmail.com", "2026-09"),
    /Gmailアカウントが一致/
  );
});
