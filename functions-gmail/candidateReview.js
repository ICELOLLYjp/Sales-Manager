"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { COLLECTION } = require("./candidateStorage");

const AUDIT_COLLECTION = "gmailExpenseCandidateAudit";
const REVIEW_STATUSES = new Set(["unreviewed", "kept", "excluded"]);
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
  return {
    id: snapshot.id,
    account: String(data.account || ""),
    messageId: String(data.messageId || ""),
    date: typeof data.date === "string" ? data.date : null,
    sender: String(data.sender || "").slice(0, 200),
    subject: String(data.subject || "").slice(0, 300),
    reviewStatus: REVIEW_STATUSES.has(data.reviewStatus) ? data.reviewStatus : "unreviewed",
    reviewRequired: data.reviewRequired !== false,
    amount: typeof data.amount === "number" ? data.amount : null,
    currency: typeof data.currency === "string" ? data.currency : null,
    paymentConfirmed: data.paymentConfirmed === true,
    expensePosted: data.expensePosted === true
  };
}

async function listCandidates(db, month) {
  const normalizedMonth = validMonth(month);
  const snapshot = await db.collection(COLLECTION)
    .where("lastScanMonth", "==", normalizedMonth)
    .limit(MAX_LIST)
    .get();
  const candidates = snapshot.docs.map(publicCandidate)
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || a.subject.localeCompare(b.subject));
  return {
    month: normalizedMonth,
    candidates,
    duplicateGroups: duplicateGroups(candidates),
    truncated: snapshot.size >= MAX_LIST,
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

module.exports = {
  AUDIT_COLLECTION,
  REVIEW_STATUSES,
  duplicateKey,
  duplicateGroups,
  publicCandidate,
  listCandidates,
  setReviewStatus,
  createCandidateList,
  createCandidateReview
};
