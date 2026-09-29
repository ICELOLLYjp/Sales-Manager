"use strict";

const ExcelJS = require("exceljs");
const JSZip = require("jszip");

const MAX_XLSX_BYTES = 5 * 1024 * 1024;
const MAX_XLSX_ENTRIES = 200;
const MAX_UNCOMPRESSED_BYTES = 20 * 1024 * 1024;
const MAX_SHEETS = 20;
const MAX_ROWS = 200;
const MAX_COLUMNS = 24;
const MAX_EXCERPT = 12000;
const MAX_TABLE_ROWS = 240;
const MAX_TABLE_CELL_CHARS = 120;

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
  const empty = (status, extra = {}) => ({ filename, status, sheetCount: null, excerpt: "", excerptTruncated: false, moneyHints: [], sheetPreviews: [], ...extra });
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
    if (workbook.worksheets.length > MAX_SHEETS || workbook.worksheets.some(sheet => sheet.actualRowCount > MAX_ROWS || sheet.actualColumnCount > MAX_COLUMNS)) {
      return empty("too_complex", { sheetCount: workbook.worksheets.length });
    }
    const sections = [];
    const sheetPreviews = [];
    const sectionLimit = Math.floor(MAX_EXCERPT / Math.max(1, workbook.worksheets.length)) - 1;
    const rowsPerSheet = Math.max(1, Math.floor(MAX_TABLE_ROWS / Math.max(1, workbook.worksheets.length)));
    let excerptTruncated = false;
    for (const sheet of workbook.worksheets) {
      const lines = [`シート: ${sheet.name.slice(0, 80)}`];
      const populatedRows = [];
      sheet.eachRow((row, rowNumber) => {
        const cells = [];
        const tableCells = [];
        row.eachCell((cell, columnNumber) => {
          const value = plainCell(cell.value);
          if (value) {
            cells.push(`${cell.address}: ${value}`);
            tableCells.push({ column: columnNumber, text: value.slice(0, MAX_TABLE_CELL_CHARS) });
          }
        });
        if (cells.length) {
          lines.push(cells.join(" ／ "));
          populatedRows.push({ rowNumber, cells: tableCells });
        }
      });
      const content = lines.join("\n");
      if (content.length > sectionLimit) excerptTruncated = true;
      sections.push(content.slice(0, sectionLimit));
      const firstCount = Math.min(populatedRows.length, Math.ceil(rowsPerSheet * 2 / 3));
      const lastCount = Math.min(populatedRows.length - firstCount, rowsPerSheet - firstCount);
      const rows = populatedRows.slice(0, firstCount).concat(lastCount ? populatedRows.slice(-lastCount) : []);
      sheetPreviews.push({ name: sheet.name.slice(0, 80), rows, rowsOmitted: populatedRows.length - rows.length });
    }
    const excerpt = sections.join("\n");
    return { filename, status: workbook.worksheets.length ? "parsed" : "no_text", sheetCount: workbook.worksheets.length,
      excerpt, excerptTruncated, moneyHints: findMoneyHints(excerpt), sheetPreviews };
  } catch {
    return empty("failed");
  }
}

module.exports = { MAX_XLSX_BYTES, parseXlsxData, plainCell };
