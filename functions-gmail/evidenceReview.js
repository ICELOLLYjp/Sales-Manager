"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { COLLECTION } = require("./candidateStorage");

const AUDIT_COLLECTION = "gmailExpenseCandidateAudit";
const CURRENCIES = new Set(["JPY", "SGD", "TWD", "HKD", "THB", "USD"]);
const PAYMENT_STATUSES = new Set(["unverified", "invoiced", "paid_evidence"]);
const EXPENSE_CATEGORIES = new Set(["boothFee", "flight", "hotel", "shipping", "transport", "interpreter", "other"]);

function validCandidateId(value) {
  const id = String(value || "").trim();
  if (!/^[a-f0-9]{64}$/.test(id)) throw new HttpsError("invalid-argument", "候補IDが正しくありません。");
  return id;
}

function clean(value, limit) {
  return String(value ?? "").replace(/[\r\n\u0000-\u001f]/g, " ").trim().slice(0, limit);
}

function normalizeEvidenceReview(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new HttpsError("invalid-argument", "解析結果が正しくありません。");
  }
  const paymentStatus = clean(raw.paymentStatus, 30);
  const category = clean(raw.category, 30);
  const currency = clean(raw.currency, 3).toUpperCase();
  if (!PAYMENT_STATUSES.has(paymentStatus)) throw new HttpsError("invalid-argument", "支払状態を確認してください。");
  if (!EXPENSE_CATEGORIES.has(category)) throw new HttpsError("invalid-argument", "経費分類を確認してください。");
  if (currency && !CURRENCIES.has(currency)) throw new HttpsError("invalid-argument", "通貨を確認してください。");
  const amount = raw.amount === null || raw.amount === undefined || raw.amount === ""
    ? null
    : Number(String(raw.amount).replace(/,/g, ""));
  if (amount !== null && (!Number.isFinite(amount) || amount < 0 || amount > 100000000)) {
    throw new HttpsError("invalid-argument", "金額を確認してください。");
  }
  if ((paymentStatus === "invoiced" || paymentStatus === "paid_evidence") && (!(amount > 0) || !currency)) {
    throw new HttpsError("invalid-argument", "請求済みまたは支払確認には金額と通貨が必要です。");
  }
  return {
    amount,
    currency: currency || null,
    paymentStatus,
    category,
    description: clean(raw.description, 500) || null
  };
}

async function saveEvidenceReview({ db, candidateId, review, actorEmail, now = new Date() }) {
  const id = validCandidateId(candidateId);
  const normalized = normalizeEvidenceReview(review);
  const candidateRef = db.collection(COLLECTION).doc(id);
  const auditRef = db.collection(AUDIT_COLLECTION).doc();
  return db.runTransaction(async transaction => {
    const snapshot = await transaction.get(candidateRef);
    if (!snapshot.exists) throw new HttpsError("not-found", "候補が見つかりません。");
    const candidate = snapshot.data() || {};
    if (candidate.expensePosted === true) {
      throw new HttpsError("failed-precondition", "経費登録済みの候補は解析下書きを変更できません。");
    }
    if (candidate.reviewStatus !== "kept") {
      throw new HttpsError("failed-precondition", "先に「候補に残す」を選択してください。");
    }
    const expenseScope = candidate.expenseScope || (candidate.eventId ? "event" : "unassigned");
    if (expenseScope === "unassigned") {
      throw new HttpsError("failed-precondition", "先に対象イベントまたは一般経費を選択してください。");
    }
    const previous = candidate.evidenceReview || null;
    const evidenceReview = {
      ...normalized,
      source: "gmail_manual_evidence_review",
      reviewedAt: now,
      reviewedBy: actorEmail
    };
    transaction.update(candidateRef, {
      evidenceReview,
      amount: normalized.amount,
      currency: normalized.currency,
      paymentConfirmed: normalized.paymentStatus === "paid_evidence"
    });
    transaction.set(auditRef, {
      candidateId: id,
      action: "evidence_review_saved",
      previous,
      evidenceReview,
      actorEmail,
      createdAt: now
    });
    return { id, evidenceReview, expensePosted: false };
  });
}

function createEvidenceReviewSaver({ requireStaff, db, staffEmails }) {
  return onCall({
    region: "asia-southeast1",
    secrets: [staffEmails],
    timeoutSeconds: 60,
    maxInstances: 5
  }, async request => {
    const actorEmail = requireStaff(request);
    return saveEvidenceReview({
      db,
      candidateId: request.data?.candidateId,
      review: request.data?.review,
      actorEmail
    });
  });
}

module.exports = {
  CURRENCIES,
  PAYMENT_STATUSES,
  EXPENSE_CATEGORIES,
  normalizeEvidenceReview,
  saveEvidenceReview,
  createEvidenceReviewSaver
};
