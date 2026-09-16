"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { COLLECTION } = require("./candidateStorage");

const AUDIT_COLLECTION = "gmailExpenseCandidateAudit";
const SESSION_COLLECTION = "salesSessions";
const REVIEW_STATUSES = new Set(["unreviewed", "kept", "excluded"]);
const EXPENSE_SCOPES = new Set(["unassigned", "general", "event"]);
const MAX_LIST = 100;

function validMonth(month) {
  if (typeof month !== "string" || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new HttpsError("invalid-argument", "月はYYYY-MM形式で指定してください。");
  }
  const year = Number(month.slice(0, 4));
  if (year < 2025 || year > 2030) throw new HttpsError("invalid-argument", "対象期間が範囲外です。");
  return month;
}

function validCandidateId(value) {
  const id = String(value || "").trim();
  if (!/^[a-f0-9]{64}$/.test(id)) {
    throw new HttpsError("invalid-argument", "候補IDが正しくありません。");
  }
  return id;
}

function validSessionId(value) {
  const id = String(value || "").trim();
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(id)) {
    throw new HttpsError("invalid-argument", "イベントIDが正しくありません。");
  }
  return id;
}

function normalizedSender(value) {
  const sender = String(value || "").trim().toLowerCase();
  const bracket = sender.match(/<([^<>]+)>/);
  return (bracket ? bracket[1] : sender).replace(/\s+/g, " ");
}

function normalizedSubject(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function duplicateKey(item) {
  if (!item.date || !item.sender || !item.subject) return null;
  return [item.date, normalizedSender(item.sender), normalizedSubject(item.subject)].join("\0");
}

function duplicateGroups(items) {
  const groups = new Map();
  for (const item of items) {
    const key = duplicateKey(item);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item.id);
  }
  return [...groups.values()].filter(group => group.length > 1);
}

function publicCandidate(snapshot) {
  const data = snapshot.data() || {};
  const expenseScope = EXPENSE_SCOPES.has(data.expenseScope)
    ? data.expenseScope
    : data.eventId ? "event" : "unassigned";
  return {
    id: snapshot.id,
    account: String(data.account || ""),
    messageId: String(data.messageId || ""),
    date: typeof data.date === "string" ? data.date : null,
    sender: String(data.sender || "").slice(0, 200),
    subject: String(data.subject || "").slice(0, 300),
    reviewStatus: REVIEW_STATUSES.has(data.reviewStatus) ? data.reviewStatus : "unreviewed",
    reviewRequired: data.reviewRequired !== false,
    expenseScope,
    eventId: expenseScope === "event" ? String(data.eventId || "") : null,
    eventName: expenseScope === "event" ? String(data.eventName || "").slice(0, 200) : null,
    amount: typeof data.amount === "number" ? data.amount : null,
    currency: typeof data.currency === "string" ? data.currency : null,
    paymentConfirmed: data.paymentConfirmed === true,
    expensePosted: data.expensePosted === true
  };
}

function publicSession(snapshot) {
  const data = snapshot.data() || {};
  return {
    id: snapshot.id,
    eventName: String(data.eventName || "名称未設定").slice(0, 200),
    country: String(data.country || "").slice(0, 100),
    city: String(data.city || "").slice(0, 100),
    startDate: String(data.startDate || "").slice(0, 10),
    endDate: String(data.endDate || "").slice(0, 10),
    status: String(data.status || "open").slice(0, 40)
  };
}

async function listCandidates(db, month) {
  const normalizedMonth = validMonth(month);
  const [candidateSnapshot, sessionSnapshot] = await Promise.all([
    db.collection(COLLECTION).where("lastScanMonth", "==", normalizedMonth).limit(MAX_LIST).get(),
    db.collection(SESSION_COLLECTION).limit(200).get()
  ]);
  const candidates = candidateSnapshot.docs.map(publicCandidate)
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || a.subject.localeCompare(b.subject));
  const sessions = sessionSnapshot.docs.map(publicSession)
    .sort((a, b) => b.startDate.localeCompare(a.startDate) || a.eventName.localeCompare(b.eventName, "ja"));
  return {
    month: normalizedMonth,
    candidates,
    sessions,
    duplicateGroups: duplicateGroups(candidates),
    truncated: candidateSnapshot.size >= MAX_LIST,
    maxResults: MAX_LIST
  };
}

