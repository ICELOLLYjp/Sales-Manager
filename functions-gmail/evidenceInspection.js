"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { accountId, decryptRefreshToken } = require("./oauthCore");
const { COLLECTION } = require("./candidateStorage");
const { MAX_TEXT_MIME_BYTES, hydrateReferencedTextParts } = require("./textPartHydration");

const MAX_TEXT_BYTES = 200000;
const MAX_EXCERPT = 6000;
const MAX_ATTACHMENTS = 20;
const MAX_PDF_ATTACHMENTS = 3;
const MAX_PDF_BYTES = 5 * 1024 * 1024;
const MAX_PDF_PAGES = 20;
const MAX_PDF_EXCERPT = 12000;

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

async function fetchGoogleAttachment(url, options = {}) {
  let response;
  try {
    response = await fetch(url, { ...options, signal: AbortSignal.timeout(30000) });
  } catch {
    throw new HttpsError("unavailable", "GmailのPDF添付を取得できませんでした。");
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new HttpsError("failed-precondition", "Gmailの認可を確認できません。接続画面で状態を確認してください。");
    }
    throw new HttpsError("unavailable", "GmailのPDF添付を取得できませんでした。");
  }
  const contentLength = Number(response.headers.get("content-length"));
  const maxResponseBytes = Math.ceil(MAX_PDF_BYTES * 4 / 3) + 65536;
  if (Number.isFinite(contentLength) && contentLength > maxResponseBytes) return { tooLarge: true };
  const reader = response.body?.getReader();
  if (!reader) throw new HttpsError("unavailable", "GmailのPDF添付を読み取れませんでした。");
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxResponseBytes) {
      await reader.cancel();
      return { tooLarge: true };
    }
    chunks.push(value);
  }
  try {
    const raw = Buffer.concat(chunks.map(chunk => Buffer.from(chunk)), total).toString("utf8");
    return { json: JSON.parse(raw), tooLarge: false };
  } catch {
    throw new HttpsError("unavailable", "GmailのPDF添付を読み取れませんでした。");
  }
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

