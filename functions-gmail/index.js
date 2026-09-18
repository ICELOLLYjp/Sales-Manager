"use strict";

const crypto = require("node:crypto");
const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const {
  ACCOUNTS, GMAIL_SCOPE, CALLBACK_URL, APP_URL, assertAccount,
  stateId, accountId, authorizationUrl, encryptRefreshToken, decryptRefreshToken
} = require("./oauthCore");

initializeApp();
const db = getFirestore();
const REGION = "asia-southeast1";
const CLIENT_ID = defineSecret("GMAIL_OAUTH_CLIENT_ID");
const CLIENT_SECRET = defineSecret("GMAIL_OAUTH_CLIENT_SECRET");
const TOKEN_KEY = defineSecret("GMAIL_TOKEN_ENCRYPTION_KEY");
const STAFF_EMAILS = defineSecret("GMAIL_STAFF_EMAILS");
const STATES = "gmailOAuthStates";
const CONNECTIONS = "gmailOAuthConnections";
const origin = new URL(APP_URL).origin;

function requireStaff(request) {
  const email = String(request.auth?.token?.email || "").toLowerCase();
  const allowed = String(STAFF_EMAILS.value() || "").split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
  if (!request.auth || request.auth.token.email_verified !== true || !allowed.includes(email)) {
    throw new HttpsError("permission-denied", "Staff authentication required");
  }
  return email;
}

function endPage(res, result) {
  res.set("Cache-Control", "no-store");
  res.set("Referrer-Policy", "no-referrer");
  const url = new URL(APP_URL);
  url.searchParams.set("gmail_connection", result);
  res.redirect(303, url.toString());
}

