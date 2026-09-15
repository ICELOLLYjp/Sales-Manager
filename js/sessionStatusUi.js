import { getFirebaseState } from "./firebase.js";

function text(value) {
  return String(value ?? "").trim();
}

function injectStyles() {
  if (document.querySelector("#sessionStatusUiStyles")) return;
  const style = document.createElement("style");
  style.id = "sessionStatusUiStyles";
  style.textContent = `
    .session-status-line{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 8px;}
    .session-status-badge{display:inline-flex;align-items:center;min-height:28px;padding:0 10px;border-radius:999px;font-size:11px;font-weight:900;line-height:1.2;}
    .session-status-badge.live{background:#e8f6ec;color:#25703c;}
    .session-status-badge.wait{background:#fff3cf;color:#765c00;}
    .session-status-badge.review{background:#fff0df;color:#8a4d0b;}
    .session-status-badge.done{background:#eceff1;color:#4f5961;}
    .session-status-badge.done-unidentified{background:#f3e9fb;color:#6c3b88;}
    .session-status-note{font-size:11px;line-height:1.35;color:#777;text-align:right;}
    #sessionStatusSummary{margin:4px 0 10px;padding:8px 10px;border-radius:10px;background:#f6f6f3;font-size:12px;font-weight:800;line-height:1.45;}
  `;
  document.head.appendChild(style);
}

async function firestoreModule() {
  return await import("https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js");
}

function closingComplete(session) {
  const explicit = session?.inventoryCount?.unidentifiedQuick?.closingComplete;
  if (explicit === true) return true;

  const opening = Array.isArray(session?.inventoryCount?.opening?.items)
    ? session.inventoryCount.opening.items
    : [];
  const closing = Array.isArray(session?.inventoryCount?.closing?.items)
    ? session.inventoryCount.closing.items
    : [];

  if (!opening.length || !closing.length) return false;

  const closingById = new Map(
    closing.map(item => [text(item?.variantId), item])
  );

  return opening.every(item => {
    const row = closingById.get(text(item?.variantId));
    return row && row.closingQty !== null && row.closingQty !== undefined && row.closingQty !== "";
  });
}

function statusMeta(session) {
  const status = text(session?.status);
  const unresolved = Math.max(
    0,
    Number(session?.inventoryCount?.unidentifiedQuick?.unresolvedTotal || 0)
  );
  const counted = closingComplete(session);
  const waitingForCount =
    session?.provisionalCloseMode === "inventory_pending" ||
    session?.inventoryCount?.provisionalWithoutCount?.status === "pending_count";

  if (status === "open") {
    return {
      label: "販売中",
      note: "POS使用中",
      className: "live",
      rank: 30
    };
  }

  if (status === "pending_allocation") {
    if (waitingForCount && !counted) {
      return {
        label: "POS停止済み・棚卸待ち",
        note: "処理待ち",
        className: "wait",
        rank: 0
      };
    }

    if (counted && unresolved > 0) {
      return {
        label: `棚卸済み・未特定 ${unresolved}点`,
        note: "終了処理待ち",
        className: "review",
        rank: 5
      };
    }

    if (counted) {
      return {
        label: "棚卸済み・終了確認待ち",
        note: "処理待ち",
        className: "review",
        rank: 6
      };
    }

    return {
      label: "POS停止済み・確認待ち",
      note: "処理待ち",
      className: "wait",
      rank: 8
    };
  }

  if (status === "closed") {
    const unidentifiedClosed =
      session?.eventCloseMode === "closed_with_unidentified" ||
      session?.inventoryCount?.unidentifiedQuick?.status === "closed_unidentified" ||
      session?.inventoryCount?.reconciliationStatus === "closed_with_unidentified";

    if (unidentifiedClosed) {
      return {
        label: unresolved > 0 ? `未特定あり終了 ${unresolved}点` : "未特定あり終了",
        note: "イベント終了済み",
        className: "done-unidentified",
        rank: 50
      };
    }

    return {
      label: "終了",
      note: "イベント終了済み",
      className: "done",
      rank: 60
    };
  }

  return null;
}

