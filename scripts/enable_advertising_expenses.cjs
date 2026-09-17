"use strict";
// Run from the repository root. Validate every anchor before writing any file.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = process.cwd();
const changes = new Map();
function read(name) {
  if (!changes.has(name)) changes.set(name, fs.readFileSync(path.join(root, name), "utf8"));
  return changes.get(name);
}
function write(name, value) { changes.set(name, value); }
function replaceOne(name, pattern, replacement, label) {
  const source = read(name);
  const matches = [...source.matchAll(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g"))];
  assert.equal(matches.length, 1, `${name}: expected exactly one ${label}, found ${matches.length}`);
  write(name, source.replace(pattern, replacement));
}
function replaceBlock(name, start, end, transform, label) {
  const source = read(name);
  const a = source.indexOf(start);
  assert(a >= 0 && source.indexOf(start, a + start.length) === -1, `${name}: ambiguous ${label} start`);
  const b = source.indexOf(end, a + start.length);
  assert(b > a, `${name}: missing ${label} end`);
  const block = source.slice(a, b);
  const revised = transform(block);
  assert.notEqual(revised, block, `${name}: ${label} was unchanged`);
  write(name, source.slice(0, a) + revised + source.slice(b));
}
function injectBeforeOther(block, prefix, label) {
  const matches = block.match(/\bother\s*:/g) || [];
  assert.equal(matches.length, 1, `${label}: missing unique other entry`);
  return block.replace(/(\s+)other\s*:/, (_, spacing) => `${spacing}${prefix}${spacing}other:`);
}
function addCategoryToList(name, start, end) {
  replaceBlock(name, start, end, block => {
    assert.equal((block.match(/"other"/g) || []).length, 1, `${name}: ambiguous category list`);
    return block.replace(/"other"/, '"advertising", "other"');
  }, "category list");
}
addCategoryToList("functions-gmail/candidateReview.js", "const EXPENSE_CATEGORIES = [", "];\nconst MAX_LIST");
addCategoryToList("functions-gmail/evidenceReview.js", "const EXPENSE_CATEGORIES = new Set([", "]);\n");
addCategoryToList("functions-gmail/expensePosting.js", "const EXPENSE_CATEGORIES = new Set([", "]);\n");
addCategoryToList("js/services/sessionService.js", "const EXPENSE_KEYS = [", "];\n");
replaceBlock("js/app.js", "const EVENT_EXPENSE_LABELS = {", "const EVENT_EXPENSE_ORDER = [", block => injectBeforeOther(block, 'advertising:\n    "広告費",', "app labels"), "app labels");
replaceBlock("js/app.js", "const EVENT_EXPENSE_ORDER = [", "];\n", block => {
  assert.equal((block.match(/"other"/g) || []).length, 1, "app order: ambiguous other");
  return block.replace('"other"', '"advertising",\n  "other"');
}, "app order");
replaceBlock("gmail-expense-review.html", "const categoryLabels = {", "function postingSession", block => injectBeforeOther(block, 'advertising: "広告費",', "review labels"), "review labels");
replaceOne("gmail-expense-review.html", /\["other","その他"\]/, '["advertising","広告費"],["other","その他"]', "review category select");
replaceBlock("js/expenseManagementOverview.js", "const categoryLabels = {", "function formatMoney", block => injectBeforeOther(block, 'advertising: "広告費",', "overview labels"), "overview labels");
replaceOne("functions-gmail/expensePosting.js", /if \(currency !== sessionCurrency\) \{/, 'if (currency !== sessionCurrency && currency !== "JPY") {', "JPY expenses in overseas event");
replaceBlock("js/services/sessionService.js", "export async function createEventSession({", "export async function updateEventSession(", block => {
  const original = /      other: \{\n        amount: 0,\n        currency: "JPY",\n        fxRateToJPY: 1,\n        amountJPY: 0\n      \}/;
  assert(original.test(block), "new session default other category not found");
  return block.replace(original, '      advertising: {\n        amount: 0,\n        currency: "JPY",\n        fxRateToJPY: 1,\n        amountJPY: 0\n      },\n$&');
}, "new session default advertising");
replaceOne("index.html", /\.\/js\/app\.js\?v=20260917-event-expense-details-1/, './js/app.js?v=20260917-advertising-1', "main app cache version");
replaceOne("sw.js", /icelolly-sales-shell-20260917-gmail-bulk-triage-1/, 'icelolly-sales-shell-20260917-advertising-1', "service worker cache version");
const evidenceTest = '\n\ntest("advertising is an independent supported category", () => {\n  const item = normalizeEvidenceReview({ amount: 969, currency: "JPY", paymentStatus: "paid_evidence", category: "advertising", description: "Instagram advertising" });\n  assert.equal(item.category, "advertising");\n  assert.equal(item.amount, 969);\n});\n';
write("functions-gmail/tests/evidenceReview.test.cjs", read("functions-gmail/tests/evidenceReview.test.cjs") + evidenceTest);
const postingTest = '\n\ntest("JPY advertising in an SGD event is separately categorized and counted in JPY", () => {\n  const advertisement = candidate({ evidenceReview: { amount: 969, currency: "JPY", paymentStatus: "paid_evidence", category: "advertising", description: "Instagram advertising" } });\n  const event = session({ currency: "SGD", fxRateToJPY: 112, expenses: { boothFee: { amount: 3, currency: "SGD", fxRateToJPY: 112, amountJPY: 336 } } });\n  const plan = postingPlan({ candidate: advertisement, session: event, expectedCurrentAmount: 0 });\n  assert.equal(plan.category, "advertising");\n  assert.deepEqual(plan.categoryEntry, { amount: 969, currency: "JPY", fxRateToJPY: 1, amountJPY: 969 });\n  assert.equal(plan.expenseTotalJPY, 1305);\n});\n';
write("functions-gmail/tests/expensePosting.test.cjs", read("functions-gmail/tests/expensePosting.test.cjs") + postingTest);
const session = read("js/services/sessionService.js");
assert(session.includes('"advertising"') && session.includes('      advertising: {'), "session accounting does not include advertising");
const changed = [...changes].filter(([name, value]) => value !== fs.readFileSync(path.join(root, name), "utf8"));
for (const [name] of changed) console.log(`PATCH ${name}`);
if (process.argv.includes("--check")) console.log(`Checked ${changed.length} files; no changes written.`);
else {
  for (const [name, value] of changed) fs.writeFileSync(path.join(root, name), value);
  console.log(`Updated ${changed.length} files. Run tests before committing.`);
}