function decodeHtmlEntities(value) {
  const named = {
    nbsp: " ",
    amp: "&",
    lt: "<",
    gt: ">",
    quot: "\"",
    apos: "'"
  };
  return String(value || "").replace(
    /&(?:#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]+);/gi,
    entity => {
      const token = entity.slice(1, -1);
      if (token[0] !== "#") return named[token.toLowerCase()] ?? entity;
      const hex = token[1]?.toLowerCase() === "x";
      const codePoint = Number.parseInt(token.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (!Number.isInteger(codePoint) || codePoint < 1 || codePoint > 0x10FFFF ||
          (codePoint >= 0xD800 && codePoint <= 0xDFFF)) return entity;
      return codePoint === 0xA0 ? " " : String.fromCodePoint(codePoint);
    }
  );
}

function htmlToText(value) {
  const withoutMarkup = String(value || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeHtmlEntities(withoutMarkup)
    .replace(/[\u00A0 \t]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

function inspectPayload(payload) {
  const textParts = [];
  const attachments = [];
  let remaining = MAX_TEXT_BYTES;
  let remainingSource = MAX_TEXT_MIME_BYTES;

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
    if (typeof body.data === "string" && remaining > 0 && remainingSource > 0 &&
        (mimeType === "text/plain" || mimeType === "text/html")) {
      // Bound MIME input and extracted text separately. Agoda's roughly 220 KB
      // HTML confirmation becomes much smaller after markup and CSS are removed.
      const decoded = decodeBase64Url(body.data, remainingSource);
      if (decoded) {
        remainingSource -= Buffer.byteLength(decoded, "utf8");
        const clean = mimeType === "text/html" ? htmlToText(decoded) : decoded.trim();
        if (clean) {
          const bounded = Buffer.from(clean, "utf8").subarray(0, remaining).toString("utf8").trim();
          if (bounded) {
            textParts.push(bounded);
            remaining -= Buffer.byteLength(bounded, "utf8");
          }
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

function collectPdfAttachmentRefs(payload) {
  const refs = [];
  function visit(part) {
    if (!part || typeof part !== "object" || refs.length >= MAX_PDF_ATTACHMENTS) return;
    const mimeType = String(part.mimeType || "").toLowerCase();
    const filename = String(part.filename || "").trim().slice(0, 240);
    const body = part.body || {};
    const isPdf = mimeType === "application/pdf" || /\.pdf$/i.test(filename);
    if (isPdf && typeof body.attachmentId === "string" && body.attachmentId) {
      refs.push({
        attachmentId: body.attachmentId,
        filename: filename || "（ファイル名なし）",
        declaredSize: Number.isFinite(Number(body.size)) ? Number(body.size) : null
      });
    }
    for (const child of Array.isArray(part.parts) ? part.parts : []) visit(child);
  }
  visit(payload);
  return refs;
}

async function parsePdfData(data, filename, pdfTools) {
  // pdf.js rejects Node.js Buffer even though Buffer extends Uint8Array.
  // Copy into a plain Uint8Array before handing Gmail attachment bytes to unpdf.
  const bytes = data instanceof Uint8Array ? Uint8Array.from(data) : new Uint8Array(data || []);
  if (!bytes.length || bytes.byteLength > MAX_PDF_BYTES) {
    return { filename, status: "too_large", pages: null, excerpt: "", excerptTruncated: false, moneyHints: [] };
  }
  let document;
  try {
    const tools = pdfTools || await import("unpdf");
    document = await tools.getDocumentProxy(bytes);
    const pages = Number(document.numPages) || 0;
    if (pages > MAX_PDF_PAGES) {
      return { filename, status: "too_many_pages", pages, excerpt: "", excerptTruncated: false, moneyHints: [] };
    }
    const extracted = await tools.extractText(document, { mergePages: true });
    const text = String(extracted.text || "").replace(/\u0000/g, "").trim();
    const excerpt = text.slice(0, MAX_PDF_EXCERPT);
    return {
      filename,
      status: text ? "parsed" : "no_text",
      pages: Number(extracted.totalPages) || pages || null,
      excerpt,
      excerptTruncated: text.length > MAX_PDF_EXCERPT,
      moneyHints: findMoneyHints(excerpt)
    };
  } catch {
    return { filename, status: "failed", pages: null, excerpt: "", excerptTruncated: false, moneyHints: [] };
  } finally {
    try { await document?.destroy?.(); } catch { /* Temporary parser resources only. */ }
  }
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
    const pdfResults = [];
    for (const ref of collectPdfAttachmentRefs(message.payload)) {
      if (ref.declaredSize !== null && ref.declaredSize > MAX_PDF_BYTES) {
        pdfResults.push({ filename: ref.filename, status: "too_large", pages: null, excerpt: "", excerptTruncated: false, moneyHints: [] });
        continue;
      }
      const attachmentUrl = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(ref.attachmentId)}`);
      const attachment = await fetchGoogleAttachment(attachmentUrl, { headers: { Authorization: `Bearer ${token.access_token}` } });
      if (attachment.tooLarge) {
        pdfResults.push({ filename: ref.filename, status: "too_large", pages: null, excerpt: "", excerptTruncated: false, moneyHints: [] });
        continue;
      }
      const encoded = attachment.json?.data;
      const estimated = typeof encoded === "string" ? Math.floor(encoded.length * 0.75) : 0;
      if (!encoded || estimated > MAX_PDF_BYTES) {
        pdfResults.push({ filename: ref.filename, status: "too_large", pages: null, excerpt: "", excerptTruncated: false, moneyHints: [] });
        continue;
      }
      const bytes = Buffer.from(encoded.replace(/-/g, "+").replace(/_/g, "/"), "base64");
      pdfResults.push(await parsePdfData(bytes, ref.filename));
    }
    const moneyHints = [...findMoneyHints(evidence.excerpt)];
    for (const result of pdfResults) {
      for (const hint of result.moneyHints) if (!moneyHints.includes(hint) && moneyHints.length < 20) moneyHints.push(hint);
    }
    return {
      candidateId: id,
      account,
      messageId,
      excerpt: evidence.excerpt,
      excerptTruncated: evidence.excerptTruncated,
      attachments: evidence.attachments,
      moneyHints,
      eventCurrency,
      pdfCount: evidence.attachments.filter(item => item.isPdf).length,
      pdfResults,
      persisted: false,
      expensePosted: false,
      pdfParsed: pdfResults.some(item => item.status === "parsed" || item.status === "no_text")
    };
  });
}

module.exports = {
  MAX_TEXT_BYTES,
  MAX_EXCERPT,
  MAX_PDF_BYTES,
  MAX_PDF_PAGES,
  MAX_PDF_EXCERPT,
  decodeBase64Url,
  decodeHtmlEntities,
  htmlToText,
  inspectPayload,
  collectPdfAttachmentRefs,
  parsePdfData,
  findMoneyHints,
  createEvidenceInspection
};
