"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { accountId, decryptRefreshToken } = require("./oauthCore");
const { COLLECTION } = require("./candidateStorage");

const MAX_TEXT_BYTES = 200000;
const MAX_EXCERPT = 6000;
const MAX_ATTACHMENTS = 20;

function validCandidateId(value) {
  const id = String(value || "").trim();
  if (!/^[a-f0-9]{64}$/.test(id)) throw new HttpsError("invalid-argument", "候補IDが正しくありません。");
  return id;
}

async function fetchGoogleJson(url, options = {}) {
  let response;
  try {
    response = await fetch(url, { ...options, signal: AbortSignal.timeout(20000) });
  } catch {
    throw new HttpsError("unavailable", "Googleへの接続に失敗しました。時間を置いて再試行してください。");
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new HttpsError("failed-precondition", "Gmailの認可を確認できません。接続画面で状態を確認してください。");
    }
    throw new HttpsError("unavailable", "Gmailから本文情報を取得できませんでした。");
  }
  try { return await response.json(); }
  catch { throw new HttpsError("unavailable", "Googleの応答を読み取れませんでした。"); }
}

function decodeBase64Url(value, limit = MAX_TEXT_BYTES) {
  if (typeof value !== "string" || !value) return "";
  const estimated = Math.floor(value.length * 0.75);
  if (estimated > limit) return "";
  try {
    return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8").slice(0, limit);
  } catch {
    return "";
  }
}

function htmlToText(value) {
  return String(value || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

function inspectPayload(payload) {
  const textParts = [];
  const attachments = [];
  let remaining = MAX_TEXT_BYTES;

  function visit(part) {
    if (!part || typeof part !== "object") return;
    const mimeType = String(part.mimeType || "").toLowerCase();
    const filename = String(part.filename || "").trim().slice(0, 240);
    const body = part.body || {};
    if (body.attachmentId && attachments.length < MAX_ATTACHMENTS) {
      attachments.push({
        filename: filename || "（ファイル名なし）",
        mimeType: mimeType || "application/octet-stream",
        size: Number.isFinite(Number(body.size)) ? Number(body.size) : null,
        isPdf: mimeType === "application/pdf" || /\.pdf$/i.test(filename)
      });
    }
    if (body.data && remaining > 0 && (mimeType === "text/plain" || mimeType === "text/html")) {
      const decoded = decodeBase64Url(body.data, remaining);
      if (decoded) {
        const clean = mimeType === "text/html" ? htmlToText(decoded) : decoded.trim();
        if (clean) {
          textParts.push(clean);
          remaining -= Buffer.byteLength(clean, "utf8");
        }
      }
    }
    for (const child of Array.isArray(part.parts) ? part.parts : []) visit(child);
  }

  visit(payload);
  const text = textParts.join("\n\n").replace(/\u0000/g, "").trim();
  return {
    excerpt: text.slice(0, MAX_EXCERPT),
    excerptTruncated: text.length > MAX_EXCERPT || remaining <= 0,
    attachments
  };
}

function findMoneyHints(text) {
  const source = String(text || "").slice(0, MAX_TEXT_BYTES);
  const patterns = [
    /(?:SGD|S\$|JPY|¥|TWD|NT\$|HKD|HK\$|USD|US\$|THB|฿)\s*[\d,]+(?:\.\d{1,2})?/gi,
    /[\d,]+(?:\.\d{1,2})?\s*(?:SGD|JPY|TWD|HKD|USD|THB)\b/gi,
    /(?<![A-Za-z])\$\s*[\d,]+(?:\.\d{1,2})?/g
  ];
  const found = [];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const value = match[0].replace(/\s+/g, " ").trim();
      if (!found.includes(value)) found.push(value);
      if (found.length >= 20) return found;
    }
  }
  return found;
}

function createEvidenceInspection({ requireStaff, db, clientId, clientSecret, tokenKey, staffEmails }) {
  return onCall({
    region: "asia-southeast1",
    secrets: [clientId, clientSecret, tokenKey, staffEmails],
    timeoutSeconds: 120,
    memory: "512MiB",
    maxInstances: 5
  }, async request => {
    requireStaff(request);
    const id = validCandidateId(request.data?.candidateId);
    const candidateSnapshot = await db.collection(COLLECTION).doc(id).get();
    if (!candidateSnapshot.exists) throw new HttpsError("not-found", "候補が見つかりません。");
    const candidate = candidateSnapshot.data() || {};
    if (candidate.reviewStatus !== "kept") {
      throw new HttpsError("failed-precondition", "先に「候補に残す」を選択してください。");
    }
    const account = String(candidate.account || "");
    const messageId = String(candidate.messageId || "");
    let eventCurrency = null;
    if (candidate.expenseScope === "event" && typeof candidate.eventId === "string" && candidate.eventId) {
      const session = await db.collection("salesSessions").doc(candidate.eventId).get();
      const currency = String(session.data()?.currency || "").toUpperCase();
      if (["JPY", "SGD", "TWD", "HKD", "THB", "USD"].includes(currency)) eventCurrency = currency;
    }
    if (!/^[A-Za-z0-9_-]+$/.test(messageId)) {
      throw new HttpsError("failed-precondition", "Gmailメッセージ情報を確認できません。");
    }
    const connection = await db.collection("gmailOAuthConnections").doc(accountId(account)).get();
    if (!connection.exists || !connection.data()?.encryptedRefreshToken) {
      throw new HttpsError("failed-precondition", "対象のGmailが未接続です。");
    }
    let refreshToken;
    try { refreshToken = decryptRefreshToken(connection.data().encryptedRefreshToken, tokenKey.value()); }
    catch { throw new HttpsError("failed-precondition", "Gmailの接続情報を読み取れません。"); }
    const token = await fetchGoogleJson("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId.value(),
        client_secret: clientSecret.value(),
        refresh_token: refreshToken,
        grant_type: "refresh_token"
      })
    });
    if (typeof token.access_token !== "string" || !token.access_token) {
      throw new HttpsError("failed-precondition", "Gmailのアクセストークンを取得できませんでした。");
    }
    const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}`);
    url.searchParams.set("format", "full");
    const message = await fetchGoogleJson(url, { headers: { Authorization: `Bearer ${token.access_token}` } });
    const evidence = inspectPayload(message.payload);
    return {
      candidateId: id,
      account,
      messageId,
      excerpt: evidence.excerpt,
      excerptTruncated: evidence.excerptTruncated,
      attachments: evidence.attachments,
      moneyHints: findMoneyHints(evidence.excerpt),
      eventCurrency,
      pdfCount: evidence.attachments.filter(item => item.isPdf).length,
      persisted: false,
      expensePosted: false,
      pdfParsed: false
    };
  });
}

module.exports = {
  MAX_TEXT_BYTES,
  MAX_EXCERPT,
  decodeBase64Url,
  htmlToText,
  inspectPayload,
  findMoneyHints,
  createEvidenceInspection
};
