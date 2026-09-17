import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeEventExpenseEntries } from "../js/expenseEventOverviewModel.js";

const sessionId = "mori2026";
function entry(id, amount, currency = "TWD") {
  return { candidateId: id, eventId: sessionId, amount, currency, subject: `注文 ${id}` };
}

test("event summary counts posted Gmail entries regardless of email month", () => {
  const data = { sessionId, entries: [entry("a", 3900), entry("b", 13050)] };
  const result = summarizeEventExpenseEntries(data, sessionId);
  assert.equal(result.count, 2);
  assert.deepEqual(result.totals, [{ currency: "TWD", amount: 16950 }]);
  assert.equal(data.entries[0].amount, 3900);
});

test("event summary keeps different currencies separate and handles empty entries", () => {
  const result = summarizeEventExpenseEntries({ sessionId, entries: [entry("a", 100, "TWD"), entry("b", 12, "USD")] }, sessionId);
  assert.deepEqual(result.totals, [{ currency: "TWD", amount: 100 }, { currency: "USD", amount: 12 }]);
  assert.deepEqual(summarizeEventExpenseEntries({ sessionId, entries: [] }, sessionId).totals, []);
});

test("event summary rejects mismatched sessions, duplicate ids and invalid amounts", () => {
  assert.throws(() => summarizeEventExpenseEntries({ sessionId: "other", entries: [] }, sessionId), /応答/);
  assert.throws(() => summarizeEventExpenseEntries({ sessionId, entries: [entry("a", 100), entry("a", 100)] }, sessionId), /不整合/);
  assert.throws(() => summarizeEventExpenseEntries({ sessionId, entries: [entry("a", -1)] }, sessionId), /金額/);
  assert.throws(() => summarizeEventExpenseEntries({ sessionId, entries: [entry("a", 100, "") ] }, sessionId), /通貨/);
});
