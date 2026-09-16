// Pure, read-only candidate processing. This module never writes salesSessions or expense totals.
// Gmail OAuth tokens and raw messages must be handled by a trusted backend, never GitHub Pages.
export const GMAIL_EXPENSE_ACCOUNTS = Object.freeze([
  "fjmthrs@gmail.com",
  "icelolly.zakka@gmail.com"
]);

const CURRENCIES = new Set(["JPY", "SGD", "TWD", "HKD", "THB", "USD"]);
const STATUSES = new Set(["unverified", "invoiced", "paid_evidence", "excluded"]);

function text(value, limit = 500) {
  return String(value ?? "").trim().slice(0, limit);
}

function money(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function validDate(value) {
  const date = text(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(`${date}T00:00:00Z`)) ? date : null;
}

/**
 * Normalize one server-produced candidate. Account, message and attachment IDs
 * are evidence references, NOT permission to read another account's messages.
 * Unknown amounts remain null, never zero. No FX conversion is inferred.
 */
export function normalizeGmailExpenseCandidate(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid expense candidate");
  const account = text(raw.account, 254).toLowerCase();
  if (!GMAIL_EXPENSE_ACCOUNTS.includes(account)) throw new Error("Unknown Gmail account");
  const messageId = text(raw.messageId, 160);
  if (!messageId || !/^[\w-]+$/.test(messageId)) throw new Error("Missing Gmail message ID");
  const attachmentId = text(raw.attachmentId, 200);
  const currency = text(raw.currency, 3).toUpperCase();
  if (currency && !CURRENCIES.has(currency)) throw new Error("Unsupported currency");
  const amount = money(raw.amount);
  if (raw.amount !== null && raw.amount !== undefined && raw.amount !== "" && amount === null) {
    throw new Error("Invalid amount");
  }
  const status = text(raw.status, 30);
  if (status && !STATUSES.has(status)) throw new Error("Invalid evidence status");
  return Object.freeze({
    id: `${account}:${messageId}:${attachmentId || "message"}`,
    account,
    messageId,
    attachmentId: attachmentId || null,
    date: validDate(raw.date),
    merchant: text(raw.merchant, 200),
    description: text(raw.description, 500),
    amount,
    currency: currency || null,
    invoiceNumber: text(raw.invoiceNumber, 120) || null,
    eventId: text(raw.eventId, 160) || null,
    eventMatch: raw.eventMatch === true ? "confirmed" : "unverified",
    status: status || "unverified",
    evidenceType: text(raw.evidenceType, 60) || "email",
    // No automatic expense posting: candidates are only review records.
    reviewRequired: true
  });
}

/** Keep every source; mark potential duplicates for human review rather than deleting evidence. */
export function groupGmailExpenseCandidates(items) {
  const byId = new Map();
  for (const raw of items || []) {
    const candidate = normalizeGmailExpenseCandidate(raw);
    byId.set(candidate.id, candidate);
  }
  const candidates = [...byId.values()];
  const groups = new Map();
  for (const item of candidates) {
    if (item.amount === null || !item.currency || !item.date || !item.merchant) continue;
    const invoice = item.invoiceNumber ? `invoice:${item.invoiceNumber.toLowerCase()}` :
      `payment:${item.date}:${item.merchant.toLowerCase().replace(/\s+/g, " ")}:${item.currency}:${item.amount}`;
    const key = `${item.currency}:${item.amount}:${invoice}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item.id);
  }
  const duplicateGroups = [...groups.values()].filter(group => group.length > 1);
  return { candidates, duplicateGroups, accountCoverage: Object.fromEntries(
    GMAIL_EXPENSE_ACCOUNTS.map(account => [account, candidates.filter(item => item.account === account).length])
  ) };
}
