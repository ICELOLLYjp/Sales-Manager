"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const ExcelJS = require("exceljs");
const JSZip = require("jszip");
const { parseXlsxData, MAX_XLSX_BYTES } = require("../xlsxEvidence");
const { collectXlsxAttachmentRefs, findMoneyHints } = require("../evidenceInspection");

test("reads a bounded invoice workbook and only uses cached formula values", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Invoice");
  sheet.getCell("A1").value = "請求額";
  sheet.getCell("B1").value = "TWD 13,050";
  sheet.getCell("A2").value = { formula: "2+2", result: 4 };
  sheet.getCell("B2").value = { formula: "1+1" };
  const buffer = await workbook.xlsx.writeBuffer();
  const result = await parseXlsxData(buffer, "請求書.xlsx", findMoneyHints);
  assert.equal(result.status, "parsed");
  assert.equal(result.sheetCount, 1);
  assert.match(result.excerpt, /Invoice/);
  assert.match(result.excerpt, /TWD 13,050/);
  assert.match(result.excerpt, /A2: 4/);
  assert.doesNotMatch(result.excerpt, /1\+1/);
  assert.ok(result.moneyHints.includes("TWD 13,050"));
});

test("rejects oversized or expanded archives and malformed data", async () => {
  assert.equal((await parseXlsxData(Buffer.alloc(MAX_XLSX_BYTES + 1), "large.xlsx", findMoneyHints)).status, "too_large");
  const zip = new JSZip();
  zip.file("xl/huge.txt", "a".repeat(21 * 1024 * 1024));
  const bomb = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  assert.equal((await parseXlsxData(bomb, "bomb.xlsx", findMoneyHints)).status, "too_complex");
  assert.equal((await parseXlsxData(Buffer.from("bad"), "bad.xlsx", findMoneyHints)).status, "failed");
});

test("selects only xlsx Gmail attachments, including nested MIME parts", () => {
  const refs = collectXlsxAttachmentRefs({ parts: [{ filename: "invoice.xlsx", mimeType: "application/octet-stream", body: { attachmentId: "one", size: 12 } },
    { filename: "older.xls", body: { attachmentId: "two", size: 12 } },
    { parts: [{ filename: "sheet", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", body: { attachmentId: "three", size: 23 } }] }] });
  assert.deepEqual(refs.map(item => item.attachmentId), ["one", "three"]);
});
