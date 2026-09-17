"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { ACCOUNTS, assertAccount, accountId, decryptRefreshToken } = require("./oauthCore");

const MAX_MESSAGES = 25;
const SEARCH_TERMS = '{invoice receipt payment paid 領収書 請求書 支払い 決済 出店料 交通費 宿泊費 送料 明細}';

function normalizeKeyword(value) {
  if (value == null || value === "") return "";
  if (typeof value !== "string") {
    throw new HttpsError("invalid-argument", "絞り込みキーワードを確認してください。");
  }
  const keyword = value.replace(/\s+/g, " ").trim();
  if (!keyword) return "";
  if (keyword.length > 80 || /[\u0000-\u001f\u007f"{}()]/.test(keyword)) {
    throw new HttpsError("invalid-argument", "絞り込みキーワードは80文字以内の文字列で指定してください。");
  }
  return keyword;
}

function monthQuery(month, keyword = "") {
  if (typeof month !== "string" || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new HttpsError("invalid-argument", "月はYYYY-MM形式で指定してください。");
  }
  const [year, number] = month.split("-").map(Number);
  if (year < 2025 || year > 2030) throw new HttpsError("invalid-argument", "対象期間が範囲外です。");
  const nextYear = number === 12 ? year + 1 : year;
  const nextMonth = number === 12 ? 1 : number + 1;
  const start = `${year}/${String(number).padStart(2, "0")}/01`;
  const end = `${nextYear}/${String(nextMonth).padStart(2, "0")}/01`;
  const eventFilter = normalizeKeyword(keyword);
  return `after:${start} before:${end} ${SEARCH_TERMS}${eventFilter ? ` "${eventFilter}"` : ""}`;
}

function safeHeader(payload, name, limit) {
  const found = (payload?.headers || []).find(row => String(row.name || "").toLowerCase() === name);
  return String(found?.value || "").replace(/[\r\n\u0000-\u001f]/g, " ").trim().slice(0, limit);
}

function previewMessage(message, account) {
  if (!/^[A-Za-z0-9_-]+$/.test(String(message.id || ""))) return null;
  const stamp = Number(message.internalDate);
  return {
    account,
    messageId: message.id,
    threadId: /^[A-Za-z0-9_-]+$/.test(String(message.threadId || "")) ? message.threadId : null,
    date: Number.isFinite(stamp) && stamp > 0 && stamp < 1e15 ? new Date(stamp).toISOString().slice(0, 10) : null,
    sender: safeHeader(message.payload, "from", 200),
    subject: safeHeader(message.payload, "subject", 300),
    amount: null,
    currency: null,
    paymentConfirmed: false,
    reviewRequired: true
  };
}

async function fetchGoogleJson(url, options = {}) {
  let response;
  try {
    response = await fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
  } catch {
    throw new HttpsError("unavailable", "Googleへの接続に失敗しました。時間を置いて再試行してください。");
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new HttpsError("failed-precondition", "Gmailの認可を確認できません。接続画面で状態を確認してください。");
    }
    throw new HttpsError("unavailable", "Gmailからの取得に失敗しました。");
  }
  try { return await response.json(); }
  catch { throw new HttpsError("unavailable", "Googleの応答を読み取れませんでした。"); }
}

function createExpensePreview({ requireStaff, db, clientId, clientSecret, tokenKey, staffEmails }) {
  return onCall({
    region: "asia-southeast1",
    secrets: [clientId, clientSecret, tokenKey, staffEmails],
    timeoutSeconds: 120,
    maxInstances: 5
  }, async request => {
    requireStaff(request);
    let account;
    try { account = assertAccount(request.data?.account); }
    catch { throw new HttpsError("invalid-argument", "接続済みのGmailを選択してください。"); }
    const month = request.data?.month;
    const keyword = normalizeKeyword(request.data?.keyword);
    const query = monthQuery(month, keyword);
    const snapshot = await db.collection("gmailOAuthConnections").doc(accountId(account)).get();
    if (!snapshot.exists || !snapshot.data()?.encryptedRefreshToken) {
      throw new HttpsError("failed-precondition", "対象のGmailが未接続です。");
    }
    let refreshToken;
    try { refreshToken = decryptRefreshToken(snapshot.data().encryptedRefreshToken, tokenKey.value()); }
    catch { throw new HttpsError("failed-precondition", "Gmailの接続情報を読み取れません。管理者に確認してください。"); }
    const token = await fetchGoogleJson("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId.value(), client_secret: clientSecret.value(),
        refresh_token: refreshToken, grant_type: "refresh_token"
      })
    });
    if (typeof token.access_token !== "string" || !token.access_token) {
      throw new HttpsError("failed-precondition", "Gmailのアクセストークンを取得できませんでした。");
    }
    const headers = { Authorization: `Bearer ${token.access_token}` };
    const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    listUrl.searchParams.set("q", query);
    listUrl.searchParams.set("maxResults", String(MAX_MESSAGES));
    listUrl.searchParams.set("fields", "messages(id,threadId),nextPageToken,resultSizeEstimate");
    const list = await fetchGoogleJson(listUrl, { headers });
    const messages = [];
    let skipped = 0;
    for (const item of (Array.isArray(list.messages) ? list.messages : [])) {
      if (!/^[A-Za-z0-9_-]+$/.test(String(item.id || ""))) { skipped++; continue; }
      const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(item.id)}`);
      url.searchParams.set("format", "metadata");
      url.searchParams.append("metadataHeaders", "From");
      url.searchParams.append("metadataHeaders", "Subject");
      url.searchParams.set("fields", "id,threadId,internalDate,payload/headers");
      try {
        const metadata = await fetchGoogleJson(url, { headers });
        const candidate = previewMessage(metadata, account);
        if (candidate) messages.push(candidate);
        else skipped++;
      } catch (error) {
        if (error instanceof HttpsError && error.code === "failed-precondition") throw error;
        skipped++;
      }
    }
    return {
      account,
      month,
      keyword,
      messages,
      skipped,
      hasMore: Boolean(list.nextPageToken),
      maxResults: MAX_MESSAGES,
      persisted: false,
      expensePosted: false
    };
  });
}

module.exports = { createExpensePreview, monthQuery, normalizeKeyword, previewMessage, MAX_MESSAGES, ACCOUNTS };
