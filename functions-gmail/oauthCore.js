"use strict";

const crypto = require("node:crypto");

const ACCOUNTS = Object.freeze([
  "fjmthrs@gmail.com",
  "icelolly.zakka@gmail.com"
]);
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const CALLBACK_URL = "https://asia-southeast1-t-shirtstock.cloudfunctions.net/gmailOAuthCallback";
const APP_URL = "https://icelollyjp.github.io/Sales-Manager/";

function assertAccount(account) {
  const email = String(account || "").trim().toLowerCase();
  if (!ACCOUNTS.includes(email)) throw new Error("Unsupported Gmail account");
  return email;
}

function stateId(state) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(String(state || ""))) throw new Error("Invalid OAuth state");
  return crypto.createHash("sha256").update(state).digest("hex");
}

function accountId(account) {
  return crypto.createHash("sha256").update(assertAccount(account)).digest("hex");
}

function authorizationUrl({ clientId, account, state }) {
  if (!clientId || !/^[A-Za-z0-9_-]{43}$/.test(state)) throw new Error("Missing OAuth configuration");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: CALLBACK_URL,
    response_type: "code",
    scope: GMAIL_SCOPE,
    access_type: "offline",
    prompt: "consent",
    login_hint: assertAccount(account),
    state
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

function keyBytes(base64) {
  const key = Buffer.from(String(base64 || ""), "base64");
  if (key.length !== 32) throw new Error("Gmail token encryption key must be 32 random bytes (base64)");
  return key;
}

function encryptRefreshToken(token, keyBase64) {
  if (!token || typeof token !== "string") throw new Error("Missing refresh token");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyBytes(keyBase64), iv);
  const data = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return { version: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") };
}

function decryptRefreshToken(encrypted, keyBase64) {
  if (!encrypted || encrypted.version !== 1) throw new Error("Unsupported token format");
  const decipher = crypto.createDecipheriv("aes-256-gcm", keyBytes(keyBase64), Buffer.from(encrypted.iv, "base64"));
  decipher.setAuthTag(Buffer.from(encrypted.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted.data, "base64")), decipher.final()]).toString("utf8");
}

module.exports = {
  ACCOUNTS, GMAIL_SCOPE, CALLBACK_URL, APP_URL,
  assertAccount, stateId, accountId, authorizationUrl,
  encryptRefreshToken, decryptRefreshToken
};
