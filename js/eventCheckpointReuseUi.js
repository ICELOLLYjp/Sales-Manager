import { getFirebaseState } from "./firebase.js";
import {
  loadCheckpointReuseSummary,
  applyReusableCheckpointToClosing
} from "./services/eventCheckpointReuseService.js?v=20260916-checkpoint-reuse-1";

const INVENTORY_SESSION_KEY = "icelolly-sales-inventory-session";
const PANEL_ID = "eventCheckpointReusePanel";

function text(value) {
  return String(value ?? "").trim();
}

function esc(value) {
  return text(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function currentSessionId() {
  return text(localStorage.getItem(INVENTORY_SESSION_KEY));
}

function currentEmail() {
  return text(getFirebaseState()?.auth?.currentUser?.email);
}

function checkpointTypeLabel(value) {
  if (value === "daily_close") return "日次締め";
  if (value === "final_count") return "最終実数";
  return "途中カウント";
}

function dateLabel(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function installStyles() {
  if (document.querySelector("#eventCheckpointReuseStyles")) return;
  const style = document.createElement("style");
  style.id = "eventCheckpointReuseStyles";
  style.textContent = `
    #${PANEL_ID}{margin-top:10px;padding:11px;border:1px solid #b9ddbf;border-radius:12px;background:#f4fbf5}
    #${PANEL_ID} .ecr-title{font-size:13px;font-weight:900}
    #${PANEL_ID} .ecr-note{font-size:11px;line-height:1.5;color:#667;margin-top:3px}
    #${PANEL_ID} .ecr-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin-top:9px}
    #${PANEL_ID} .ecr-stat{padding:8px;border-radius:9px;background:#fff;border:1px solid rgba(0,0,0,.06)}
    #${PANEL_ID} .ecr-stat strong{display:block;font-size:18px}.ecr-stat span{font-size:9px;color:#777}
    #${PANEL_ID} .ecr-actions{display:grid;grid-template-columns:1fr;gap:7px;margin-top:9px}
    #${PANEL_ID} .ecr-actions button{width:100%;min-height:44px}
    #${PANEL_ID} details{margin-top:8px;border-top:1px solid rgba(0,0,0,.08);padding-top:7px}
    #${PANEL_ID} details summary{font-size:11px;font-weight:800;cursor:pointer}
    #${PANEL_ID} .ecr-row{font-size:11px;line-height:1.45;padding:6px 0;border-top:1px solid rgba(0,0,0,.05)}
    #${PANEL_ID} .ecr-row:first-child{border-top:0}
  `;
  document.head.appendChild(style);
}

function placePanel(panel) {
  const hub = document.querySelector("#eventCloseHub");
  const reconcile = hub?.querySelector(".ech-reconcile");
  if (!hub || !reconcile) return false;
  reconcile.insertAdjacentElement("beforebegin", panel);
  return true;
}

function openInventoryFlow() {
  document.querySelector("#closeInventoryCountButton")?.click();
  setTimeout(() => {
    document.querySelector("#inventoryFlowOpenButton")?.click();
  }, 80);
}

let loading = false;
let loadedSessionId = "";

async function renderPanel(force = false) {
  if (loading) return;
  const sessionId = currentSessionId();
  if (!sessionId) return;
  if (!force && loadedSessionId === sessionId && document.querySelector(`#${PANEL_ID}`)) return;

  const hub = document.querySelector("#eventCloseHub");
  if (!hub) return;

  loading = true;
  try {
    const summary = await loadCheckpointReuseSummary({ sessionId });
    if (currentSessionId() !== sessionId) return;

    document.querySelector(`#${PANEL_ID}`)?.remove();
    loadedSessionId = sessionId;

    if (!summary.hasCheckpoint) return;

    installStyles();
    const panel = document.createElement("section");
    panel.id = PANEL_ID;

    const recheckPreview = summary.recheckRows.slice(0, 8);
    const moreCount = Math.max(0, summary.recheckRows.length - recheckPreview.length);
    const detailHtml = summary.recheckRows.length
      ? `
        <details>
          <summary>要再確認 ${summary.recheckCount} SKUを見る</summary>
          <div style="margin-top:5px;">
            ${recheckPreview.map(row => `
              <div class="ecr-row">
                <strong>${esc(row.label)}</strong>
                ${row.detail ? `<div>${esc(row.detail)}</div>` : ""}
                <div style="color:#876b00;">${esc(row.reasons.join(" / ") || "再確認")}</div>
              </div>
            `).join("")}
            ${moreCount ? `<div class="ecr-row">ほか ${moreCount} SKU</div>` : ""}
          </div>
        </details>
      `
      : "";

    panel.innerHTML = `
      <div class="ecr-title">前回カウントを再利用</div>
      <div class="ecr-note">
        ${esc(checkpointTypeLabel(summary.checkpointType))}
        ${summary.checkpointLabel ? `「${esc(summary.checkpointLabel)}」` : ""}
        ${summary.checkpointCapturedAtIso ? ` / ${esc(dateLabel(summary.checkpointCapturedAtIso))}` : ""}<br>
        前回カウント後にSKU販売・Quick販売・Restock・開始修正がない商品は、もう一度数えなくて大丈夫です。
      </div>
      <div class="ecr-grid">
        <div class="ecr-stat"><strong>${summary.reusableCount}</strong><span>再カウント不要</span></div>
        <div class="ecr-stat"><strong>${summary.recheckCount}</strong><span>要再確認</span></div>
        <div class="ecr-stat"><strong>${summary.alreadyClosingCount}</strong><span>終了実数登録済み</span></div>
      </div>
      <div class="ecr-actions">
        ${summary.carryableCount > 0 ? `<button id="applyCheckpointReuseButton" type="button" class="button">✓ ${summary.carryableCount} SKUを再カウントせず引き継ぐ</button>` : ""}
        ${summary.sessionStatus === "open" ? `<button id="openInventoryFlowFromCloseButton" type="button" class="button button-secondary">途中カウント／日次締めを開く</button>` : ""}
      </div>
      ${summary.carryableCount === 0 && summary.recheckCount === 0
        ? `<div class="ecr-note" style="font-weight:800;color:#28713d;margin-top:8px;">前回カウントをそのまま終了実数として利用できます。</div>`
        : ""}
      ${detailHtml}
    `;

    if (!placePanel(panel)) return;

    panel.querySelector("#openInventoryFlowFromCloseButton")?.addEventListener("click", openInventoryFlow);

    panel.querySelector("#applyCheckpointReuseButton")?.addEventListener("click", async event => {
      const button = event.currentTarget;
      const ok = window.confirm(
        `前回カウント後に変動がない ${summary.carryableCount} SKUを、終了実数へ引き継ぎます。\n\n` +
        `要再確認 ${summary.recheckCount} SKUは引き継がず、実際に数えてください。\n` +
        "会社の正式実在庫はこの操作では変更しません。\n\nこの内容で進めますか？"
      );
      if (!ok) return;

      const original = button.textContent;
      button.disabled = true;
      button.textContent = "引き継ぎ中…";

      try {
        const result = await applyReusableCheckpointToClosing({
          sessionId,
          savedByEmail: currentEmail()
        });
        window.alert(
          `${result.appliedCount} SKUを前回カウントから引き継ぎました。\n` +
          `要再確認は ${result.recheckCount} SKUです。`
        );
        loadedSessionId = "";
        await renderPanel(true);
      } catch (error) {
        window.alert(error?.message || String(error));
        button.disabled = false;
        button.textContent = original;
      }
    });
  } catch (error) {
    console.warn("Checkpoint reuse panel could not be prepared.", error);
  } finally {
    loading = false;
  }
}

let scheduled = false;
function schedule(force = false) {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    void renderPanel(force);
  });
}

schedule();
new MutationObserver(() => schedule()).observe(document.body, {
  childList: true,
  subtree: true
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) schedule(true);
});
window.addEventListener("focus", () => schedule(true));
