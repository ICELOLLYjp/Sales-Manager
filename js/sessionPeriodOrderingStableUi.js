import { listSalesSessions } from "./services/sessionService.js";

function text(value) {
  return String(value ?? "").trim();
}

const VISIBLE_SESSION_STATUSES = new Set([
  "open",
  "pending_allocation",
  "closed"
]);

function localDateKey() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function eventPhase(session) {
  const status = text(session?.status);
  if (status === "closed") return "ended";

  const today = localDateKey();
  const start = text(session?.startDate);
  const end = text(session?.endDate) || start;

  if (start && today < start) return "upcoming";
  if (end && today > end) return "ended";
  return "current";
}

function phaseLabel(phase) {
  if (phase === "current") return "開催中";
  if (phase === "upcoming") return "開催予定";
  return "開催終了";
}

function installStyles() {
  if (document.getElementById("sessionPeriodOrderingStableStyles")) return;

  const style = document.createElement("style");
  style.id = "sessionPeriodOrderingStableStyles";
  style.textContent = `
    #sessionPeriodBoard{display:grid;gap:12px;margin-top:12px}
    #sessionPeriodBoard .session-period-group{margin:0}
    #sessionPeriodBoard .session-period-title{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:4px;font-size:16px;font-weight:900}
    #sessionPeriodBoard .session-period-count{font-size:12px;color:#777}
    #sessionPeriodBoard .session-period-empty{padding:12px 0;color:#888;font-size:12px}
    #sessionPeriodBoard [data-session-period="current"]{border-color:#cfe8d5;background:#fbfefb}
    #sessionPeriodBoard [data-session-period="current"] .session-period-title{color:#25703c}
    .session-status-line:has(.session-status-badge.live){padding:6px 8px;border-radius:12px;background:#f0faf3}
    .session-status-line:has(.session-status-badge.live) .session-status-note{color:#25703c;font-weight:800}
    .session-status-badge.scheduled{background:#eef4ff;color:#3d5f91}
  `;
  document.head.appendChild(style);
}

function findSessionRow(element) {
  let node = element?.parentElement || null;
  while (node && node.id !== "view") {
    if (node.style?.borderBottom && node.querySelector?.("[data-session-id]")) return node;
    if (node.classList?.contains("card")) return null;
    node = node.parentElement;
  }
  return null;
}

function sessionRowsById() {
  const rows = new Map();
  document.querySelectorAll("[data-session-id]").forEach(element => {
    const sessionId = text(element.dataset?.sessionId);
    if (!sessionId || rows.has(sessionId)) return;
    const row = findSessionRow(element);
    if (row) rows.set(sessionId, row);
  });
  return rows;
}

function compareRows(a, b, phase) {
  const aStart = text(a.session?.startDate);
  const bStart = text(b.session?.startDate);
  const aEnd = text(a.session?.endDate) || aStart;
  const bEnd = text(b.session?.endDate) || bStart;

  if (phase === "upcoming") {
    return aStart.localeCompare(bStart) || text(a.session?.eventName).localeCompare(text(b.session?.eventName), "ja");
  }

  if (phase === "ended") {
    return bEnd.localeCompare(aEnd) || bStart.localeCompare(aStart) || text(a.session?.eventName).localeCompare(text(b.session?.eventName), "ja");
  }

  const aLifecycle = text(a.session?.status) === "open" ? 0 : 1;
  const bLifecycle = text(b.session?.status) === "open" ? 0 : 1;
  return aLifecycle - bLifecycle || bStart.localeCompare(aStart) || text(a.session?.eventName).localeCompare(text(b.session?.eventName), "ja");
}

function ensureBoard(anchor) {
  let board = document.getElementById("sessionPeriodBoard");
  if (board) return board;

  board = document.createElement("div");
  board.id = "sessionPeriodBoard";
  anchor.parentElement?.insertBefore(board, anchor);
  return board;
}

function ensureGroup(board, phase, count) {
  let section = board.querySelector(`[data-session-period="${phase}"]`);
  if (!section) {
    section = document.createElement("section");
    section.className = "card session-period-group";
    section.dataset.sessionPeriod = phase;
    section.innerHTML = `<div class="session-period-title"><span>${phaseLabel(phase)}</span><span class="session-period-count"></span></div><div class="session-period-body"></div>`;
    board.appendChild(section);
  }

  const countNode = section.querySelector(".session-period-count");
  const nextCount = `${count}件`;
  if (countNode && text(countNode.textContent) !== nextCount) countNode.textContent = nextCount;

  return section.querySelector(".session-period-body");
}

