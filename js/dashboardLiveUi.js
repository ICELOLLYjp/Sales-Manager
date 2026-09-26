import { listSalesSessions } from "./services/sessionService.js";
import { listSessionTransactions } from "./services/salesHistoryService.js?v=20260910-setdiscount-2";

let refreshToken = 0;
let refreshBusy = false;

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function dashboardActive() {
  return Boolean(
    document.querySelector('.nav-btn[data-route="dashboard"].active')
  );
}

function money(value, currency) {
  const amount = Number(value || 0);
  try {
    return new Intl.NumberFormat(
      currency === "JPY" ? "ja-JP" : "en-US",
      {
        style: "currency",
        currency: currency || "JPY",
        maximumFractionDigits: currency === "JPY" ? 0 : 2
      }
    ).format(amount);
  } catch {
    return `${currency || ""} ${amount.toLocaleString()}`.trim();
  }
}

function statusLabel(status) {
  if (status === "open") return "販売中";
  if (status === "pending_allocation") return "在庫未確定";
  if (status === "closed") return "終了";
  if (status === "archived") return "アーカイブ";
  return status || "";
}

function localDayStartMs() {
  const now = new Date();
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    0,
    0,
    0,
    0
  ).getTime();
}

function eventDateText(session) {
  const start = String(session?.startDate || "").replaceAll("-", "/");
  const end = String(session?.endDate || "").replaceAll("-", "/");
  if (!start) return "";
  if (!end || start === end) return start;
  return `${start} 〜 ${end}`;
}

function pickDashboardSession(sessions) {
  const activeId = localStorage.getItem("icelolly-sales-active-session") || "";
  const active = sessions.find(row => row.sessionId === activeId);
  if (active) return active;

  return sessions.find(row => row.status === "open") ||
    sessions.find(row => row.status === "pending_allocation") ||
    sessions[0] || null;
}

function metric(label, value, note = "") {
  return `
    <section style="padding:15px;border:1px solid #e6e6e1;border-radius:16px;background:#fff;min-width:0;">
      <div style="font-size:12px;color:#777;font-weight:700;">${esc(label)}</div>
      <div style="margin-top:6px;font-size:24px;line-height:1.15;font-weight:900;overflow-wrap:anywhere;">${esc(value)}</div>
      ${note ? `<div style="margin-top:5px;font-size:11px;color:#888;">${esc(note)}</div>` : ""}
    </section>
  `;
}

function actionButton(id, label, primary = false) {
  return `
    <button
      id="${id}"
      type="button"
      style="
        min-height:52px;
        border:${primary ? "0" : "1px solid #deded9"};
        border-radius:14px;
        background:${primary ? "#1f1f1f" : "#fff"};
        color:${primary ? "#fff" : "#222"};
        font-size:14px;
        font-weight:800;
        touch-action:manipulation;
      "
    >${esc(label)}</button>
  `;
}

function waitFor(find, timeoutMs = 12000) {
  return new Promise(resolve => {
    const started = Date.now();
    function check() {
      const result = find();
      if (result) return resolve(result);
      if (Date.now() - started >= timeoutMs) return resolve(null);
      window.setTimeout(check, 80);
    }
    check();
  });
}

async function openHistory() {
  document.querySelector('.nav-btn[data-route="pos"]')?.click();
  const history = await waitFor(() => document.getElementById("posHistoryShortcut"));
  history?.click();
}

function bindDashboardActions() {
  document.getElementById("dashboardOpenPos")?.addEventListener("click", () => {
    document.querySelector('.nav-btn[data-route="pos"]')?.click();
  });
  document.getElementById("dashboardOpenHistory")?.addEventListener("click", () => {
    void openHistory();
  });
  document.getElementById("dashboardOpenSessions")?.addEventListener("click", () => {
    document.querySelector('.nav-btn[data-route="sessions"]')?.click();
  });
  document.getElementById("dashboardOpenInventory")?.addEventListener("click", () => {
    document.querySelector('.nav-btn[data-route="inventory"]')?.click();
  });
  document.getElementById("dashboardRefresh")?.addEventListener("click", () => {
    void refreshDashboard(true);
  });
}

