"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { inspectPayload } = require("../evidenceInspection");
const { hydrateReferencedTextParts } = require("../textPartHydration");
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

test("hydrates only external HTML, never PDF parts", async () => {
  const html = "<style>" + "a".repeat(220000) + "</style><p>Booking confirmation SGD 180.00</p>";
  const payload = { mimeType: "multipart/mixed", parts: [
    { mimeType: "text/html", body: { attachmentId: "htmlBody", size: Buffer.byteLength(html) } },
    { mimeType: "application/pdf", filename: "confirmation.pdf", body: { attachmentId: "pdf1", size: 216906 } },
    { mimeType: "application/pdf", filename: "special_checkin.pdf", body: { attachmentId: "pdf2", size: 81577 } }
  ] };
  const requested = [];
  await hydrateReferencedTextParts(payload, async id => {
    requested.push(id);
    return { data: Buffer.from(html).toString("base64url"), size: Buffer.byteLength(html) };
  });
  assert.deepEqual(requested, ["htmlBody"]);
  assert.match(inspectPayload(payload).excerpt, /Booking confirmation SGD 180/);
});
