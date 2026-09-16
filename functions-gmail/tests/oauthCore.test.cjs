"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const {
  ACCOUNTS, GMAIL_SCOPE, CALLBACK_URL, assertAccount, stateId, accountId,
  authorizationUrl, encryptRefreshToken, decryptRefreshToken
} = require("../oauthCore");

const KEY = crypto.randomBytes(32).toString("base64");
const STATE = crypto.randomBytes(32).toString("base64url");

test("only the two explicit accounts can be connected", () => {
  assert.equal(assertAccount(" FJMTHRS@GMAIL.COM "), ACCOUNTS[0]);
  assert.throws(() => assertAccount("someone-else@gmail.com"));
  assert.notEqual(accountId(ACCOUNTS[0]), accountId(ACCOUNTS[1]));
});

test("OAuth request is readonly, offline, stateful and uses the exact callback", () => {
  const url = new URL(authorizationUrl({ clientId: "example.apps.googleusercontent.com", account: ACCOUNTS[1], state: STATE }));
  assert.equal(url.origin, "https://accounts.google.com");
  assert.equal(url.searchParams.get("scope"), GMAIL_SCOPE);
  assert.equal(url.searchParams.get("redirect_uri"), CALLBACK_URL);
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("prompt"), "consent");
  assert.equal(url.searchParams.get("login_hint"), ACCOUNTS[1]);
  assert.equal(url.searchParams.get("state"), STATE);
});

test("state IDs are hashed and invalid states fail closed", () => {
  assert.equal(stateId(STATE).length, 64);
  assert.notEqual(stateId(STATE), STATE);
  assert.throws(() => stateId("not-a-state"));
  assert.throws(() => authorizationUrl({ clientId: "x", account: ACCOUNTS[0], state: "bad" }));
});

test("refresh token encrypts, decrypts and uses a random IV", () => {
  const first = encryptRefreshToken("secret-refresh-token", KEY);
  const second = encryptRefreshToken("secret-refresh-token", KEY);
  assert.notEqual(first.data, "secret-refresh-token");
  assert.notDeepEqual(first, second);
  assert.equal(decryptRefreshToken(first, KEY), "secret-refresh-token");
  assert.throws(() => decryptRefreshToken(first, crypto.randomBytes(32).toString("base64")));
});

test("invalid key and missing token are rejected", () => {
  assert.throws(() => encryptRefreshToken("a", "incorrect-key"));
  assert.throws(() => encryptRefreshToken("", KEY));
});
