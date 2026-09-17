"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { gmailSearchUrl, resolveExpenseSource, validCandidateId } = require("../sourceLink");
const { accountId, encryptRefreshToken } = require("../oauthCore");

const id = "a".repeat(64);
const email = "icelolly.zakka@gmail.com";
const key = Buffer.alloc(32, 3).toString("base64");

function makeDb(candidate) {
  const connection = { encryptedRefreshToken: encryptRefreshToken("refresh-token", key) };
  return {
    collection(name) {
      return {
        doc(docId) {
          if (name === "gmailExpenseCandidates") assert.equal(docId, id);
          else {
            assert.equal(name, "gmailOAuthConnections");
            assert.equal(docId, accountId(email));
          }
          const data = name === "gmailExpenseCandidates" ? candidate : connection;
          return { async get() { return { exists: Boolean(data), data: () => data }; } };
        }
      };
    }
  };
}

const secrets = {
  clientId: { value: () => "client-id" },
  clientSecret: { value: () => "client-secret" },
  tokenKey: { value: () => key }
};

function posted(overrides = {}) {
  return {
    account: email, messageId: "18a123abc", eventId: "mori2026",
    expensePosted: true, expensePost: { eventId: "mori2026" }, ...overrides
  };
}

test("search URL targets the saved Gmail account and exact RFC822 Message-ID", () => {
  const url = new URL(gmailSearchUrl(email, "<order.123@example.org>"));
  assert.equal(url.origin, "https://mail.google.com");
  assert.equal(url.searchParams.get("authuser"), email);
  assert.equal(decodeURIComponent(url.hash), "#search/rfc822msgid:<order.123@example.org>");
  assert.throws(() => gmailSearchUrl("outside@example.com", "<x@y.com>"));
  assert.throws(() => gmailSearchUrl(email, "https://evil.example/"));
});

test("invalid candidate IDs are rejected before reading records", () => {
  for (const value of ["", "not-a-hash", "b".repeat(63), { fake: id }]) {
    assert.throws(() => validCandidateId(value));
  }
});

test("only a posted expense resolves a message URL without writing data", async () => {
  const calls = [];
  const response = await resolveExpenseSource({
    db: makeDb(posted()), candidateId: id, ...secrets,
    fetchJson: async (url, options) => {
      calls.push({ url: String(url), options });
      if (String(url).includes("oauth2.googleapis.com")) {
        assert.equal(options.body.get("refresh_token"), "refresh-token");
        return { access_token: "access-token" };
      }
      assert.equal(options.headers.Authorization, "Bearer access-token");
      assert.equal(new URL(String(url)).searchParams.get("format"), "metadata");
      return { id: "18a123abc", payload: { headers: [{ name: "Message-ID", value: "<order@example.org>" }] } };
    }
  });
  assert.equal(response.account, email);
  assert.match(response.url, /mail\.google\.com/);
  assert.equal(calls.length, 2);
  await assert.rejects(() => resolveExpenseSource({
    db: makeDb(posted({ expensePosted: false })), candidateId: id, ...secrets,
    fetchJson: () => { throw new Error("should not call Gmail"); }
  }), /登録済み/);
  await assert.rejects(() => resolveExpenseSource({
    db: makeDb(posted({ eventId: "other" })), candidateId: id, ...secrets,
    fetchJson: () => { throw new Error("should not call Gmail"); }
  }), /登録済み/);
});

test("metadata with an unmatched Gmail ID or missing Message-ID is rejected", async () => {
  const fetchJson = async url => String(url).includes("oauth2.googleapis.com")
    ? { access_token: "access-token" }
    : { id: "different", payload: { headers: [{ name: "Message-ID", value: "<x@y.com>" }] } };
  await assert.rejects(() => resolveExpenseSource({ db: makeDb(posted()), candidateId: id, ...secrets, fetchJson }), /元メールを確認/);
  const noHeader = async url => String(url).includes("oauth2.googleapis.com")
    ? { access_token: "access-token" }
    : { id: "18a123abc", payload: { headers: [] } };
  await assert.rejects(() => resolveExpenseSource({ db: makeDb(posted()), candidateId: id, ...secrets, fetchJson: noHeader }), /識別情報/);
});
