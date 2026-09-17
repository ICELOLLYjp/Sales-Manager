"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { duplicateGroups, publicCandidate, publicSession } = require("../candidateReview");

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

test("candidate expense scope is explicit and defaults safely", () => {
  const unassigned = publicCandidate(snapshot("a", {}));
  const general = publicCandidate(snapshot("b", { expenseScope: "general" }));
  const event = publicCandidate(snapshot("c", { expenseScope: "event", eventId: "session1", eventName: "Public Garden" }));
  assert.equal(unassigned.expenseScope, "unassigned");
  assert.equal(general.expenseScope, "general");
  assert.equal(event.eventId, "session1");
  assert.equal(event.eventName, "Public Garden");
});

test("session options expose classification and bounded expense posting metadata", () => {
  const item = publicSession(snapshot("session1", {
    eventName: "Public Garden",
    country: "Singapore",
    city: "Singapore",
    startDate: "2026-09-12",
    endDate: "2026-09-13",
    currency: "SGD",
    fxRateToJPY: 115,
    expenses: { boothFee: { amount: 500, currency: "SGD", privateNote: "PRIVATE" } },
    secret: "PRIVATE"
  }));
  assert.equal(item.id, "session1");
  assert.equal(item.eventName, "Public Garden");
  assert.equal(item.currency, "SGD");
  assert.equal(item.expenses.boothFee.amount, 500);
  assert.ok(!JSON.stringify(item).includes("PRIVATE"));
});