async function refreshDashboard(force = false) {
  if (!dashboardActive() || refreshBusy) return;

  const view = document.getElementById("view");
  if (!view) return;

  if (!force && view.dataset.liveDashboard === "ready") return;

  const token = ++refreshToken;
  refreshBusy = true;
  view.dataset.liveDashboard = "loading";
  view.innerHTML = `
    <h1 class="page-title">Dashboard</h1>
    <p class="page-note">現在のイベント状況を読み込んでいます</p>
    <section class="card"><div class="muted">売上とイベント情報を更新中です</div></section>
  `;

  try {
    const sessions = await listSalesSessions();
    if (token !== refreshToken || !dashboardActive()) return;

    const session = pickDashboardSession(sessions);

    if (!session) {
      view.innerHTML = `
        <h1 class="page-title">Dashboard</h1>
        <p class="page-note">イベントホーム</p>
        <section class="card">
          <div class="card-title">販売イベントがありません</div>
          <div class="muted" style="margin-top:8px;">Sessionsからイベントを作成してください。</div>
        </section>
        <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;">
          ${actionButton("dashboardOpenSessions", "Sessionsを開く", true)}
          ${actionButton("dashboardOpenInventory", "Inventory")}
        </div>
      `;
      view.dataset.liveDashboard = "ready";
      bindDashboardActions();
      return;
    }

    const transactions = await listSessionTransactions(session.sessionId);
    if (token !== refreshToken || !dashboardActive()) return;

    const activeTransactions = transactions.filter(row => row.status !== "voided");
    const totalSales = activeTransactions.reduce((sum, row) => sum + Number(row.netSales || 0), 0);
    const totalItems = activeTransactions.reduce((sum, row) => sum + Number(row.itemCount || 0), 0);
    const todayStart = localDayStartMs();
    const todayRows = activeTransactions.filter(row => Number(row.createdAtMs || 0) >= todayStart);
    const todaySales = todayRows.reduce((sum, row) => sum + Number(row.netSales || 0), 0);

    const currency = session.currency || "JPY";
    const expenseJPY = Number(session.expenseSummary?.totalJPY || 0);
    const rate = currency === "JPY" ? 1 : Number(session.fxRateToJPY || 0);
    const salesJPY = rate > 0 ? totalSales * rate : null;
    const balanceJPY = salesJPY === null ? null : salesJPY - expenseJPY;
    const location = [session.city, session.country].filter(Boolean).join(" / ");

    view.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">
        <div>
          <h1 class="page-title" style="margin-bottom:4px;">Dashboard</h1>
          <p class="page-note" style="margin-top:0;">イベントホーム</p>
        </div>
        <button id="dashboardRefresh" type="button" class="button button-secondary" style="min-height:38px;padding:0 12px;">更新</button>
      </div>

      <section class="card" style="padding:16px;">
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;">
          <div style="min-width:0;">
            <div style="font-size:20px;font-weight:900;overflow-wrap:anywhere;">${esc(session.eventName || "Event")}</div>
            <div class="muted" style="margin-top:5px;line-height:1.5;">${esc(eventDateText(session))}${location ? `<br>${esc(location)}` : ""}</div>
          </div>
          <span style="padding:5px 9px;border-radius:999px;background:${session.status === "open" ? "#edf8ef" : "#f1f1ed"};font-size:11px;font-weight:800;white-space:nowrap;">${esc(statusLabel(session.status))}</span>
        </div>
      </section>

      <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:12px;">
        ${metric("今日の売上", money(todaySales, currency), `${todayRows.length} 会計`)}
        ${metric("イベント累計", money(totalSales, currency), `${activeTransactions.length} 会計`)}
        ${metric("販売点数", `${totalItems.toLocaleString()} 点`)}
        ${metric("経費", money(expenseJPY, "JPY"), "登録済み経費")}
      </div>

      <section class="card" style="margin-top:12px;">
        <div class="card-title">経費差引き収支</div>
        <div style="margin-top:8px;font-size:28px;font-weight:900;">
          ${balanceJPY === null ? "為替レート未設定" : esc(money(balanceJPY, "JPY"))}
        </div>
        <div class="muted" style="margin-top:6px;line-height:1.5;">
          ${balanceJPY === null
            ? "イベント通貨から円へ換算するレートをSessionsで設定すると表示できます。"
            : `売上換算 ${esc(money(salesJPY, "JPY"))} から経費 ${esc(money(expenseJPY, "JPY"))} を差し引いた金額です。`}
        </div>
      </section>

      <section class="card" style="margin-top:12px;">
        <div class="card-title">すぐ使う</div>
        <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:10px;">
          ${actionButton("dashboardOpenPos", "POSを開く", true)}
          ${actionButton("dashboardOpenHistory", "会計履歴")}
          ${actionButton("dashboardOpenSessions", "イベント詳細")}
          ${actionButton("dashboardOpenInventory", "Inventory")}
        </div>
      </section>
    `;

    view.dataset.liveDashboard = "ready";
    bindDashboardActions();
  } catch (error) {
    if (token !== refreshToken || !dashboardActive()) return;
    view.innerHTML = `
      <h1 class="page-title">Dashboard</h1>
      <p class="page-note">イベントホーム</p>
      <section class="card">
        <div class="warning">Dashboardを読み込めませんでした。${esc(error?.message || String(error))}</div>
        <button id="dashboardRefresh" type="button" class="button" style="width:100%;min-height:48px;margin-top:10px;">再読み込み</button>
      </section>
    `;
    view.dataset.liveDashboard = "error";
    bindDashboardActions();
  } finally {
    refreshBusy = false;
  }
}

function scheduleDashboardRefresh() {
  if (!dashboardActive()) return;
  const view = document.getElementById("view");
  if (!view) return;
  if (view.dataset.liveDashboard === "loading" || view.dataset.liveDashboard === "ready") return;
  window.setTimeout(() => void refreshDashboard(), 60);
}

document.addEventListener("click", event => {
  const nav = event.target instanceof Element
    ? event.target.closest('.nav-btn[data-route="dashboard"]')
    : null;
  if (!nav) return;
  window.setTimeout(() => {
    const view = document.getElementById("view");
    if (view) delete view.dataset.liveDashboard;
    void refreshDashboard(true);
  }, 80);
});

const app = document.getElementById("app");
if (app) {
  new MutationObserver(scheduleDashboardRefresh).observe(app, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class"]
  });
}

window.setTimeout(() => void refreshDashboard(), 350);
