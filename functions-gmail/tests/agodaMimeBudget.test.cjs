"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { inspectPayload } = require("../evidenceInspection");
test("reads booking information following large HTML styling", () => {
  const html = "<style>" + "a".repeat(220000) + "</style><p>Booking confirmation SGD 180.00</p>";
  const payload = { mimeType: "multipart/mixed", parts: [
    { mimeType: "text/html", body: { data: Buffer.from(html).toString("base64url") } },
    { mimeType: "application/pdf", filename: "confirmation.pdf", body: { attachmentId: "pdf1" } },
    { mimeType: "application/pdf", filename: "special_checkin.pdf", body: { attachmentId: "pdf2" } }
  ] };
  const result = inspectPayload(payload);
  assert.match(result.excerpt, /Booking confirmation SGD 180/);
  assert.equal(result.attachments.length, 2);
});
