"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { assertAccount, accountId, decryptRefreshToken } = require("./oauthCore");
const { inspectPayload, decodeBase64Url, htmlToText } = require("./evidenceInspection");

const MESSAGE_ID = /^[A-Za-z0-9_-]{1,256}$/;

function validatePreviewRequest(data) {
  let account;
  try { account = assertAccount(data?.account); }
  catch { throw new HttpsError("invalid-argument", "接続済みのGmailを選択してください。"); }
  if (typeof data?.messageId !== "string" || !MESSAGE_ID.test(data.messageId)) {
    throw new HttpsError("invalid-argument", "メールIDを確認してください。");
  }
  return { account, messageId: data.messageId };
}

// Preview-only extraction: large HTML newsletters can exceed the smaller accounting
// evidence reader's per-message budget. Never return HTML or store fetched bodies.
const MAX_PREVIEW_MIME_BYTES = 2 * 1024 * 1024;
const MAX_PREVIEW_EXCERPT = 6000;

function extractPreviewEvidence(payload, fallbackSnippet = "") {
  const { attachments } = inspectPayload(payload);
  const parts = { plain: [], html: [] };
  const remaining = { plain: MAX_PREVIEW_MIME_BYTES, html: MAX_PREVIEW_MIME_BYTES };
  let truncated = false;
  let visited = 0;

  function visit(part, depth = 0) {
    if (!part || typeof part !== "object" || depth > 12 || ++visited > 100) return;
    const mimeType = String(part.mimeType || "").split(";")[0].toLowerCase();
    const type = mimeType === "text/plain" ? "plain" : mimeType === "text/html" ? "html" : null;
    const encoded = part.body?.data;
    if (type && typeof encoded === "string" && remaining[type] >= 3) {
      // Only decode a bounded base64 prefix; do not discard the whole HTML email
      // just because the complete message is larger than the preview limit.
      const maxEncoded = Math.floor(remaining[type] / 3) * 4;
      const prefix = encoded.slice(0, maxEncoded);
      truncated ||= prefix.length < encoded.length;
      const raw = decodeBase64Url(prefix, remaining[type]);
      remaining[type] -= Buffer.byteLength(raw, "utf8");
      const clean = type === "plain" ? raw.replace(/\u0000/g, "").trim() :
        htmlToText(raw
          .replace(/<\/\s*(?:div|tr|li|h[1-6]|table|section|article|header|footer)\s*>/gi, "\n")
          .replace(/<\/\s*(?:td|th)\s*>/gi, " | "));
      if (clean) parts[type].push(clean);
    }
    for (const child of Array.isArray(part.parts) ? part.parts : []) visit(child, depth + 1);
  }
  visit(payload);
  const plain = parts.plain.join("\n\n").trim();
  const html = parts.html.join("\n\n").trim();
  // HTML-only receipts have the full content; some short plain-text alternatives
  // contain only "view online", so prefer informative HTML in that case.
  const text = plain && (plain.length > 120 || !html) ? plain : html || plain;
  const snippet = String(fallbackSnippet || "").replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, 500);
  return {
    excerpt: (text || snippet).slice(0, MAX_PREVIEW_EXCERPT),
    excerptTruncated: Boolean(text) && (text.length > MAX_PREVIEW_EXCERPT || truncated),
    previewOnly: !text && Boolean(snippet),
    attachments
  };
}

// Gmail sometimes stores a large text/html or text/plain MIME body as an
// attachmentId instead of embedding body.data. Retrieve only these body parts;
// never fetch PDFs, images, or other attachments as part of this preview.
const MAX_REFERENCED_TEXT_PARTS = 3;

