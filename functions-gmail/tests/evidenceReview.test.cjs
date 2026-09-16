"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { normalizeEvidenceReview } = require("../evidenceReview");

test("paid evidence requires a reviewed amount and currency", () => {
  const item = normalizeEvidenceReview({
    amount: "100",
    currency: "sgd",
    paymentStatus: "paid_evidence",
    category: "other",
    description: "Two clothing racks"
  });
  assert.equal(item.amount, 100);
  assert.equal(item.currency, "SGD");
  assert.equal(item.paymentStatus, "paid_evidence");
  assert.equal(item.category, "other");
});

test("invoice or payment status cannot invent a missing amount", () => {
  assert.throws(() => normalizeEvidenceReview({
    amount: null,
    currency: "SGD",
    paymentStatus: "paid_evidence",
    category: "other"
  }), /金額と通貨/);
});

test("unverified evidence may keep amount unknown", () => {
  const item = normalizeEvidenceReview({
    amount: null,
    currency: "",
    paymentStatus: "unverified",
    category: "other"
  });
  assert.equal(item.amount, null);
  assert.equal(item.currency, null);
});

test("unsupported status and category are rejected", () => {
  assert.throws(() => normalizeEvidenceReview({ paymentStatus: "posted", category: "other" }), /支払状態/);
  assert.throws(() => normalizeEvidenceReview({ paymentStatus: "unverified", category: "unknown" }), /経費分類/);
});
