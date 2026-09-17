"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { COLLECTION } = require("./candidateStorage");
const { AUDIT_COLLECTION } = require("./candidateReview");

const SESSION_COLLECTION = "salesSessions";
const CONFIRMATION = "post_reviewed_expense";
const EXPENSE_CATEGORIES = new Set(["boothFee", "flight", "hotel", "shipping", "transport", "interpreter", "other"]);

function validCandidateId(value) {
  const id = String(value || "").trim();
  if (!/^[a-f0-9]{64}$/.test(id)) throw new HttpsError("invalid-argument", "候補IDが正しくありません。");
  return id;
}

function number(value) {
  const result = Number(value || 0);
  return Number.isFinite(result) && result > 0 ? result : 0;
}

function expenseEntry(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return {
      amount: number(value.amount),
      currency: String(value.currency || "JPY").toUpperCase(),
      fxRateToJPY: number(value.fxRateToJPY) || null,
      amountJPY: number(value.amountJPY)
    };
  }
  const amount = number(value);
  return { amount, currency: "JPY", fxRateToJPY: 1, amountJPY: amount };
}

function totalExpensesJPY(expenses) {
  let total = 0;
  for (const category of EXPENSE_CATEGORIES) {
    const entry = expenseEntry(expenses?.[category]);
    total += entry.amountJPY || (entry.fxRateToJPY ? entry.amount * entry.fxRateToJPY : 0);
  }
  return total;
}

function postingPlan({ candidate, session, expectedCurrentAmount }) {
  if (!candidate || candidate.reviewStatus !== "kept") {
    throw new HttpsError("failed-precondition", "先に候補を確認して「候補に残す」を選択してください。");
  }
  if (candidate.expenseScope !== "event" || !candidate.eventId) {
    throw new HttpsError("failed-precondition", "経費登録には対象イベントの指定が必要です。");
  }
  const review = candidate.evidenceReview;
  if (!review || review.paymentStatus !== "paid_evidence") {
    throw new HttpsError("failed-precondition", "支払確認済みの解析下書きが必要です。");
  }
  const amount = Number(review.amount);
  const currency = String(review.currency || "").toUpperCase();
  const category = String(review.category || "");
  if (!Number.isFinite(amount) || amount <= 0 || !currency) {
    throw new HttpsError("failed-precondition", "確認済みの金額と通貨が必要です。");
  }
  if (!EXPENSE_CATEGORIES.has(category)) {
    throw new HttpsError("failed-precondition", "経費分類を確認してください。");
  }
  if (!session) throw new HttpsError("not-found", "対象イベントが見つかりません。");
  const sessionCurrency = String(session.currency || "JPY").toUpperCase();
  if (currency !== sessionCurrency) {
    throw new HttpsError("failed-precondition", `候補の通貨${currency}とイベントの通貨${sessionCurrency}が一致しません。`);
  }
  const rate = currency === "JPY" ? 1 : number(session.fxRateToJPY);
  if (!rate) {
    throw new HttpsError("failed-precondition", "先にイベントの為替レートを設定してください。");
  }
  const current = expenseEntry(session.expenses?.[category]);
  if (current.amount > 0 && current.currency !== currency) {
    throw new HttpsError("failed-precondition", "既存経費と通貨が異なるため自動加算できません。");
  }
  const expected = Number(expectedCurrentAmount);
  if (!Number.isFinite(expected) || Math.abs(expected - current.amount) > 0.000001) {
    throw new HttpsError("aborted", "経費金額が画面表示後に変更されました。候補を再読み込みしてください。");
  }
  const nextAmount = current.amount + amount;
  const categoryEntry = {
    amount: nextAmount,
    currency,
    fxRateToJPY: rate,
    amountJPY: nextAmount * rate
  };
  const expenses = { ...(session.expenses || {}), [category]: categoryEntry };
  return {
    amount,
    currency,
    category,
    previousAmount: current.amount,
    nextAmount,
    categoryEntry,
    expenseTotalJPY: totalExpensesJPY(expenses)
  };
}

async function postReviewedCandidate({ db, candidateId, confirmation, expectedCurrentAmount, actorEmail, now = new Date() }) {
  const id = validCandidateId(candidateId);
  if (confirmation !== CONFIRMATION) {
    throw new HttpsError("failed-precondition", "経費登録の確認操作が必要です。");
  }
  const candidateRef = db.collection(COLLECTION).doc(id);
  const auditRef = db.collection(AUDIT_COLLECTION).doc();
  return db.runTransaction(async transaction => {
    const candidateSnapshot = await transaction.get(candidateRef);
    if (!candidateSnapshot.exists) throw new HttpsError("not-found", "候補が見つかりません。");
    const candidate = candidateSnapshot.data() || {};
    if (candidate.expensePosted === true) {
      return { id, duplicate: true, expensePosted: true, expensePost: candidate.expensePost || null };
    }
    if (candidate.expenseScope !== "event" || !candidate.eventId) {
      throw new HttpsError("failed-precondition", "経費登録には対象イベントの指定が必要です。");
    }
    const sessionRef = db.collection(SESSION_COLLECTION).doc(String(candidate.eventId));
    const sessionSnapshot = await transaction.get(sessionRef);
    const session = sessionSnapshot.exists ? sessionSnapshot.data() || {} : null;
    const plan = postingPlan({ candidate, session, expectedCurrentAmount });
    const expensePost = {
      eventId: candidate.eventId,
      eventName: String(candidate.eventName || session.eventName || "名称未設定").slice(0, 200),
      amount: plan.amount,
      currency: plan.currency,
      category: plan.category,
      description: String(candidate.evidenceReview?.description || candidate.subject || "").slice(0, 500),
      previousAmount: plan.previousAmount,
      nextAmount: plan.nextAmount,
      postedAt: now,
      postedBy: actorEmail,
      source: "gmail_reviewed_candidate"
    };
    transaction.update(sessionRef, {
      [`expenses.${plan.category}`]: plan.categoryEntry,
      "expenseSummary.totalJPY": plan.expenseTotalJPY,
      updatedAt: now
    });
    transaction.update(candidateRef, { expensePosted: true, expensePost });
    transaction.set(auditRef, {
      candidateId: id,
      action: "expense_posted",
      ...expensePost,
      createdAt: now
    });
    return {
      id,
      duplicate: false,
      expensePosted: true,
      expensePost,
      categoryEntry: plan.categoryEntry,
      expenseTotalJPY: plan.expenseTotalJPY
    };
  });
}

function createExpensePoster({ requireStaff, db, staffEmails }) {
  return onCall({
    region: "asia-southeast1",
    secrets: [staffEmails],
    timeoutSeconds: 60,
    maxInstances: 5
  }, async request => {
    const actorEmail = requireStaff(request);
    return postReviewedCandidate({
      db,
      candidateId: request.data?.candidateId,
      confirmation: request.data?.confirmation,
      expectedCurrentAmount: request.data?.expectedCurrentAmount,
      actorEmail
    });
  });
}

module.exports = {
  CONFIRMATION,
  EXPENSE_CATEGORIES,
  expenseEntry,
  totalExpensesJPY,
  postingPlan,
  postReviewedCandidate,
  createExpensePoster
};
