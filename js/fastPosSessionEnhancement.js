import { getFirebaseState } from "./firebase.js";
import { loadPosOfflineSnapshot } from "./services/offlineQueueService.js?v=20260911-offline-resilience-1";

const OVERLAY_ID = "fastPosOverlay";
const CONNECTION_ID = "fastPosConnectionCard";
const SESSION_ID = "fastPosSessionCard";
const STYLE_ID = "fastPosSessionEnhancementStyles";

function text(value) {
  return String(value ?? "").trim();
}

function esc(value) {
  return text(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function activeSessionId() {
  return text(localStorage.getItem("icelolly-sales-active-session"));
}

function cachedSessions() {
  const snapshot = loadPosOfflineSnapshot();
  const rows = Array.isArray(snapshot?.openSessions) ? snapshot.openSessions : [];
  const active = snapshot?.activeSession;
  const byId = new Map();

  rows.forEach(row => {
    const id = text(row?.id || row?.sessionId);
    if (id) byId.set(id, { id, ...row });
  });

  const activeId = text(active?.id || active?.sessionId);
  if (activeId && !byId.has(activeId)) {
    byId.set(activeId, { id: activeId, ...active });
  }

  return [...byId.values()].filter(row => !text(row?.status) || text(row?.status) === "open");
}

function offlinePrepared(sessionId) {
  const id = text(sessionId);
  if (!id) return false;
  return cachedSessions().some(row => text(row?.id || row?.sessionId) === id);
}

async function firestoreModule() {
  return await import("https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js");
}

async function listOpenSessions() {
  if (navigator.onLine) {
    const { db, enabled } = getFirebaseState();
    if (enabled && db) {
      try {
        const { collection, query, where, getDocsFromServer } = await firestoreModule();
        const snapshot = await getDocsFromServer(
          query(collection(db, "salesSessions"), where("status", "==", "open"))
        );
        const rows = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
        if (rows.length) {
          return rows.sort((a, b) =>
            text(b?.startDate || b?.createdAt).localeCompare(text(a?.startDate || a?.createdAt))
          );
        }
      } catch (error) {
        console.warn("Fast POS session list fallback", error);
      }
    }
  }

  return cachedSessions();
}

function sessionLabel(session) {
  const name = text(session?.eventName || session?.name || "Event");
  const currency = text(session?.currency || "JPY").toUpperCase();
  return `${name} / ${currency}`;
}

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    #${OVERLAY_ID} .fps-connection{background:#f6fbf5;border-color:#d8e7d4}
    #${OVERLAY_ID} .fps-connection.offline{background:#fff9e8;border-color:#ead79a}
    #${OVERLAY_ID} .fps-connection-title{font:900 14px/1.3 system-ui,sans-serif;margin-bottom:5px}
    #${OVERLAY_ID} .fps-connection-text{font:500 12px/1.5 system-ui,sans-serif;color:#666}
    #${OVERLAY_ID} .fps-session-title{font:900 14px/1.3 system-ui,sans-serif;margin-bottom:8px}
    #${OVERLAY_ID} .fps-session-select{box-sizing:border-box;width:100%;min-height:46px;border:1px solid #d2d2cc;border-radius:12px;background:#fff;padding:0 12px;font:800 15px system-ui,sans-serif;color:#1f1f1f}
    #${OVERLAY_ID} .fps-session-meta{margin-top:9px;font:500 12px/1.55 system-ui,sans-serif;color:#777;white-space:pre-line}
    #${OVERLAY_ID} .fp-session{display:none!important}
  `;
  document.head.appendChild(style);
}

function connectionText(sessionId) {
  const prepared = offlinePrepared(sessionId);
  if (navigator.onLine) {
    return {
      title: "オンライン",
      detail: prepared
        ? "このイベントはオフライン販売の準備済みです"
        : "オンライン販売中です。通常POSを一度開くと、この端末にオフライン用Session情報も保存されます。",
      offline: false
    };
  }

  return {
    title: "オフライン",
    detail: prepared
      ? "このイベントはオフライン販売できます。会計は端末に保存され、再接続後に同期します。Stripe QRはオンライン時のみ利用できます。"
      : "このSessionのオフライン準備情報がありません。オンラインで一度POSを開いてください。",
    offline: true
  };
}

function updateConnectionCard() {
  const card = document.getElementById(CONNECTION_ID);
  if (!card) return;
  const status = connectionText(activeSessionId());
  card.classList.toggle("offline", status.offline);
  const title = card.querySelector(".fps-connection-title");
  const detail = card.querySelector(".fps-connection-text");
  if (title) title.textContent = status.title;
  if (detail) detail.textContent = status.detail;

  const stripe = document.querySelector(`#${OVERLAY_ID} #fpStripe`);
  if (stripe && !navigator.onLine) stripe.disabled = true;
}

function metaText(session) {
  if (!session) return "";
  const rows = [];
  if (text(session?.city)) rows.push(text(session.city));
  if (text(session?.startDate)) rows.push(text(session.startDate).replaceAll("-", "/"));
  const currency = text(session?.currency || "JPY").toUpperCase();
  const rate = Number(session?.fxRateToJPY || 0);
  if (currency === "JPY") rows.push("1 JPY = 1 JPY");
  else if (Number.isFinite(rate) && rate > 0) rows.push(`1 ${currency} = ${rate} JPY`);
  return rows.join("\n");
}

async function waitForSharedSession(nextId, previousId) {
  for (let i = 0; i < 12; i += 1) {
    await new Promise(resolve => setTimeout(resolve, 80));
    const current = activeSessionId();
    if (current === nextId) return nextId;
    if (i >= 3 && current === previousId) return previousId;
  }
  return activeSessionId();
}

async function requestSharedSessionChange(nextId) {
  const cleanNext = text(nextId);
  const previousId = activeSessionId();
  if (!cleanNext || cleanNext === previousId) return previousId;

  const normalSelect = document.getElementById("posSessionSelect");
  if (normalSelect && [...normalSelect.options].some(option => option.value === cleanNext)) {
    normalSelect.value = cleanNext;
    normalSelect.dispatchEvent(new Event("change", { bubbles: true }));
    return await waitForSharedSession(cleanNext, previousId);
  }

  localStorage.setItem("icelolly-sales-active-session", cleanNext);
  return cleanNext;
}

async function enhanceOverlay() {
  const overlay = document.getElementById(OVERLAY_ID);
  const wrap = overlay?.querySelector(".fp-wrap");
  if (!overlay || !wrap || document.getElementById(SESSION_ID)) return;

  installStyles();

  const connection = document.createElement("section");
  connection.id = CONNECTION_ID;
  connection.className = "fp-card fps-connection";
  connection.innerHTML = `
    <div class="fps-connection-title"></div>
    <div class="fps-connection-text"></div>
  `;

  const sessionCard = document.createElement("section");
  sessionCard.id = SESSION_ID;
  sessionCard.className = "fp-card";
  sessionCard.innerHTML = `
    <div class="fps-session-title">販売セッション</div>
    <select class="fps-session-select" id="fastPosSessionSelect" disabled>
      <option value="">読み込み中…</option>
    </select>
    <div class="fps-session-meta" id="fastPosSessionMeta"></div>
  `;

  wrap.prepend(sessionCard);
  wrap.prepend(connection);
  updateConnectionCard();

  const select = sessionCard.querySelector("#fastPosSessionSelect");
  const meta = sessionCard.querySelector("#fastPosSessionMeta");

  try {
    const sessions = await listOpenSessions();
    if (!document.body.contains(overlay)) return;
    if (!sessions.length) {
      select.innerHTML = `<option value="">販売中のSessionがありません</option>`;
      return;
    }

    let selectedId = activeSessionId();
    if (!sessions.some(row => text(row?.id) === selectedId)) {
      selectedId = text(sessions[0]?.id);
    }

    select.innerHTML = sessions.map(row =>
      `<option value="${esc(row.id)}" ${text(row.id) === selectedId ? "selected" : ""}>${esc(sessionLabel(row))}</option>`
    ).join("");
    select.disabled = false;

    const renderMeta = id => {
      const target = sessions.find(row => text(row?.id) === text(id));
      meta.textContent = metaText(target);
    };
    renderMeta(selectedId);

    select.addEventListener("change", async () => {
      const requested = text(select.value);
      const previousId = activeSessionId();
      select.disabled = true;
      const effective = await requestSharedSessionChange(requested);

      if (effective !== requested) {
        select.value = previousId;
        renderMeta(previousId);
        select.disabled = false;
        updateConnectionCard();
        return;
      }

      renderMeta(effective);
      updateConnectionCard();

      /* Reopen Fast POS so currency, keypad decimal handling and amount state
       * are rebuilt from the newly selected shared POS Session. */
      overlay.querySelector(".fp-close")?.click();
      window.setTimeout(() => document.getElementById("fastPosOpenButton")?.click(), 80);
    });
  } catch (error) {
    select.innerHTML = `<option value="">Sessionを読み込めません</option>`;
    meta.textContent = error?.message || String(error);
  }
}

function sync() {
  installStyles();
  void enhanceOverlay();
  updateConnectionCard();
}

let scheduled = false;
function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    sync();
  });
}

new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
window.addEventListener("online", () => {
  updateConnectionCard();
  document.querySelector(`#${OVERLAY_ID} #fpAmount`)?.dispatchEvent(new Event("input", { bubbles: true }));
});
window.addEventListener("offline", updateConnectionCard);
window.addEventListener("focus", sync);
document.addEventListener("visibilitychange", () => { if (!document.hidden) sync(); });
sync();
