"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { assertAccount, accountId, decryptRefreshToken } = require("./oauthCore");
const { inspectPayload } = require("./evidenceInspection");

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
    url.searchParams.set("fields", "id,payload(mimeType,body,parts,filename)");
    const message = await readJson(url, { headers: { Authorization: `Bearer ${token.access_token}` } });
    if (message.id !== messageId) throw new HttpsError("unavailable", "メールの識別情報が一致しません。");
    const evidence = inspectPayload(message.payload);
    return {
      account, messageId, excerpt: evidence.excerpt, excerptTruncated: evidence.excerptTruncated,
      attachments: evidence.attachments.map(({ filename, isPdf }) => ({ filename, isPdf })),
      persisted: false, expensePosted: false
    };
  });
}

module.exports = { createUnsavedBodyPreview, validatePreviewRequest };