async function googleJson(url, options) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Google OAuth/API request failed (${response.status})`);
  return response.json();
}

exports.gmailOAuthStart = onCall({ region: REGION, secrets: [CLIENT_ID, STAFF_EMAILS], maxInstances: 5 }, async request => {
  const staffEmail = requireStaff(request);
  let account;
  try { account = assertAccount(request.data?.account); }
  catch { throw new HttpsError("invalid-argument", "Choose a supported Gmail account"); }
  const state = crypto.randomBytes(32).toString("base64url");
  const now = Date.now();
  await db.collection(STATES).doc(stateId(state)).create({
    account, staffEmail, createdAt: new Date(now), expiresAt: new Date(now + 10 * 60 * 1000)
  });
  return { url: authorizationUrl({ clientId: CLIENT_ID.value(), account, state }), account };
});

exports.gmailOAuthCallback = onRequest({
  region: REGION, secrets: [CLIENT_ID, CLIENT_SECRET, TOKEN_KEY],
  maxInstances: 5, timeoutSeconds: 60, invoker: "public"
}, async (req, res) => {
  res.set("Access-Control-Allow-Origin", origin);
  res.set("X-Content-Type-Options", "nosniff");
  if (req.method !== "GET") { res.status(405).send("Method not allowed"); return; }
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const code = typeof req.query.code === "string" ? req.query.code : "";
  let id;
  try { id = stateId(state); }
  catch { endPage(res, "invalid_state"); return; }
  if (!code || req.query.error) { endPage(res, "cancelled"); return; }
  try {
    // Consume state before exchanging the code: one callback can never link two accounts.
    const ref = db.collection(STATES).doc(stateId(state));
    const pending = await db.runTransaction(async tx => {
      const snapshot = await tx.get(ref);
      if (!snapshot.exists || snapshot.data().expiresAt.toMillis() <= Date.now()) return null;
      tx.delete(ref);
      return snapshot.data();
    });
    if (!pending) { endPage(res, "expired_state"); return; }
    const params = new URLSearchParams({
      code, client_id: CLIENT_ID.value(), client_secret: CLIENT_SECRET.value(),
      redirect_uri: CALLBACK_URL, grant_type: "authorization_code"
    });
    const token = await googleJson("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: params
    });
    if (!token.access_token || (token.scope && !token.scope.split(/\s+/).includes(GMAIL_SCOPE))) {
      throw new Error("Missing Gmail readonly grant");
    }
    const profile = await googleJson("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
      headers: { Authorization: `Bearer ${token.access_token}` }
    });
    const connectedAccount = assertAccount(profile.emailAddress);
    if (connectedAccount !== pending.account) { endPage(res, "wrong_account"); return; }
    const connectionRef = db.collection(CONNECTIONS).doc(accountId(connectedAccount));
    const previous = await connectionRef.get();
    const encrypted = token.refresh_token
      ? encryptRefreshToken(token.refresh_token, TOKEN_KEY.value())
      : previous.data()?.encryptedRefreshToken;
    if (!encrypted) throw new Error("No offline refresh token was granted");
    // Never store access tokens, raw email bodies or an unencrypted refresh token.
    await connectionRef.set({
      email: connectedAccount, encryptedRefreshToken: encrypted,
      scope: GMAIL_SCOPE, connectedAt: new Date(), connectedBy: pending.staffEmail
    });
    endPage(res, "connected");
  } catch (error) {
    // Do not log codes, OAuth tokens, full Google error bodies or email contents.
    console.error("Gmail OAuth callback failed", error instanceof Error ? error.message : "unknown");
    endPage(res, "failed");
  }
});

exports.gmailOAuthStatus = onCall({ region: REGION, secrets: [STAFF_EMAILS], maxInstances: 5 }, async request => {
  requireStaff(request);
  const rows = await Promise.all(ACCOUNTS.map(async account => {
    const snapshot = await db.collection(CONNECTIONS).doc(accountId(account)).get();
    return {
      account, connected: snapshot.exists && Boolean(snapshot.data()?.encryptedRefreshToken),
      connectedAt: snapshot.data()?.connectedAt?.toDate?.()?.toISOString() || null
    };
  }));
  return { accounts: rows, syncAvailable: false };
});

exports.gmailOAuthDisconnect = onCall({
  region: REGION, secrets: [STAFF_EMAILS, TOKEN_KEY], maxInstances: 5
}, async request => {
  requireStaff(request);
  let account;
  try { account = assertAccount(request.data?.account); }
  catch { throw new HttpsError("invalid-argument", "Choose a supported Gmail account"); }
  const ref = db.collection(CONNECTIONS).doc(accountId(account));
  const snapshot = await ref.get();
  if (!snapshot.exists) return { account, disconnected: true, revokeSucceeded: true };
  let revokeSucceeded = false;
  try {
    const refreshToken = decryptRefreshToken(snapshot.data().encryptedRefreshToken, TOKEN_KEY.value());
    const result = await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: refreshToken }), signal: AbortSignal.timeout(15000)
    });
    revokeSucceeded = result.ok;
  } catch { /* Local disconnect is still mandatory even if Google is unreachable. */ }
  await ref.delete();
  return { account, disconnected: true, revokeSucceeded };
});

exports.gmailExpensePreview = require("./expensePreview").createExpensePreview({
  requireStaff, db, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET,
  tokenKey: TOKEN_KEY, staffEmails: STAFF_EMAILS
});

exports.gmailExpensePreviewBody = require("./unsavedBodyPreview").createUnsavedBodyPreview({
  requireStaff, db, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET,
  tokenKey: TOKEN_KEY, staffEmails: STAFF_EMAILS
});

exports.gmailExpenseSaveCandidates = require("./candidateStorage").createExpenseCandidateSaver({
  requireStaff, db, staffEmails: STAFF_EMAILS
});

exports.gmailExpenseCandidateList = require("./candidateReview").createCandidateList({
  requireStaff, db, staffEmails: STAFF_EMAILS
});

exports.gmailExpenseCandidateReview = require("./candidateReview").createCandidateReview({
  requireStaff, db, staffEmails: STAFF_EMAILS
});

exports.gmailExpenseCandidateAssignEvent = require("./candidateReview").createCandidateEventAssignment({
  requireStaff, db, staffEmails: STAFF_EMAILS
});

exports.gmailExpenseInspectEvidence = require("./evidenceInspection").createEvidenceInspection({
  requireStaff, db, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET,
  tokenKey: TOKEN_KEY, staffEmails: STAFF_EMAILS
});

exports.gmailExpenseSaveEvidenceReview = require("./evidenceReview").createEvidenceReviewSaver({
  requireStaff, db, staffEmails: STAFF_EMAILS
});

exports.gmailExpensePostReviewedCandidate = require("./expensePosting").createExpensePoster({
  requireStaff, db, staffEmails: STAFF_EMAILS
});

exports.gmailExpenseListEventEntries = require("./expensePosting").createEventExpenseEntryLister({
  requireStaff, db, staffEmails: STAFF_EMAILS
});

exports.gmailExpenseVoidReviewedCandidate = require("./expensePosting").createExpenseVoider({
  requireStaff, db, staffEmails: STAFF_EMAILS
});

exports.gmailExpenseSourceUrl = require("./sourceLink").createExpenseSourceLink({
  requireStaff, db, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET,
  tokenKey: TOKEN_KEY, staffEmails: STAFF_EMAILS
});
