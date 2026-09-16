"use strict";

const crypto = require("node:crypto");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { assertAccount } = require("./oauthCore");

const COLLECTION = "gmailExpenseCandidates";
const MAX_CANDIDATES = 25;

function validMonth(month) {
  if (typeof month !== "string" || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new HttpsError("invalid-argument", "月はYYYY-MM形式で指定してください。");
  }
  const year = Number(month.slice(0, 4));
  if (year < 2025 || year > 2030) throw new HttpsError("invalid-argument", "対象期間が範囲外です。");
  return month;
}

function clean(value, limit) {
  return String(value ?? "").replace(/[\r\n\u0000-\u001f]/g, " ").trim().slice(0, limit);
}

function validId(value, required = true) {
  const id = clean(value, 200);
  if ((!id && required) || (id && !/^[A-Za-z0-9_-]+$/.test(id))) {
    throw new HttpsError("invalid-argument", "Gmailメッセージ情報が正しくありません。");
  }
  return id || null;
}

function candidateDocumentId(account, messageId) {
  const normalizedAccount = assertAccount(account);
  const normalizedMessageId = validId(messageId);
  return crypto.createHash("sha256").update(normalizedAccount).update("\0").update(normalizedMessageId).digest("hex");
}

function normalizePreviewCandidate(raw, expectedAccount, month) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new HttpsError("invalid-argument", "保存する候補が正しくありません。");
  }
  const account = assertAccount(raw.account);
  if (account !== expectedAccount) throw new HttpsError("invalid-argument", "Gmailアカウントが一致しません。");
  const messageId = validId(raw.messageId);
  const date = clean(raw.date, 10);
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new HttpsError("invalid-argument", "メール日付が正しくありません。");
  }
  return {
    id: candidateDocumentId(account, messageId),
    account,
    messageId,
    threadId: validId(raw.threadId, false),
    date: date || null,
    sender: clean(raw.sender, 200),
    subject: clean(raw.subject, 300),
    sourceType: "gmail_metadata",
    lastScanMonth: month
  };
}

function candidateWrite(candidate, existing, actorEmail, now) {
  const common = {
    account: candidate.account,
    messageId: candidate.messageId,
    threadId: candidate.threadId,
    date: candidate.date,
    sender: candidate.sender,
    subject: candidate.subject,
    sourceType: candidate.sourceType,
    lastScanMonth: candidate.lastScanMonth,
    lastSeenAt: now,
    lastSeenBy: actorEmail
  };
  if (existing) return common;
  return {
    ...common,
    createdAt: now,
    createdBy: actorEmail,
    reviewStatus: "unreviewed",
    reviewRequired: true,
    amount: null,
    currency: null,
    paymentConfirmed: false,
    expensePosted: false
  };
}

async function saveCandidateBatch({ db, account, month, messages, actorEmail, now = new Date() }) {
  const normalizedAccount = assertAccount(account);
  const normalizedMonth = validMonth(month);
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > MAX_CANDIDATES) {
    throw new HttpsError("invalid-argument", `保存できる候補は1〜${MAX_CANDIDATES}件です。`);
  }
  const unique = new Map();
  for (const raw of messages) {
    const candidate = normalizePreviewCandidate(raw, normalizedAccount, normalizedMonth);
    unique.set(candidate.id, candidate);
  }
  const candidates = [...unique.values()];
  const refs = candidates.map(item => db.collection(COLLECTION).doc(item.id));
  return db.runTransaction(async transaction => {
    const snapshots = await Promise.all(refs.map(ref => transaction.get(ref)));
    let created = 0;
    let existing = 0;
    snapshots.forEach((snapshot, index) => {
      const candidate = candidates[index];
      if (snapshot.exists) existing++;
      else created++;
      transaction.set(refs[index], candidateWrite(candidate, snapshot.exists, actorEmail, now), { merge: true });
    });
    return { saved: candidates.length, created, existing };
  });
}

function createExpenseCandidateSaver({ requireStaff, db, staffEmails }) {
  return onCall({
    region: "asia-southeast1",
    secrets: [staffEmails],
    timeoutSeconds: 60,
    maxInstances: 5
  }, async request => {
    const actorEmail = requireStaff(request);
    let account;
    try { account = assertAccount(request.data?.account); }
    catch { throw new HttpsError("invalid-argument", "接続済みのGmailを選択してください。"); }
    const result = await saveCandidateBatch({
      db,
      account,
      month: request.data?.month,
      messages: request.data?.messages,
      actorEmail
    });
    return {
      account,
      month: request.data.month,
      ...result,
      collection: COLLECTION,
      expensePosted: false
    };
  });
}

module.exports = {
  COLLECTION,
  MAX_CANDIDATES,
  candidateDocumentId,
  normalizePreviewCandidate,
  candidateWrite,
  saveCandidateBatch,
  createExpenseCandidateSaver
};
