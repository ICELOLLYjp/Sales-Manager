"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { validatePreviewRequest } = require("../unsavedBodyPreview");

test("accepts supported account and opaque Gmail message ID", () => {
  assert.deepEqual(validatePreviewRequest({ account: "icelolly.zakka@gmail.com", messageId: "AbC_123-xy" }), {
    account: "icelolly.zakka@gmail.com", messageId: "AbC_123-xy"
  });
});

test("rejects unsupported account and malformed IDs", () => {
  assert.throws(() => validatePreviewRequest({ account: "someone@example.com", messageId: "abc" }));
  for (const messageId of ["", "abc/def", "a b", "a".repeat(257), null]) {
    assert.throws(() => validatePreviewRequest({ account: "icelolly.zakka@gmail.com", messageId }));
  }
});

const { extractPreviewEvidence } = require("../unsavedBodyPreview");
const encodeBody = text => Buffer.from(text, "utf8").toString("base64url");

test("large HTML confirmation is readable even beyond the regular 200 KB evidence budget", () => {
  const html = "<style>" + "a".repeat(250000) + "</style>" +
    "<table><tr><td>Agoda booking confirmation</td><td>JPY 18000</td></tr></table>";
  const result = extractPreviewEvidence({ mimeType: "text/html", body: { data: encodeBody(html) } });
  assert.match(result.excerpt, /Agoda booking confirmation/);
  assert.match(result.excerpt, /JPY 18000/);
  assert.equal(result.previewOnly, false);
  assert.ok(!result.excerpt.includes("aaaaa"));
});

test("prefer a full plain-text MIME alternative over duplicate HTML", () => {
  const plain = "Trip reservation number: " + "12345 ".repeat(25);
  const result = extractPreviewEvidence({
    mimeType: "multipart/alternative",
    parts: [
      { mimeType: "text/plain", body: { data: encodeBody(plain) } },
      { mimeType: "text/html", body: { data: encodeBody("<p>Duplicate HTML copy</p>") } }
    ]
  });
  assert.match(result.excerpt, /Trip reservation number/);
  assert.ok(!result.excerpt.includes("Duplicate HTML copy"));
});

test("fallback Gmail snippet is labeled as a summary, not a full message", () => {
  const result = extractPreviewEvidence({ mimeType: "multipart/alternative", parts: [] }, "Booking number ABC123\nJPY 12000");
  assert.equal(result.excerpt, "Booking number ABC123 JPY 12000");
  assert.equal(result.previewOnly, true);
});

test("preview never includes raw HTML or internal attachment IDs", () => {
  const result = extractPreviewEvidence({
    mimeType: "multipart/mixed", parts: [
      { mimeType: "text/html", body: { data: encodeBody("<script>alert(1)</script><p>Paid&nbsp;TWD 3900</p>") } },
      { mimeType: "application/pdf", filename: "receipt.pdf", body: { attachmentId: "secret-reference", size: 1024 } }
    ]
  });
  assert.equal(result.excerpt, "Paid TWD 3900");
  assert.equal(result.attachments[0].filename, "receipt.pdf");
  assert.ok(!JSON.stringify(result).includes("secret-reference"));
});
