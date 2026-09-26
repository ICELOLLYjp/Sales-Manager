import { getFirebaseState } from "./firebase.js";
import { listSalesSessions } from "./services/sessionService.js";
import {
  loadPendingInventoryCloseSummary,
  closeEventWithPendingInventory
} from "./services/closeWithPendingInventoryService.js?v=20260916-pending-inventory-1";
import { getOfflineSalesQueueForSession } from "./services/offlineQueueService.js?v=20260911-offline-resilience-1";

const ACTIVE_SESSION_KEY = "icelolly-sales-active-session";
const INVENTORY_SESSION_KEY = "icelolly-sales-inventory-session";

let loading = false;
let cachedSessions = null;
let cachedAt = 0;
let scheduled = false;
let closingSessionId = "";

function text(value) {
  return String(value ?? "").trim();
}

function authReady() {
  if (document.getElementById("googleLoginButton")) return false;
  const status = text(document.getElementById("syncStatus")?.textContent);
  return Boolean(status) && !["Local", "Login", "Error"].includes(status);
}

function currentEmail() {
  return text(getFirebaseState()?.auth?.currentUser?.email);
}

function installStyles() {
  if (document.getElementById("pendingSessionActionsStyles")) return;
  const style = document.createElement("style");
  style.id = "pendingSessionActionsStyles";
  style.textContent = `
    .pending-session-actions{margin:10px 0 2px;padding:10px;border:1px solid #ead8a1;border-radius:12px;background:#fffaf0}
    .pending-session-actions-title{font-size:12px;font-weight:900;color:#5f4c16}
    .pending-session-actions-note{margin-top:4px;font-size:10px;line-height:1.45;color:#7a6b46}
    .pending-session-actions-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin-top:8px}
    .pending-session-actions button{min-height:44px;border-radius:11px;font-size:12px;font-weight:900;touch-action:manipulation}
    .pending-session-actions .psa-count{background:#fff;border:1px solid #d9d9d3;color:#222}
    .pending-session-actions .psa-close{background:#1f1f1f;border:1px solid #1f1f1f;color:#fff}
    #dashboardPendingSessions{margin-top:12px}
    #dashboardPendingSessions .dps-row{padding:10px 0;border-top:1px solid #ece9df}
    #dashboardPendingSessions .dps-row:first-of-type{border-top:0}
    #dashboardPendingSessions .dps-name{font-size:13px;font-weight:900}
    #dashboardPendingSessions .dps-date{margin-top:2px;font-size:10px;color:#777}
    #dashboardPendingSessions .dps-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin-top:7px}
    #dashboardPendingSessions button{min-height:42px;border-radius:11px;font-size:11px;font-weight:900;touch-action:manipulation}
  `;
  document.head.appendChild(style);
}

async function sessions(force = false) {
  const now = Date.now();
  if (!force && cachedSessions && now - cachedAt < 10000) return cachedSessions;
  cachedSessions = await listSalesSessions();
  cachedAt = now;
  return cachedSessions;
}

function findSessionRow(button) {
  let node = button?.parentElement || null;
  while (node && node.id !== "view") {
    if (node.style?.borderBottom && node.querySelector?.("[data-session-id]")) return node;
    if (node.classList?.contains("card")) return null;
    node = node.parentElement;
  }
  return null;
}

function eventDateText(session) {
  const start = text(session?.startDate).replaceAll("-", "/");
  const end = text(session?.endDate).replaceAll("-", "/");
  if (!start) return "";
  if (!end || start === end) return start;
  return `${start} 〜 ${end}`;
}

function goToInventory(sessionId) {
  localStorage.setItem(INVENTORY_SESSION_KEY, sessionId);
  document.querySelector('.nav-btn[data-route="inventory"]')?.click();
}

async function closeWithoutCount(sessionId, button) {
  if (closingSessionId) return;

  const offlineCount = getOfflineSalesQueueForSession(sessionId).length;
  if (offlineCount > 0) {
    window.alert(`未同期会計が ${offlineCount} 件あります。先に同期してください。`);
    return;
  }

  if (!navigator.onLine) {
    window.alert("正式終了にはオンライン接続が必要です。");
    return;
  }

  let summary;
  try {
    summary = await loadPendingInventoryCloseSummary({ sessionId });
  } catch (error) {
    window.alert(error?.message || String(error));
    return;
  }

  const ok = window.confirm(
    "棚卸をせずにイベントを正式終了します。\n\n" +
    `棚卸未確認 ${summary.missingClosingCount || 0} SKU\n` +
    `未特定Quick ${summary.unresolvedQuickTotal || 0} 点\n` +
    `未登録商品 ${summary.unregisteredItemCount || 0} 件\n` +
    `差異未解決 ${summary.residualDifferenceCount || 0} SKU\n\n` +
    "確定している処理だけ正式在庫へ反映します。\n" +
    "未確認の在庫は0や推定値で埋めず、未処理として記録に残します。\n\n" +
    "この内容で正式終了しますか？"
  );
  if (!ok) return;

  closingSessionId = sessionId;
  const original = button?.textContent || "棚卸せず正式終了";
  if (button) {
    button.disabled = true;
    button.textContent = "正式終了中…";
  }

  try {
    const result = await closeEventWithPendingInventory({
      sessionId,
      closedByEmail: currentEmail()
    });

    window.alert(
      "イベントを正式終了しました。\n" +
      "棚卸未確認や未特定項目は推測せず、未処理として記録に残しています。\n\n" +
      `棚卸未確認 ${result.missingClosingCount || 0} SKU\n` +
      `未特定Quick ${result.unresolvedQuickTotal || 0} 点\n` +
      `未登録商品 ${result.unregisteredItemCount || 0} 件`
    );

    if (localStorage.getItem(ACTIVE_SESSION_KEY) === sessionId) {
      localStorage.removeItem(ACTIVE_SESSION_KEY);
    }
    if (localStorage.getItem(INVENTORY_SESSION_KEY) === sessionId) {
      localStorage.removeItem(INVENTORY_SESSION_KEY);
    }
    window.location.reload();
  } catch (error) {
    window.alert(error?.message || String(error));
    if (button) {
      button.disabled = false;
      button.textContent = original;
    }
  } finally {
    closingSessionId = "";
  }
}

