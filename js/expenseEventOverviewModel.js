export function summarizeEventExpenseEntries(payload, expectedSessionId) {
  if (!payload || payload.sessionId !== expectedSessionId || !Array.isArray(payload.entries)) {
    throw new Error("イベント経費の応答を確認できませんでした。");
  }
  const totals = new Map();
  const entries = [];
  const ids = new Set();
  for (const entry of payload.entries) {
    if (!entry || entry.eventId !== expectedSessionId || typeof entry.candidateId !== "string" || ids.has(entry.candidateId)) {
      throw new Error("イベント経費の明細に不整合があります。");
    }
    ids.add(entry.candidateId);
    const amount = Number(entry.amount);
    const currency = String(entry.currency || "").toUpperCase();
    if (!Number.isFinite(amount) || amount <= 0 || !/^[A-Z]{3}$/.test(currency)) {
      throw new Error("イベント経費の金額または通貨を確認できませんでした。");
    }
    totals.set(currency, (totals.get(currency) || 0) + amount);
    entries.push(entry);
  }
  return { count: entries.length, totals: [...totals].map(([currency, amount]) => ({ currency, amount })), entries };
}
