"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { COLLECTION } = require("./candidateStorage");
const { AUDIT_COLLECTION } = require("./candidateReview");

const SESSION_COLLECTION = "salesSessions";
const CONFIRMATION = "post_reviewed_expense";
const VOID_CONFIRMATION = "void_reviewed_expense";
const EXPENSE_CATEGORIES = new Set(["boothFee", "flight", "hotel", "shipping", "transport", "interpreter", "other"]);

function validCandidateId(value) {
  const id = String(value || "").trim();
  if (!/^[a-f0-9]{64}$/.test(id)) throw new HttpsError("invalid-argument", "候補IDが正しくありません。");
  return id;
}

function validSessionId(value) {
  const id = String(value || "").trim();
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(id)) {
    throw new HttpsError("invalid-argument", "イベントIDが正しくありません。");
  }
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

function publicEventExpenseEntry(id, candidate) {
  const post = candidate?.expensePost;
  if (!candidate?.expensePosted || !post || typeof post !== "object") return null;
  return {
    candidateId: id,
    eventId: String(post.eventId || candidate.eventId || ""),
    eventName: String(post.eventName || candidate.eventName || "").slice(0, 200),
    amount: number(post.amount),
    currency: String(post.currency || "").toUpperCase().slice(0, 3),
    category: String(post.category || "").slice(0, 30),
    description: String(post.description || candidate.subject || "").slice(0, 500),
    subject: String(candidate.subject || "").slice(0, 300),
    date: typeof candidate.date === "string" ? candidate.date : null,
    account: String(candidate.account || "").slice(0, 200),
    source: "gmail_reviewed_candidate"
  };
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
    transaction.update(candidateRef, {
      expensePosted: true,
      expensePostingState: "active",
      expensePost
    });
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

async function listEventExpenseEntries({ db, sessionId }) {
  const id = validSessionId(sessionId);
  const snapshot = await db.collection(COLLECTION).where("eventId", "==", id).get();
  const entries = snapshot.docs
    .map(item => publicEventExpenseEntry(item.id, item.data() || {}))
    .filter(Boolean)
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  return { sessionId: id, entries };
}

async function voidReviewedCandidate({
  db,
  candidateId,
  confirmation,
  expectedCurrentAmount,
  actorEmail,
  now = new Date()
}) {
  const id = validCandidateId(candidateId);
  if (confirmation !== VOID_CONFIRMATION) {
    throw new HttpsError("failed-precondition", "経費取消の確認操作が必要です。");
  }
  const candidateRef = db.collection(COLLECTION).doc(id);
  const auditRef = db.collection(AUDIT_COLLECTION).doc();
  return db.runTransaction(async transaction => {
    const candidateSnapshot = await transaction.get(candidateRef);
    if (!candidateSnapshot.exists) throw new HttpsError("not-found", "候補が見つかりません。");
    const candidate = candidateSnapshot.data() || {};
    if (candidate.expensePosted !== true) {
      if (candidate.expensePostingState === "voided") {
        return { id, duplicate: true, expensePosted: false, expensePostingState: "voided" };
      }
      throw new HttpsError("failed-precondition", "登録済みの経費ではありません。");
    }
    const post = candidate.expensePost;
    if (!post || typeof post !== "object") {
      throw new HttpsError("failed-precondition", "登録済み経費の情報が見つかりません。");
    }
    const sessionId = validSessionId(post.eventId || candidate.eventId);
    const category = String(post.category || "");
    const amount = number(post.amount);
    const currency = String(post.currency || "").toUpperCase();
    if (!EXPENSE_CATEGORIES.has(category) || !amount || !currency) {
      throw new HttpsError("failed-precondition", "登録済み経費の内容が正しくありません。");
    }
    const sessionRef = db.collection(SESSION_COLLECTION).doc(sessionId);
    const sessionSnapshot = await transaction.get(sessionRef);
    if (!sessionSnapshot.exists) throw new HttpsError("not-found", "対象イベントが見つかりません。");
    const session = sessionSnapshot.data() || {};
    const current = expenseEntry(session.expenses?.[category]);
    const expected = Number(expectedCurrentAmount);
    if (!Number.isFinite(expected) || Math.abs(expected - current.amount) > 0.000001) {
      throw new HttpsError("aborted", "経費金額が画面表示後に変更されました。画面を再読み込みしてください。");
    }
    if (current.currency !== currency || current.amount + 0.000001 < amount) {
      throw new HttpsError("failed-precondition", "現在の経費合計と取消対象が一致しません。手動で確認してください。");
    }
    const rate = currency === "JPY"
      ? 1
      : number(current.fxRateToJPY) || number(session.fxRateToJPY);
    if (!rate) throw new HttpsError("failed-precondition", "イベントの為替レートを確認してください。");
    const nextAmount = Math.max(0, current.amount - amount);
    const categoryEntry = {
      amount: nextAmount,
      currency,
      fxRateToJPY: rate,
      amountJPY: nextAmount * rate
    };
    const expenses = { ...(session.expenses || {}), [category]: categoryEntry };
    const expenseVoid = {
      eventId: sessionId,
      eventName: String(post.eventName || session.eventName || "名称未設定").slice(0, 200),
      amount,
      currency,
      category,
      description: String(post.description || candidate.subject || "").slice(0, 500),
      previousAmount: current.amount,
      nextAmount,
      voidedAt: now,
      voidedBy: actorEmail,
      source: "gmail_reviewed_candidate"
    };
    transaction.update(sessionRef, {
      [`expenses.${category}`]: categoryEntry,
      "expenseSummary.totalJPY": totalExpensesJPY(expenses),
      updatedAt: now
    });
    transaction.update(candidateRef, {
      expensePosted: false,
      expensePostingState: "voided",
      expensePost: null,
      lastExpenseVoid: expenseVoid
    });
    transaction.set(auditRef, {
      candidateId: id,
      action: "expense_voided",
      ...expenseVoid,
      createdAt: now
    });
    return {
      id,
      duplicate: false,
      expensePosted: false,
      expensePostingState: "voided",
      expenseVoid,
      categoryEntry,
      expenseTotalJPY: totalExpensesJPY(expenses)
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

function createEventExpenseEntryLister({ requireStaff, db, staffEmails }) {
  return onCall({
    region: "asia-southeast1",
    secrets: [staffEmails],
    timeoutSeconds: 60,
    maxInstances: 5
  }, async request => {
    requireStaff(request);
    return listEventExpenseEntries({ db, sessionId: request.data?.sessionId });
  });
}

function createExpenseVoider({ requireStaff, db, staffEmails }) {
  return onCall({
    region: "asia-southeast1",
    secrets: [staffEmails],
    timeoutSeconds: 60,
    maxInstances: 5
  }, async request => {
    const actorEmail = requireStaff(request);
    return voidReviewedCandidate({
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
  VOID_CONFIRMATION,
  EXPENSE_CATEGORIES,
  expenseEntry,
  totalExpensesJPY,
  publicEventExpenseEntry,
  postingPlan,
  postReviewedCandidate,
  listEventExpenseEntries,
  voidReviewedCandidate,
  createExpensePoster,
  createEventExpenseEntryLister,
  createExpenseVoider
};
