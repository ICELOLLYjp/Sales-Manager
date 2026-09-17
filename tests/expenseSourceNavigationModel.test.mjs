import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidExpenseCandidateId, sessionExpenseDetailHref, validatedGmailSourceUrl } from "../js/expenseSourceNavigationModel.js";

test("Gmail source links only use stored candidate identifiers", () => {
  assert.equal(isValidExpenseCandidateId("a".repeat(64)), true);
  assert.equal(isValidExpenseCandidateId("a".repeat(63)), false);
  assert.equal(isValidExpenseCandidateId("../foo"), false);
});

test("Session detail links accept only a safe identifier", () => {
  assert.equal(sessionExpenseDetailHref("mori_2026-09"), "./?expenseSessionId=mori_2026-09");
  assert.equal(sessionExpenseDetailHref("../other"), null);
  assert.equal(sessionExpenseDetailHref("a?b"), null);
  assert.equal(sessionExpenseDetailHref(""), null);
});

test("Gmail source URLs reject external origins and unrelated paths", () => {
  assert.equal(validatedGmailSourceUrl("https://mail.google.com/mail/u/1/#search/mori"), "https://mail.google.com/mail/u/1/#search/mori");
  assert.throws(() => validatedGmailSourceUrl("https://mail.google.com.evil.example/mail/u/1/"), /Gmail/);
  assert.throws(() => validatedGmailSourceUrl("https://mail.google.com/other"), /Gmail/);
  assert.throws(() => validatedGmailSourceUrl("javascript:alert(1)"), /Gmail/);
});