function findSessionRow(element) {
  let node = element?.parentElement || null;
  while (node && node.id !== "view") {
    if (node.style?.borderBottom && node.querySelector?.("[data-session-id]")) {
      return node;
    }
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

function applyBadge(row, sessionId, meta) {
  let line = row.querySelector(`:scope > .session-status-line[data-session-id="${CSS.escape(sessionId)}"]`);
  if (!line) {
    line = document.createElement("div");
    line.className = "session-status-line";
    line.dataset.sessionId = sessionId;
    row.insertAdjacentElement("afterbegin", line);
  }

  line.innerHTML = `
    <span class="session-status-badge ${meta.className}">${meta.label}</span>
    <span class="session-status-note">${meta.note}</span>
  `;
  row.dataset.sessionStatusRank = String(meta.rank);
  row.dataset.sessionStatus = meta.className;
}

function sortActiveRows(rows, rawById) {
  const active = [];
  rows.forEach((row, sessionId) => {
    const raw = rawById.get(sessionId);
    if (!raw || !["open", "pending_allocation"].includes(text(raw.status))) return;
    active.push({ row, sessionId, rank: Number(row.dataset.sessionStatusRank || 99) });
  });

  if (active.length < 2) return;
  const parent = active[0].row.parentElement;
  if (!parent || active.some(item => item.row.parentElement !== parent)) return;

  const ordered = active
    .map((item, index) => ({ ...item, index }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index);

  const anchor = document.createComment("session-status-order");
  parent.insertBefore(anchor, active[0].row);
  let cursor = anchor;
  ordered.forEach(item => {
    cursor.after(item.row);
    cursor = item.row;
  });
  anchor.remove();
}

function updateOpenHeader(rawById) {
  const title = Array.from(document.querySelectorAll(".card-title"))
    .find(element => text(element.textContent) === "Open Sessions");
  if (!title) return;

  title.textContent = "進行中・処理待ち";

  const active = Array.from(rawById.values())
    .filter(session => ["open", "pending_allocation"].includes(text(session.status)));
  const waiting = active.filter(session => text(session.status) === "pending_allocation").length;
  const live = active.filter(session => text(session.status) === "open").length;

  const header = title.parentElement;
  if (!header?.parentElement) return;

  let summary = header.parentElement.querySelector(":scope > #sessionStatusSummary");
  if (!summary) {
    summary = document.createElement("div");
    summary.id = "sessionStatusSummary";
    header.insertAdjacentElement("afterend", summary);
  }
  summary.textContent = `処理待ち ${waiting}件 / 販売中 ${live}件`;
}

let loading = false;
let lastLoadedAt = 0;
let cachedSessions = null;

async function loadRawSessions() {
  const now = Date.now();
  if (cachedSessions && now - lastLoadedAt < 15000) return cachedSessions;

  const { db, enabled } = getFirebaseState();
  if (!enabled || !db) return null;

  const { collection, getDocsFromServer } = await firestoreModule();
  const snapshot = await getDocsFromServer(collection(db, "salesSessions"));
  cachedSessions = snapshot.docs.map(doc => ({ sessionId: doc.id, ...doc.data() }));
  lastLoadedAt = now;
  return cachedSessions;
}

async function enhanceSessions() {
  injectStyles();
  const pageTitle = document.querySelector("h1.page-title");
  if (text(pageTitle?.textContent) !== "Sessions") return;
  if (loading) return;

  loading = true;
  try {
    const sessions = await loadRawSessions();
    if (!sessions || text(document.querySelector("h1.page-title")?.textContent) !== "Sessions") return;

    const rawById = new Map(sessions.map(session => [text(session.sessionId), session]));
    const rows = sessionRowsById();

    rows.forEach((row, sessionId) => {
      const session = rawById.get(sessionId);
      const meta = session ? statusMeta(session) : null;
      if (meta) applyBadge(row, sessionId, meta);
    });

    sortActiveRows(rows, rawById);
    updateOpenHeader(rawById);
  } catch (error) {
    console.warn("セッション状態表示を更新できませんでした。", error);
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
    void enhanceSessions();
  });
}

schedule();
new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    cachedSessions = null;
    lastLoadedAt = 0;
    schedule();
  }
});
