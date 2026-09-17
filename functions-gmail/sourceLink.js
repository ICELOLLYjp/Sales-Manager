"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { COLLECTION } = require("./candidateStorage");
const { assertAccount, accountId, decryptRefreshToken } = require("./oauthCore");

function validCandidateId(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new HttpsError("invalid-argument", "経費明細のIDが正しくありません。");
  }
  return value;
}

function gmailSearchUrl(account, rawMessageId) {
  const email = assertAccount(account);
  const header = String(rawMessageId || "").trim();
  const id = header.startsWith("<") && header.endsWith(">")
    ? header.slice(1, -1)
    : header;
  if (id.length > 250 || !/^[^\s<>@]+@[^\s<>@]+$/.test(id)) {
    throw new HttpsError("failed-precondition", "元メールの識別情報が見つかりません。Gmailで件名を検索してください。");
  }
  const url = new URL("https://mail.google.com/mail/u/");
  url.searchParams.set("authuser", email);
  url.hash = `search/${encodeURIComponent(`rfc822msgid:<${id}>`)}`;
  return url.toString();
}

async function googleJson(url, options) {
  let response;
  try {
    response = await fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
  } catch {
    throw new HttpsError("unavailable", "Gmailに接続できませんでした。時間を置いて再試行してください。");
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new HttpsError("failed-precondition", "Gmail接続の状態を確認してください。");
    }
    throw new HttpsError("unavailable", "Gmailからメール情報を取得できませんでした。");
  }
  try { return await response.json(); }
  catch { throw new HttpsError("unavailable", "Gmailからの応答を読み取れませんでした。"); }
}

async function resolveExpenseSource({ db, candidateId, clientId, clientSecret, tokenKey, fetchJson = googleJson }) {
  const id = validCandidateId(candidateId);
  const snapshot = await db.collection(COLLECTION).doc(id).get();
  if (!snapshot.exists) throw new HttpsError("not-found", "経費明細が見つかりません。");
  const candidate = snapshot.data() || {};
  if (candidate.expensePosted !== true || !candidate.expensePost?.eventId ||
      candidate.expensePost.eventId !== candidate.eventId) {
    throw new HttpsError("failed-precondition", "登録済みのイベント経費ではありません。");
  }
  let account;
  try { account = assertAccount(candidate.account); }
  catch { throw new HttpsError("failed-precondition", "元メールのGmailアカウントを確認できません。"); }
  const messageId = String(candidate.messageId || "");
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(messageId)) {
    throw new HttpsError("failed-precondition", "元メールのIDが見つかりません。");
  }
  const connection = await db.collection("gmailOAuthConnections").doc(accountId(account)).get();
  if (!connection.exists || !connection.data()?.encryptedRefreshToken) {
    throw new HttpsError("failed-precondition", "元メールのGmailが未接続です。");
  }
  let refreshToken;
  try { refreshToken = decryptRefreshToken(connection.data().encryptedRefreshToken, tokenKey.value()); }
  catch { throw new HttpsError("failed-precondition", "Gmail接続の状態を確認してください。"); }
  const token = await fetchJson("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId.value(), client_secret: clientSecret.value(),
      refresh_token: refreshToken, grant_type: "refresh_token"
    })
  });
  if (typeof token.access_token !== "string" || !token.access_token) {
    throw new HttpsError("failed-precondition", "Gmailへの接続を確認してください。");
  }
  const apiUrl = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}`);
  apiUrl.searchParams.set("format", "metadata");
  apiUrl.searchParams.append("metadataHeaders", "Message-ID");
  apiUrl.searchParams.set("fields", "id,payload/headers");
  const message = await fetchJson(apiUrl, { headers: { Authorization: `Bearer ${token.access_token}` } });
  if (message.id !== messageId) {
    throw new HttpsError("failed-precondition", "元メールを確認できませんでした。");
  }
  const rfc822Id = (message.payload?.headers || [])
    .find(header => String(header.name || "").toLowerCase() === "message-id")?.value;
  return { account, url: gmailSearchUrl(account, rfc822Id), kind: "gmail_message_search" };
}

function createExpenseSourceLink({ requireStaff, db, clientId, clientSecret, tokenKey, staffEmails }) {
  return onCall({
    region: "asia-southeast1",
    secrets: [clientId, clientSecret, tokenKey, staffEmails],
    timeoutSeconds: 60,
    maxInstances: 5
  }, async request => {
    requireStaff(request);
    return resolveExpenseSource({
      db, candidateId: request.data?.candidateId,
      clientId, clientSecret, tokenKey
    });
  });
}

module.exports = { validCandidateId, gmailSearchUrl, resolveExpenseSource, createExpenseSourceLink };
