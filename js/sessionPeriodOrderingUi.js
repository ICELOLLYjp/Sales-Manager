import { getFirebaseState } from "./firebase.js";

function text(value) {
  return String(value ?? "").trim();
}

function localDateKey() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function eventPhase(session) {
  const status = text(session?.status);
  if (status === "closed" || status === "archived") return "ended";

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
  if (document.getElementById("sessionPeriodOrderingStyles")) return;
  const style = document.createElement("style");
  style.id = "sessionPeriodOrderingStyles";
  style.textContent = `
    #sessionPeriodBoard{display:grid;gap:12px;margin-top:12px}
    #sessionPeriodBoard .session-period-group{margin:0}
    #sessionPeriodBoard .session-period-title{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:4px;font-size:16px;font-weight:900}
    #sessionPeriodBoard .session-period-count{font-size:12px;color:#777}
    #sessionPeriodBoard .session-period-empty{padding:12px 0;color:#888;font-size:12px}
    .session-status-badge.scheduled{background:#eef4ff;color:#3d5f91}
  `;
  document.head.appendChild(style);
}

async function firestoreModule() {
  return await import("https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js");
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

function updateOpenBadge(row, session) {
  if (text(session?.status) !== "open") return;

  const phase = eventPhase(session);
  let line = row.querySelector(":scope > .session-status-line");
  if (!line) {
    line = document.createElement("div");
    line.className = "session-status-line";
    row.insertAdjacentElement("afterbegin", line);
  }

  if (phase === "current") {
    line.innerHTML = `<span class="session-status-badge live">販売中</span><span class="session-status-note">開催期間中・POS使用中</span>`;
    return;
  }

  if (phase === "upcoming") {
    line.innerHTML = `<span class="session-status-badge scheduled">開催予定</span><span class="session-status-note">${text(session?.startDate)} 開始</span>`;
    return;
  }

  line.innerHTML = `<span class="session-status-badge review">開催終了・終了処理待ち</span><span class="session-status-note">イベント期間終了</span>`;
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
  if (!board) {
    board = document.createElement("div");
    board.id = "sessionPeriodBoard";
    anchor.parentElement?.insertBefore(board, anchor);
  }
  return board;
}

function groupSection(board, phase, count) {
  let section = board.querySelector(`[data-session-period="${phase}"]`);
  if (!section) {
    section = document.createElement("section");
    section.className = "card session-period-group";
    section.dataset.sessionPeriod = phase;
    section.innerHTML = `<div class="session-period-title"><span>${phaseLabel(phase)}</span><span class="session-period-count"></span></div><div class="session-period-body"></div>`;
    board.appendChild(section);
  }
  section.querySelector(".session-period-count").textContent = `${count}件`;
  return section.querySelector(".session-period-body");
}

function rebuildBoard(sessions) {
  const pageTitle = document.querySelector("h1.page-title");
  if (text(pageTitle?.textContent) !== "Sessions") return;

  const rows = sessionRowsById();
  if (!rows.size) return;

  const rawById = new Map(sessions.map(session => [text(session.sessionId), session]));
  const entries = [];
  const sourceCards = new Set();

  rows.forEach((row, sessionId) => {
    const session = rawById.get(sessionId);
    if (!session) return;
    updateOpenBadge(row, session);
    entries.push({ row, sessionId, session, phase: eventPhase(session) });
    const sourceCard = row.closest(".card");
    if (sourceCard && !sourceCard.classList.contains("session-period-group")) sourceCards.add(sourceCard);
  });

  if (!entries.length) return;

  const anchor = entries[0].row.closest(".card") || entries[0].row;
  const board = ensureBoard(anchor);
  const order = ["current", "upcoming", "ended"];

  order.forEach(phase => {
    const group = entries.filter(entry => entry.phase === phase).sort((a, b) => compareRows(a, b, phase));
    const body = groupSection(board, phase, group.length);
    body.innerHTML = "";
    if (!group.length) {
      body.innerHTML = `<div class="session-period-empty">該当するイベントはありません</div>`;
      return;
    }
    group.forEach(entry => body.appendChild(entry.row));
  });

  sourceCards.forEach(card => {
    card.dataset.sessionPeriodSource = "1";
    card.style.display = "none";
  });
}

let loading = false;
let cachedSessions = null;
let cachedAt = 0;

async function loadSessions() {
  const now = Date.now();
  if (cachedSessions && now - cachedAt < 15000) return cachedSessions;

  const { db, enabled } = getFirebaseState();
  if (!enabled || !db) return null;

  const { collection, getDocsFromServer } = await firestoreModule();
  const snapshot = await getDocsFromServer(collection(db, "salesSessions"));
  cachedSessions = snapshot.docs.map(doc => ({ sessionId: doc.id, ...doc.data() }));
  cachedAt = now;
  return cachedSessions;
}

async function render() {
  if (loading) return;
  if (text(document.querySelector("h1.page-title")?.textContent) !== "Sessions") return;

  loading = true;
  try {
    installStyles();
    const sessions = await loadSessions();
    if (!sessions) return;
    if (text(document.querySelector("h1.page-title")?.textContent) !== "Sessions") return;
    rebuildBoard(sessions);
  } catch (error) {
    console.warn("イベント期間別の並び替えを更新できませんでした。", error);
  } finally {
    loading = false;
  }
}

let scheduled = false;
function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    void render();
  });
}

schedule();
new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    cachedSessions = null;
    cachedAt = 0;
    schedule();
  }
});