function syncBody(body, rows) {
  if (!body) return;

  if (!rows.length) {
    const current = Array.from(body.children);
    if (
      current.length === 1 &&
      current[0].classList.contains("session-period-empty") &&
      text(current[0].textContent) === "該当するイベントはありません"
    ) {
      return;
    }

    const empty = document.createElement("div");
    empty.className = "session-period-empty";
    empty.textContent = "該当するイベントはありません";
    body.replaceChildren(empty);
    return;
  }

  const current = Array.from(body.children);
  const alreadyOrdered =
    current.length === rows.length &&
    rows.every((row, index) => current[index] === row);

  if (alreadyOrdered) return;
  body.replaceChildren(...rows);
}

function rebuildBoard(sessions) {
  if (text(document.querySelector("h1.page-title")?.textContent) !== "Sessions") return;

  const rows = sessionRowsById();
  if (!rows.size) return;

  const rawById = new Map(sessions.map(session => [text(session.sessionId), session]));
  const entries = [];
  const sourceCards = new Set();

  rows.forEach((row, sessionId) => {
    const sourceCard = row.closest(".card");
    if (sourceCard && !sourceCard.classList.contains("session-period-group")) {
      sourceCards.add(sourceCard);
    }

    const session = rawById.get(sessionId);
    if (!session || !VISIBLE_SESSION_STATUSES.has(text(session.status))) {
      row.remove();
      return;
    }

    entries.push({ row, sessionId, session, phase: eventPhase(session) });
  });

  if (!entries.length) {
    document.getElementById("sessionPeriodBoard")?.remove();
    return;
  }

  const firstSourceCard = Array.from(sourceCards)[0];
  const existingBoard = document.getElementById("sessionPeriodBoard");
  const anchor = existingBoard || firstSourceCard || entries[0].row.closest(".card") || entries[0].row;
  const board = existingBoard || ensureBoard(anchor);

  sourceCards.forEach(card => {
    if (card.style.display !== "none") card.style.display = "none";
    card.dataset.sessionPeriodSource = "1";
  });

  const order = ["current", "upcoming", "ended"];
  order.forEach(phase => {
    const group = entries
      .filter(entry => entry.phase === phase)
      .sort((a, b) => compareRows(a, b, phase));
    const body = ensureGroup(board, phase, group.length);
    syncBody(body, group.map(entry => entry.row));
  });
}

let loading = false;
let scheduled = false;
let refreshRequested = true;
let cachedSessions = null;
let cachedAt = 0;

function clearCache() {
  cachedSessions = null;
  cachedAt = 0;
  refreshRequested = true;
}

async function loadSessions() {
  const now = Date.now();
  if (!refreshRequested && cachedSessions && now - cachedAt < 15000) return cachedSessions;

  const sessions = await listSalesSessions();
  cachedSessions = sessions;
  cachedAt = now;
  refreshRequested = false;
  return sessions;
}

async function render() {
  if (loading) return;
  if (text(document.querySelector("h1.page-title")?.textContent) !== "Sessions") return;

  loading = true;
  try {
    installStyles();
    const sessions = await loadSessions();
    if (text(document.querySelector("h1.page-title")?.textContent) !== "Sessions") return;
    rebuildBoard(sessions || []);
  } catch (error) {
    console.warn("イベント期間別の並び替えを更新できませんでした。", error);
  } finally {
    loading = false;
  }
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    void render();
  });
}

document.addEventListener("click", event => {
  const button = event.target?.closest?.("button");
  if (!button) return;
  if (text(document.querySelector("h1.page-title")?.textContent) !== "Sessions") return;

  const label = text(button.textContent);
  if (label.includes("削除") || label.includes("アーカイブ") || label.includes("復元")) {
    clearCache();
    window.setTimeout(schedule, 250);
  }
});

const view = document.getElementById("view");
if (view) {
  new MutationObserver(schedule).observe(view, { childList: true, subtree: true });
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    clearCache();
    schedule();
  }
});

schedule();
