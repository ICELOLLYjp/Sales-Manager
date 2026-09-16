"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { monthQuery, previewMessage, MAX_MESSAGES } = require("../expensePreview");

test("month query is bounded to selected month, including December", () => {
  assert.match(monthQuery("2026-09"), /after:2026\/09\/01 before:2026\/10\/01/);
  assert.match(monthQuery("2026-12"), /after:2026\/12\/01 before:2027\/01\/01/);
  for (const input of ["2026-00", "2026-13", "2026-9", "1999-09", "2031-01", "", null]) {
    assert.throws(() => monthQuery(input));
  }
});

test("metadata preview contains no body, snippet or invented payment amounts", () => {
  const item = previewMessage({
    id: "abc123", threadId: "thread123", internalDate: "1780000000000",
    payload: { headers: [
      { name: "From", value: "Shop\nName <shop@example.com>" },
      { name: "Subject", value: "Invoice for SGD 25" }
    ] },
    snippet: "PRIVATE BODY", body: { data: "PRIVATE" }
  }, "fjmthrs@gmail.com");
  assert.equal(item.subject, "Invoice for SGD 25");
  assert.ok(!JSON.stringify(item).includes("PRIVATE"));
  assert.equal(item.amount, null);
  assert.equal(item.paymentConfirmed, false);
  assert.equal(item.reviewRequired, true);
  assert.equal(MAX_MESSAGES, 25);
});

test("invalid Gmail message IDs are rejected", () => {
  assert.equal(previewMessage({ id: "../private" }, "fjmthrs@gmail.com"), null);
});