async function setReviewStatus({ db, candidateId, status, actorEmail, now = new Date() }) {
  const id = validCandidateId(candidateId);
  if (!REVIEW_STATUSES.has(status)) {
    throw new HttpsError("invalid-argument", "確認状態が正しくありません。");
  }
  const ref = db.collection(COLLECTION).doc(id);
  const auditRef = db.collection(AUDIT_COLLECTION).doc();
  return db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new HttpsError("not-found", "候補が見つかりません。");
    const previous = REVIEW_STATUSES.has(snapshot.data()?.reviewStatus)
      ? snapshot.data().reviewStatus
      : "unreviewed";
    if (previous === status) return { id, previous, status, changed: false };
    transaction.update(ref, {
      reviewStatus: status,
      reviewRequired: status === "unreviewed",
      reviewedAt: status === "unreviewed" ? null : now,
      reviewedBy: status === "unreviewed" ? null : actorEmail
    });
    transaction.set(auditRef, {
      candidateId: id,
      action: "review_status_changed",
      previous,
      status,
      actorEmail,
      createdAt: now
    });
    return { id, previous, status, changed: true };
  });
}

async function setExpenseScope({ db, candidateId, expenseScope, eventId, actorEmail, now = new Date() }) {
  const id = validCandidateId(candidateId);
  if (!EXPENSE_SCOPES.has(expenseScope)) {
    throw new HttpsError("invalid-argument", "イベント分類が正しくありません。");
  }
  const candidateRef = db.collection(COLLECTION).doc(id);
  const sessionRef = expenseScope === "event"
    ? db.collection(SESSION_COLLECTION).doc(validSessionId(eventId))
    : null;
  const auditRef = db.collection(AUDIT_COLLECTION).doc();
  return db.runTransaction(async transaction => {
    const candidateSnapshot = await transaction.get(candidateRef);
    if (!candidateSnapshot.exists) throw new HttpsError("not-found", "候補が見つかりません。");
    const sessionSnapshot = sessionRef ? await transaction.get(sessionRef) : null;
    if (sessionRef && !sessionSnapshot.exists) throw new HttpsError("not-found", "対象イベントが見つかりません。");
    const previousScope = EXPENSE_SCOPES.has(candidateSnapshot.data()?.expenseScope)
      ? candidateSnapshot.data().expenseScope
      : candidateSnapshot.data()?.eventId ? "event" : "unassigned";
    const previousEventId = candidateSnapshot.data()?.eventId || null;
    const nextEventId = sessionSnapshot ? sessionSnapshot.id : null;
    const nextEventName = sessionSnapshot ? String(sessionSnapshot.data()?.eventName || "名称未設定").slice(0, 200) : null;
    if (previousScope === expenseScope && previousEventId === nextEventId) {
      return { id, expenseScope, eventId: nextEventId, eventName: nextEventName, changed: false };
    }
    transaction.update(candidateRef, {
      expenseScope,
      eventId: nextEventId,
      eventName: nextEventName,
      eventAssignedAt: now,
      eventAssignedBy: actorEmail
    });
    transaction.set(auditRef, {
      candidateId: id,
      action: "expense_scope_changed",
      previousScope,
      previousEventId,
      expenseScope,
      eventId: nextEventId,
      eventName: nextEventName,
      actorEmail,
      createdAt: now
    });
    return { id, expenseScope, eventId: nextEventId, eventName: nextEventName, changed: true };
  });
}

function createCandidateList({ requireStaff, db, staffEmails }) {
  return onCall({
    region: "asia-southeast1",
    secrets: [staffEmails],
    timeoutSeconds: 60,
    maxInstances: 5
  }, async request => {
    requireStaff(request);
    const result = await listCandidates(db, request.data?.month);
    return { ...result, expensePostingAvailable: false };
  });
}

function createCandidateReview({ requireStaff, db, staffEmails }) {
  return onCall({
    region: "asia-southeast1",
    secrets: [staffEmails],
    timeoutSeconds: 60,
    maxInstances: 5
  }, async request => {
    const actorEmail = requireStaff(request);
    const result = await setReviewStatus({
      db,
      candidateId: request.data?.candidateId,
      status: request.data?.status,
      actorEmail
    });
    return { ...result, expensePosted: false };
  });
}

function createCandidateEventAssignment({ requireStaff, db, staffEmails }) {
  return onCall({
    region: "asia-southeast1",
    secrets: [staffEmails],
    timeoutSeconds: 60,
    maxInstances: 5
  }, async request => {
    const actorEmail = requireStaff(request);
    const result = await setExpenseScope({
      db,
      candidateId: request.data?.candidateId,
      expenseScope: request.data?.expenseScope,
      eventId: request.data?.eventId,
      actorEmail
    });
    return { ...result, expensePosted: false };
  });
}

module.exports = {
  AUDIT_COLLECTION,
  REVIEW_STATUSES,
  EXPENSE_SCOPES,
  duplicateKey,
  duplicateGroups,
  publicCandidate,
  publicSession,
  listCandidates,
  setReviewStatus,
  setExpenseScope,
  createCandidateList,
  createCandidateReview,
  createCandidateEventAssignment
};
