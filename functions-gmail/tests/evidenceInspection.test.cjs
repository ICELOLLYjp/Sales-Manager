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

function simplePdf(text) {
  const escaped = text.replace(/([\\()])/g, "\\$1");
  const stream = `BT /F1 18 Tf 72 720 Td (${escaped}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf, "binary"));
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

test("installed PDF library extracts text without network access", async () => {
  const result = await parsePdfData(simplePdf("Invoice TWD 8000"), "generated.pdf");
  assert.equal(result.status, "parsed");
  assert.equal(result.pages, 1);
  assert.match(result.excerpt, /Invoice TWD 8000/);
  assert.deepEqual(result.moneyHints, ["TWD 8000"]);
});

test("money hints are suggestions only", () => {
  assert.deepEqual(findMoneyHints("Payment received $100. Total SGD 120.00 and tax 8.40 SGD"), ["SGD 120.00", "8.40 SGD", "$100"]);
});
