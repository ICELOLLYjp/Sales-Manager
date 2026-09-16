import { getFirebaseState } from "./firebase.js";
import {
  loadPendingInventoryCloseSummary,
  closeEventWithPendingInventory
} from "./services/closeWithPendingInventoryService.js?v=20260916-pending-inventory-1";
import { getOfflineSalesQueueForSession } from "./services/offlineQueueService.js?v=20260911-offline-resilience-1";

const INVENTORY_SESSION_KEY = "icelolly-sales-inventory-session";
const PANEL_ID = "eventPendingInventoryClosePanel";

function text(value) {
  return String(value ?? "").trim();
}

function currentSessionId() {
  return text(localStorage.getItem(INVENTORY_SESSION_KEY));
}

function currentEmail() {
  return text(getFirebaseState()?.auth?.currentUser?.email);
}

function installStyles() {
  if (document.querySelector("#eventPendingInventoryCloseStyles")) return;
  const style = document.createElement("style");
  style.id = "eventPendingInventoryCloseStyles";
  style.textContent = `
    #${PANEL_ID}{margin-top:10px;padding:11px;border:1px solid #e4c880;border-radius:12px;background:#fff9e8}
    #${PANEL_ID} .epic-title{font-size:13px;font-weight:900}
    #${PANEL_ID} .epic-note{font-size:11px;line-height:1.5;color:#6c6251;margin-top:4px}
    #${PANEL_ID} .epic-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin-top:8px}
    #${PANEL_ID} .epic-stat{padding:7px;border:1px solid rgba(0,0,0,.07);border-radius:9px;background:#fff}
    #${PANEL_ID} .epic-stat strong{display:block;font-size:17px}.epic-stat span{font-size:9px;color:#777}
    #${PANEL_ID} button{width:100%;min-height:50px;margin-top:9px;font-size:14px;font-weight:900}
    #${PANEL_ID} .epic-safe{margin-top:7px;font-size:10px;line-height:1.45;color:#555}
  `;
  document.head.appendChild(style);
}

function buildPanel(summary) {
  const panel = document.createElement("section");
  panel.id = PANEL_ID;
  const offlineCount = getOfflineSalesQueueForSession(summary.sessionId).length;
  const disabled = !navigator.onLine || offlineCount > 0;
  const buttonLabel = !navigator.onLine
    ? "オンライン接続後に正式終了できます"
    : offlineCount > 0
      ? `未同期会計 ${offlineCount}件を先に同期`
      : "未処理・不明を残して正式終了";

  panel.innerHTML = `
    <div class="epic-title">すべて処理しなくても終了できます</div>
    <div class="epic-note">分かるところだけ確定し、不明な項目は不明のまま残します。0や推定SKUを自動入力しません。</div>
    <div class="epic-grid">
      <div class="epic-stat"><strong>${summary.missingClosingCount}</strong><span>終了実数 未確認SKU</span></div>
      <div class="epic-stat"><strong>${summary.unresolvedQuickTotal}</strong><span>未特定Quick</span></div>
      <div class="epic-stat"><strong>${summary.unregisteredItemCount}</strong><span>未登録商品</span></div>
      <div class="epic-stat"><strong>${summary.residualDifferenceCount}</strong><span>差異未解決SKU</span></div>
    </div>
    <button id="eventPendingInventoryCloseButton" type="button" class="button" ${disabled ? "disabled" : ""}>${buttonLabel}</button>
    <div class="epic-safe">入力済みの明示的なQuick配分・紛失・破損・在庫調整など、確定している処理だけ正式在庫へ反映します。未処理部分は正式在庫へ反映せず、イベント記録に残します。</div>
  `;
  return panel;
}

let loading = false;
let lastRequestAt = 0;

async function render() {
  const hub = document.querySelector("#eventCloseHub");
  const sessionId = currentSessionId();
  if (!hub || !sessionId || loading) return;

  const now = Date.now();
  if (now - lastRequestAt < 1500 && document.querySelector(`#${PANEL_ID}`)) return;
  lastRequestAt = now;
  loading = true;

  try {
    const summary = await loadPendingInventoryCloseSummary({ sessionId });
    if (currentSessionId() !== sessionId) return;

    document.querySelector(`#${PANEL_ID}`)?.remove();
    if (summary.sessionStatus !== "pending_allocation" || summary.closingComplete) return;

    installStyles();
    const panel = buildPanel(summary);
    const primary = hub.querySelector("#eventCloseHubAction");
    if (primary) primary.insertAdjacentElement("afterend", panel);
    else hub.appendChild(panel);

    panel.querySelector("#eventPendingInventoryCloseButton")?.addEventListener("click", async event => {
      const button = event.currentTarget;
      const pendingOffline = getOfflineSalesQueueForSession(sessionId).length;
      if (pendingOffline > 0) {
        window.alert(`未同期会計が ${pendingOffline} 件あります。先に同期してください。`);
        return;
      }
      if (!navigator.onLine) {
        window.alert("正式終了にはオンライン接続が必要です。");
        return;
      }

      const ok = window.confirm(
        "未処理・不明な項目を残したままイベントを正式終了します。\n\n" +
        `・終了実数 未確認 ${summary.missingClosingCount} SKU\n` +
        `・未特定Quick ${summary.unresolvedQuickTotal} 点\n` +
        `・未登録商品 ${summary.unregisteredItemCount} 件\n` +
        `・差異未解決 ${summary.residualDifferenceCount} SKU\n\n` +
        "分からない項目には0や推定値を入れません。\n" +
        "確定している処理だけ正式在庫へ反映し、それ以外は未処理として記録します。\n\n" +
        "この内容で正式終了しますか？"
      );
      if (!ok) return;

      const original = button.textContent;
      button.disabled = true;
      button.textContent = "未処理を保存して終了中…";
      try {
        const result = await closeEventWithPendingInventory({
          sessionId,
          closedByEmail: currentEmail()
        });
        window.alert(
          "イベントを正式終了しました。\n" +
          "未処理・不明な項目は推測せず、そのまま記録に残しています。\n\n" +
          `終了実数 未確認 ${result.missingClosingCount || 0} SKU\n` +
          `未特定Quick ${result.unresolvedQuickTotal || 0} 点\n` +
          `未登録商品 ${result.unregisteredItemCount || 0} 件`
        );
        panel.remove();
        localStorage.removeItem(INVENTORY_SESSION_KEY);
        window.location.reload();
      } catch (error) {
        window.alert(error?.message || String(error));
        button.disabled = false;
        button.textContent = original;
      }
    });
  } catch (error) {
    console.warn("Pending inventory close option could not be prepared.", error);
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
document.addEventListener("visibilitychange", () => { if (!document.hidden) { lastRequestAt = 0; schedule(); } });
window.addEventListener("focus", () => { lastRequestAt = 0; schedule(); });
