import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_BULK_CANDIDATES, candidatesForFilter, duplicateCandidateIds, planBulkAction } from "../js/gmailExpenseBulkModel.js";

const id = value => value.repeat(64);
const item = (name, status = "unreviewed", extra = {}) => ({ id: id(name), subject: name, reviewStatus: status, expensePosted: false, account: "one@example.com", ...extra });
const payload = { candidates: [item("a"), item("b", "kept"), item("c", "excluded"), item("d", "kept", { expensePosted: true }), item("e", "unreviewed", { account: "two@example.com" })], sessions: [{ id: "event_1" }], duplicateGroups: [[id("a"), id("b")], [id("x")]] };

test("duplicate hints only include candidates in groups of at least two", () => {
  assert.deepEqual([...duplicateCandidateIds(payload)], [id("a"), id("b")]);
  assert.equal(candidatesForFilter(payload, { duplicates: "duplicate" }).length, 2);
  assert.deepEqual(candidatesForFilter(payload, { status: "posted" }).map(row => row.id), [id("d")]);
  assert.deepEqual(candidatesForFilter(payload, { status: "unreviewed", account: "two@example.com" }).map(row => row.id), [id("e")]);
});

test("review changes are restricted to selected unreviewed unposted candidates", () => {
  assert.equal(planBulkAction(payload, [id("a"), id("e")], "kept").rows.length, 2);
  assert.equal(planBulkAction(payload, [id("a")], "excluded").duplicateCount, 1);
  assert.throws(() => planBulkAction(payload, [id("b")], "kept"), /未確認/);
  assert.throws(() => planBulkAction(payload, [id("d")], "excluded"), /登録済み/);
  assert.throws(() => planBulkAction(payload, [id("a"), id("a")], "kept"), /1回/);
});

test("assignment validates destination and does not include excluded or posted candidates", () => {
  assert.equal(planBulkAction(payload, [id("a"), id("b")], "assign", "event_1").rows.length, 2);
  assert.throws(() => planBulkAction(payload, [id("c")], "assign", "event_1"), /除外/);
  assert.throws(() => planBulkAction(payload, [id("a")], "assign", "missing"), /見つかりません/);
  assert.throws(() => planBulkAction(payload, [id("a")], "assign", "../bad"), /イベント/);
});

test("limits batch size and rejects unknown, malformed or duplicate ids", () => {
  assert.equal(MAX_BULK_CANDIDATES, 20);
  assert.throws(() => planBulkAction(payload, [], "kept"), /1回/);
  assert.throws(() => planBulkAction(payload, Array.from({ length: 21 }, (_, i) => String(i)), "kept"), /1回/);
  assert.throws(() => planBulkAction(payload, [id("f")], "kept"), /不明/);
  assert.throws(() => planBulkAction(payload, ["../bad"], "kept"), /不明/);
});
