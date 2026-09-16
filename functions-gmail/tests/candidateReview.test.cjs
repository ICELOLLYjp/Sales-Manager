"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { duplicateGroups, publicCandidate } = require("../candidateReview");

function snapshot(id, data) {
  return { id, data: () => data };
}

test("possible duplicates are warned and never removed", () => {
  const items = [
    { id: "a", date: "2026-09-16", sender: "Mori <pay@example.com>", subject: "Re: Invoice 123" },
    { id: "b", date: "2026-09-16", sender: "pay@example.com", subject: "Invoice 123" },
    { id: "c", date: "2026-09-17", sender: "pay@example.com", subject: "Invoice 123" }
  ];
  assert.deepEqual(duplicateGroups(items), [["a", "b"]]);
  assert.equal(items.length, 3);
});

test("public candidate exposes review metadata but no private body", () => {
  const item = publicCandidate(snapshot("abc", {
    account: "icelolly.zakka@gmail.com",
    messageId: "message1",
    date: "2026-09-16",
    sender: "sender@example.com",
    subject: "Invoice",
    body: "PRIVATE BODY",
    reviewStatus: "kept",
    amount: null,
    expensePosted: false
  }));
  assert.equal(item.reviewStatus, "kept");
  assert.equal(item.expensePosted, false);
  assert.ok(!JSON.stringify(item).includes("PRIVATE BODY"));
});

test("unknown review status is treated as unreviewed", () => {
  const item = publicCandidate(snapshot("abc", { reviewStatus: "unexpected" }));
  assert.equal(item.reviewStatus, "unreviewed");
  assert.equal(item.reviewRequired, true);
});
