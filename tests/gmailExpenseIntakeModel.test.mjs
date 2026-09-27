import { test } from "node:test";
import assert from "node:assert/strict";
import { groupIntakeSelection, groupIntakeSelectionByMonth, intakeKey, planIntakeAssignments, searchMonths } from "../js/gmailExpenseIntakeModel.js";

const one = { account: "fjmthrs@gmail.com", messageId: "a1" };
const two = { account: "icelolly.zakka@gmail.com", messageId: "b2" };

test("searches backward across years without including months before 2025", () => {
  assert.deepEqual(searchMonths("2026-01", 3), ["2026-01", "2025-12", "2025-11"]);
  assert.deepEqual(searchMonths("2025-02", 6), ["2025-02", "2025-01"]);
  assert.deepEqual(searchMonths("2026-09", 1), ["2026-09"]);
});

test("keeps selected results in their scanned month for saving", () => {
  const a = { ...one, searchMonth: "2026-09" };
  const b = { ...two, searchMonth: "2026-08" };
  assert.deepEqual(groupIntakeSelectionByMonth([a, b], new Set([intakeKey(a), intakeKey(b)])), [
    { account: a.account, month: "2026-09", messages: [a] },
    { account: b.account, month: "2026-08", messages: [b] }
  ]);
});

test("groups selected messages by account without duplicate saves", () => {
  const selected = new Set([intakeKey(one), intakeKey(two)]);
  assert.deepEqual(groupIntakeSelection([one, one, two, { account: "invalid@example.com", messageId: "z" }], selected), [
    { account: one.account, messages: [one] }, { account: two.account, messages: [two] }
  ]);
  assert.deepEqual(groupIntakeSelection([one, two], new Set()), []);
});

test("only unassigned and same event candidates can be assigned safely", () => {
  const messages = ["new", "same", "other", "general", "excluded", "postedElsewhere", "postedHere", "notListed"].map(messageId => ({ account: one.account, messageId }));
  const candidates = [
    { ...messages[0], id: "new", expenseScope: "unassigned", reviewStatus: "unreviewed" },
    { ...messages[1], id: "same", expenseScope: "event", eventId: "eventA" },
    { ...messages[2], id: "other", expenseScope: "event", eventId: "eventB" },
    { ...messages[3], id: "general", expenseScope: "general" },
    { ...messages[4], id: "excluded", expenseScope: "unassigned", reviewStatus: "excluded" },
    { ...messages[5], id: "postedElsewhere", expenseScope: "event", eventId: "eventB", expensePosted: true },
    { ...messages[6], id: "postedHere", expenseScope: "event", eventId: "eventA", expensePosted: true }
  ];
  const plan = planIntakeAssignments(messages, candidates, "eventA");
  assert.deepEqual(plan.assign.map(item => item.id), ["new"]);
  assert.deepEqual(plan.alreadyAssigned.map(item => item.id), ["same", "postedHere"]);
  assert.deepEqual(plan.conflicts.map(item => item.id), ["other", "general", "excluded", "postedElsewhere"]);
  assert.deepEqual(plan.missing.map(item => item.messageId), ["notListed"]);
  assert.equal(candidates[2].eventId, "eventB");
});
