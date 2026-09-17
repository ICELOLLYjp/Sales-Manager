"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  decodeBase64Url, htmlToText, inspectPayload, collectPdfAttachmentRefs,
  parsePdfData, findMoneyHints
} = require("../evidenceInspection");

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

test("PDF attachment references stay internal to extraction", () => {
  const payload = {
    parts: [
      { mimeType: "application/pdf", filename: "invoice.pdf", body: { attachmentId: "private-id", size: 2048 } },
      { mimeType: "image/png", filename: "preview.png", body: { attachmentId: "image-id", size: 512 } }
    ]
  };
  assert.deepEqual(collectPdfAttachmentRefs(payload), [{ attachmentId: "private-id", filename: "invoice.pdf", declaredSize: 2048 }]);
  assert.ok(!JSON.stringify(inspectPayload(payload)).includes("private-id"));
});

test("bounded PDF parsing returns temporary text and money hints", async () => {
  let destroyed = false;
  const fakeDocument = { numPages: 2, destroy: async () => { destroyed = true; } };
  const result = await parsePdfData(new Uint8Array([1, 2, 3]), "invoice.pdf", {
    getDocumentProxy: async () => fakeDocument,
    extractText: async () => ({ totalPages: 2, text: "出店料 8,000 TWD" })
  });
  assert.equal(result.status, "parsed");
  assert.equal(result.pages, 2);
  assert.match(result.excerpt, /8,000 TWD/);
  assert.deepEqual(result.moneyHints, ["8,000 TWD"]);
  assert.equal(destroyed, true);
});

test("PDFs over the page limit are not parsed", async () => {
  let extracted = false;
  const result = await parsePdfData(new Uint8Array([1]), "long.pdf", {
    getDocumentProxy: async () => ({ numPages: 21, destroy: async () => {} }),
    extractText: async () => { extracted = true; return { totalPages: 21, text: "ignored" }; }
  });
  assert.equal(result.status, "too_many_pages");
  assert.equal(result.pages, 21);
  assert.equal(extracted, false);
});

test("money hints are suggestions only", () => {
  assert.deepEqual(findMoneyHints("Payment received $100. Total SGD 120.00 and tax 8.40 SGD"), ["SGD 120.00", "8.40 SGD", "$100"]);
});