function addSessionActions(session, row) {
  const sessionId = text(session?.sessionId || session?.id);
  if (!sessionId || text(session?.status) !== "pending_allocation") return;

  let panel = row.querySelector(`:scope > .pending-session-actions[data-session-id="${CSS.escape(sessionId)}"]`);
  if (!panel) {
    panel = document.createElement("div");
    panel.className = "pending-session-actions";
    panel.dataset.sessionId = sessionId;
    panel.innerHTML = `
      <div class="pending-session-actions-title">仮終了後の処理</div>
      <div class="pending-session-actions-note">棚卸する場合も、棚卸せず正式終了する場合もここから進めます。</div>
      <div class="pending-session-actions-grid">
        <button type="button" class="psa-count">棚卸を進める</button>
        <button type="button" class="psa-close">棚卸せず正式終了</button>
      </div>
    `;
    row.appendChild(panel);

    panel.querySelector(".psa-count")?.addEventListener("click", () => {
      goToInventory(sessionId);
    });
    panel.querySelector(".psa-close")?.addEventListener("click", event => {
      void closeWithoutCount(sessionId, event.currentTarget);
    });
  }
}

function renderSessionsActions(rows) {
  document.querySelectorAll(".sessionDetailButton[data-session-id]").forEach(button => {
    const sessionId = text(button.dataset.sessionId);
    const session = rows.find(item => text(item.sessionId || item.id) === sessionId);
    if (!session || text(session.status) !== "pending_allocation") return;
    const row = findSessionRow(button);
    if (row) addSessionActions(session, row);
  });
}

function renderDashboardPending(rows) {
  const title = text(document.querySelector("h1.page-title")?.textContent);
  if (title !== "Dashboard") return;

  const pending = rows.filter(session => text(session.status) === "pending_allocation");
  document.getElementById("dashboardPendingSessions")?.remove();
  if (!pending.length) return;

  const view = document.getElementById("view");
  if (!view) return;

  const card = document.createElement("section");
  card.id = "dashboardPendingSessions";
  card.className = "card";
  card.innerHTML = `
    <div class="card-title">要処理</div>
    <div class="muted" style="margin-top:5px;font-size:11px;">仮終了したイベントが ${pending.length} 件あります。</div>
    ${pending.map(session => {
      const sessionId = text(session.sessionId || session.id);
      return `
        <div class="dps-row" data-session-id="${sessionId}">
          <div class="dps-name">${text(session.eventName || "Event")}</div>
          <div class="dps-date">${eventDateText(session)}</div>
          <div class="dps-actions">
            <button type="button" class="psa-count">棚卸を進める</button>
            <button type="button" class="psa-close">棚卸せず正式終了</button>
          </div>
        </div>
      `;
    }).join("")}
  `;

  const quick = Array.from(view.querySelectorAll(".card-title"))
    .find(element => text(element.textContent) === "すぐ使う")
    ?.closest("section.card");
  if (quick) quick.insertAdjacentElement("beforebegin", card);
  else view.appendChild(card);

  card.querySelectorAll(".dps-row").forEach(row => {
    const sessionId = text(row.dataset.sessionId);
    row.querySelector(".psa-count")?.addEventListener("click", () => goToInventory(sessionId));
    row.querySelector(".psa-close")?.addEventListener("click", event => {
      void closeWithoutCount(sessionId, event.currentTarget);
    });
  });
}

function preferOpenSession(rows) {
  const title = text(document.querySelector("h1.page-title")?.textContent);
  if (title !== "Dashboard") return false;

  const open = rows.find(session => text(session.status) === "open");
  if (!open) return false;

  const openId = text(open.sessionId || open.id);
  const activeId = text(localStorage.getItem(ACTIVE_SESSION_KEY));
  const active = rows.find(session => text(session.sessionId || session.id) === activeId);

  if (activeId === openId || text(active?.status) === "open") return false;

  localStorage.setItem(ACTIVE_SESSION_KEY, openId);
  document.getElementById("dashboardRefresh")?.click();
  return true;
}

async function enhance() {
  if (!authReady() || loading) return;

  const title = text(document.querySelector("h1.page-title")?.textContent);
  if (!['Sessions', 'Dashboard'].includes(title)) return;

  loading = true;
  try {
    const rows = await sessions();
    if (title === "Sessions") {
      renderSessionsActions(rows);
    } else if (title === "Dashboard") {
      if (!preferOpenSession(rows)) renderDashboardPending(rows);
    }
  } catch (error) {
    console.warn("仮終了イベントの操作を表示できませんでした。", error);
  } finally {
    loading = false;
  }
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    void enhance();
  });
}

installStyles();
schedule();
new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    cachedSessions = null;
    cachedAt = 0;
    schedule();
  }
});
window.addEventListener("focus", () => {
  cachedSessions = null;
  cachedAt = 0;
  schedule();
});