async function hydrateReferencedTextParts(payload, fetchTextPart) {
  let visited = 0;
  let requested = 0;
  async function visit(part, depth = 0) {
    if (!part || typeof part !== "object" || depth > 12 || ++visited > 100) return;
    const mimeType = String(part.mimeType || "").split(";")[0].toLowerCase();
    const isBodyText = mimeType === "text/plain" || mimeType === "text/html";
    const body = part.body;
    const attachmentId = body?.attachmentId;
    const declaredSize = Number(body?.size);
    if (isBodyText && !part.filename && body && typeof body.data !== "string" &&
        typeof attachmentId === "string" && attachmentId.length > 0 &&
        attachmentId.length <= 4096 &&
        (!Number.isFinite(declaredSize) || declaredSize <= MAX_PREVIEW_MIME_BYTES) &&
        requested < MAX_REFERENCED_TEXT_PARTS) {
      requested++;
      try {
        const attachment = await fetchTextPart(attachmentId);
        const encoded = attachment?.data;
        const reportedSize = Number(attachment?.size);
        if (typeof encoded === "string" &&
            (!Number.isFinite(reportedSize) || reportedSize <= MAX_PREVIEW_MIME_BYTES) &&
            Math.floor(encoded.length * 0.75) <= MAX_PREVIEW_MIME_BYTES) {
          body.data = encoded;
        }
      } catch {
        // Leave the part unavailable and use the message snippet if needed.
        // Do not log the attachment ID or any email contents.
      }
    }
    for (const child of Array.isArray(part.parts) ? part.parts : []) {
      await visit(child, depth + 1);
    }
  }
  await visit(payload);
}

async function readJson(url, options) {
  let response;
  try { response = await fetch(url, { ...options, signal: AbortSignal.timeout(20000) }); }
  catch { throw new HttpsError("unavailable", "Gmailに接続できませんでした。"); }
  if (response.status === 401 || response.status === 403) {
    throw new HttpsError("failed-precondition", "Gmailの接続状態を確認してください。");
  }
  if (!response.ok) throw new HttpsError("unavailable", "メール本文を取得できませんでした。");
  try { return await response.json(); }
  catch { throw new HttpsError("unavailable", "Gmailの応答を読み取れませんでした。"); }
}

function createUnsavedBodyPreview({ requireStaff, db, clientId, clientSecret, tokenKey, staffEmails }) {
  return onCall({
    region: "asia-southeast1", secrets: [clientId, clientSecret, tokenKey, staffEmails],
    timeoutSeconds: 60, maxInstances: 5
  }, async request => {
    requireStaff(request);
    const { account, messageId } = validatePreviewRequest(request.data);
    const connection = await db.collection("gmailOAuthConnections").doc(accountId(account)).get();
    if (!connection.exists || !connection.data()?.encryptedRefreshToken) {
      throw new HttpsError("failed-precondition", "Gmailが未接続です。");
    }
    let refreshToken;
    try { refreshToken = decryptRefreshToken(connection.data().encryptedRefreshToken, tokenKey.value()); }
    catch { throw new HttpsError("failed-precondition", "Gmailの接続情報を読み取れません。"); }
    const token = await readJson("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId.value(), client_secret: clientSecret.value(), refresh_token: refreshToken, grant_type: "refresh_token" })
    });
    if (typeof token.access_token !== "string" || !token.access_token) {
      throw new HttpsError("failed-precondition", "Gmailの認証を確認してください。");
    }
    const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}`);
    url.searchParams.set("format", "full");
    url.searchParams.set("fields", "id,snippet,payload");
    const message = await readJson(url, { headers: { Authorization: `Bearer ${token.access_token}` } });
    if (message.id !== messageId) throw new HttpsError("unavailable", "メールの識別情報が一致しません。");
    await hydrateReferencedTextParts(message.payload, attachmentId => {
      const attachmentUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages/" +
        encodeURIComponent(messageId) + "/attachments/" + encodeURIComponent(attachmentId));
      attachmentUrl.searchParams.set("fields", "data,size");
      return readJson(attachmentUrl, { headers: { Authorization: "Bearer " + token.access_token } });
    });
    const evidence = extractPreviewEvidence(message.payload, message.snippet);
    return {
      account, messageId, excerpt: evidence.excerpt, excerptTruncated: evidence.excerptTruncated,
      previewOnly: evidence.previewOnly,
      attachments: evidence.attachments.map(({ filename, isPdf }) => ({ filename, isPdf })),
      persisted: false, expensePosted: false
    };
  });
}

module.exports = { createUnsavedBodyPreview, validatePreviewRequest, extractPreviewEvidence, hydrateReferencedTextParts };
