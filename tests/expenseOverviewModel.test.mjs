import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeExpenseCandidates } from "../js/expenseOverviewModel.js";

test("overview counts each saved candidate once and gives posted priority", () => {
  const original = [
    { reviewStatus: "unreviewed", expensePosted: false },
    { reviewStatus: "kept", expensePosted: false },
    { reviewStatus: "excluded", expensePosted: false },
    { reviewStatus: "kept", expensePosted: true },
    { reviewStatus: "excluded", expensePosted: true }
  ];
  assert.deepEqual(summarizeExpenseCandidates({ candidates: original, truncated: false }), {
    total: 5, unreviewed: 1, kept: 1, posted: 2, excluded: 1,
    truncated: false, maxResults: 100
  });
  assert.equal(original[0].reviewStatus, "unreviewed");
});

test("overview labels bounded results instead of implying they are complete", () => {
  const result = summarizeExpenseCandidates({
    candidates: [{ reviewStatus: "unreviewed", expensePosted: false }],
    truncated: true, maxResults: 100
  });
  assert.equal(result.total, 1);
  assert.equal(result.truncated, true);
  assert.equal(result.maxResults, 100);
});

test("overview rejects incomplete responses rather than showing misleading zero counts", () => {
  assert.throws(() => summarizeExpenseCandidates({}), /応答/);
  assert.throws(() => summarizeExpenseCandidates(null), /応答/);
});
