import { loadUnidentifiedQuickSummary } from "./services/unidentifiedQuickService.js?v=20260915-unidentified-quick-1";
import { closeEventWithUnidentified } from "./services/closeWithUnidentifiedService.js?v=20260915-close-unidentified-1";

const INVENTORY_SESSION_KEY = "icelolly-sales-inventory-session";

function currentSessionId() {
  return String(localStorage.getItem(INVENTORY_SESSION_KEY) || "").trim();
}

function closeInventoryPanel() {
  const button = document.querySelector("#closeInventoryCountButton");
  if (button) {
    button.click();
    return;
  }
  location.reload();
}

async function enhancePanel(panel) {
  if (!panel || panel.dataset.unidentifiedFinalizeReady === "1") return;

  const sessionId = currentSessionId();
  if (!sessionId) return;

  panel.dataset.unidentifiedFinalizeReady = "loading";

  try {
    const summary = await loadUnidentifiedQuickSummary({ sessionId });
    if (!panel.isConnected || currentSessionId() !== sessionId) return;

    if (
      summary.sessionStatus !== "pending_allocation" ||
      summary.unresolvedTotal <= 0 ||
      !summary.closingComplete
    ) {
      panel.dataset.unidentifiedFinalizeReady = "1";
      return;
    }

    const note = document.createElement("div");
    note.style.marginTop = "12px";
    note.style.paddingTop = "12px";
    note.style.borderTop = "1px solid rgba(0,0,0,.1)";
    note.style.fontSize = "12px";
    note.style.lineHeight = "1.55";
    note.innerHTML = `
      <strong>未特定を残してイベントを正式終了できます。</strong><br>
      未特定 ${summary.unresolvedTotal} 点はSKU別販売・SKU別原価を未確定のまま保存します。棚卸で一意に確定できた分と手動特定分だけ正式在庫へ反映します。
    `;

    const button = document.createElement("button");
    button.type = "button";
    button.id = "closeWithUnidentifiedButton";
    button.className = "button";
    button.style.width = "100%";
    button.style.minHeight = "50px";
    button.style.marginTop = "10px";
    button.textContent = `未特定 ${summary.unresolvedTotal} 点を残して正式終了`;

    button.addEventListener("click", async () => {
      const ok = window.confirm(
        `未特定販売 ${summary.unresolvedTotal} 点を残したままイベントを正式終了します。\n\n` +
        "未特定分はSKU別販売・SKU別原価が未確定として保存され、推測で在庫を減らしません。\n" +
        "棚卸で確実に特定できた分だけ正式在庫へ反映します。\n\n" +
        "この内容で終了しますか？"
      );
      if (!ok) return;

      const originalText = button.textContent;
      button.disabled = true;
      button.textContent = "正式終了中…";

      try {
        const result = await closeEventWithUnidentified({
          sessionId,
          closedByEmail: ""
        });
        window.alert(
          `イベントを正式終了しました。\n未特定販売 ${result.unresolvedTotal ?? summary.unresolvedTotal} 点は未特定のまま保存されています。\n特定済みQuick ${result.identifiedQuickTotal ?? 0} 点と確定済み調整のみ在庫へ反映しました。`
        );
        localStorage.removeItem(INVENTORY_SESSION_KEY);
        closeInventoryPanel();
      } catch (error) {
        window.alert(error?.message || String(error));
        button.disabled = false;
        button.textContent = originalText;
      }
    });

    note.appendChild(button);
    panel.appendChild(note);
    panel.dataset.unidentifiedFinalizeReady = "1";
  } catch (error) {
    panel.dataset.unidentifiedFinalizeReady = "";
    console.warn("未特定あり正式終了の準備に失敗しました。", error);
  }
}

let scheduled = false;
function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    const panel = document.querySelector("#unidentifiedQuickSummaryPanel");
    if (panel) void enhancePanel(panel);
  });
}

schedule();
new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) schedule();
});
