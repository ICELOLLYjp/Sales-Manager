"use strict";

const ExcelJS = require("exceljs");
const JSZip = require("jszip");

const MAX_XLSX_BYTES = 5 * 1024 * 1024;
const MAX_XLSX_ENTRIES = 200;
const MAX_UNCOMPRESSED_BYTES = 20 * 1024 * 1024;
const MAX_SHEETS = 5;
const MAX_ROWS = 200;
const MAX_COLUMNS = 24;
const MAX_EXCERPT = 12000;

function plainCell(value) {
  if (value == null) return "";
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if (Array.isArray(value.richText)) value = value.richText.map(part => part.text || "").join("");
    else if (Object.hasOwn(value, "result")) value = value.result;
    else if (typeof value.text === "string") value = value.text;
    else return "";
  }
  if (!["string", "number", "boolean"].includes(typeof value)) return "";
  return String(value).replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 300);
}

async function parseXlsxData(bytes, filename, findMoneyHints) {
  const empty = (status, extra = {}) => ({ filename, status, sheetCount: null, excerpt: "", excerptTruncated: false, moneyHints: [], ...extra });
  if (!bytes?.length || bytes.length > MAX_XLSX_BYTES) return empty("too_large");
  try {
    const zip = await JSZip.loadAsync(bytes);
    const entries = Object.values(zip.files).filter(entry => !entry.dir);
    if (entries.length > MAX_XLSX_ENTRIES) return empty("too_complex");
    let total = 0;
    for (const entry of entries) {
      const size = entry._data?.uncompressedSize;
      if (!Number.isSafeInteger(size) || size < 0) return empty("too_complex");
      total += size;
      if (total > MAX_UNCOMPRESSED_BYTES) return empty("too_complex");
    }
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(bytes), { ignoreNodes: ["dataValidations", "extLst"] });
    if (workbook.worksheets.length > MAX_SHEETS || workbook.worksheets.some(sheet => sheet.rowCount > MAX_ROWS || sheet.columnCount > MAX_COLUMNS)) {
      return empty("too_complex", { sheetCount: workbook.worksheets.length });
    }
    const lines = [];
    for (const sheet of workbook.worksheets) {
      lines.push(`シート: ${sheet.name.slice(0, 80)}`);
      sheet.eachRow((row, rowNumber) => {
        const cells = [];
        row.eachCell((cell, columnNumber) => {
          const value = plainCell(cell.value);
          if (value) cells.push(`${cell.address}: ${value}`);
        });
        if (cells.length) lines.push(cells.join(" ／ "));
      });
    }
    const content = lines.join("\n");
    const excerpt = content.slice(0, MAX_EXCERPT);
    return { filename, status: content ? "parsed" : "no_text", sheetCount: workbook.worksheets.length,
      excerpt, excerptTruncated: content.length > MAX_EXCERPT, moneyHints: findMoneyHints(excerpt) };
  } catch {
    return empty("failed");
  }
}

module.exports = { MAX_XLSX_BYTES, parseXlsxData, plainCell };
