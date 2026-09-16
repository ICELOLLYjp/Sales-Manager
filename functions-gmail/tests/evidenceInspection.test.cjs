"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { decodeBase64Url, htmlToText, inspectPayload, findMoneyHints } = require("../evidenceInspection");

function encoded(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}

test("base64url Gmail text is decoded", () => {
  assert.equal(decodeBase64Url(encoded("Receipt SGD 25.00")), "Receipt SGD 25.00");
});

test("HTML is reduced to readable text without script content", () => {
  const text = htmlToText("<style>private</style><p>Total: S$ 18.50</p><script>secret</script>");
  assert.match(text, /Total: S\$ 18.50/);
  assert.ok(!text.includes("private"));
  assert.ok(!text.includes("secret"));
});

test("payload inspection lists attachments but does not include attachment bytes", () => {
  const result = inspectPayload({
    mimeType: "multipart/mixed",
    parts: [
      { mimeType: "text/plain", body: { data: encoded("Invoice total SGD 120") } },
      { mimeType: "application/pdf", filename: "invoice.pdf", body: { attachmentId: "opaque123", size: 2048 } }
    ]
  });
  assert.match(result.excerpt, /SGD 120/);
  assert.deepEqual(result.attachments, [{ filename: "invoice.pdf", mimeType: "application/pdf", size: 2048, isPdf: true }]);
  assert.ok(!JSON.stringify(result).includes("opaque123"));
});

test("money hints are suggestions only", () => {
  assert.deepEqual(findMoneyHints("Payment received $100. Total SGD 120.00 and tax 8.40 SGD"), ["SGD 120.00", "8.40 SGD", "$100"]);
});
