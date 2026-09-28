import "./inventoryFlowSessionTshirtRecoveryUi.js?v=20260928-session-recovery-1";

const PANEL_ID = "inventoryFlowOverlay";

function text(value) {
  return String(value ?? "").trim();
}

function tshirtCards(overlay) {
  return [...overlay.querySelectorAll(":scope .if-card")]
    .filter(card => text(card.querySelector("h3")?.textContent) === "Tシャツ在庫ボード");
}

function enforceSessionScope() {
  const overlay = document.getElementById(PANEL_ID);
  if (!overlay) return;

  tshirtCards(overlay).forEach(card => {
    /*
     * Event inventory must never mutate company-wide T-shirt stock directly.
     * The recovery module may rebuild a Session-scoped board, but the old
     * company-stock commit action is always removed.
     */
    card.querySelector(".if-tshirt-stock-commit")?.remove();
  });
}

let scheduled = false;
function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    enforceSessionScope();
  });
}

schedule();
new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
document.addEventListener("change", event => {
  if (event.target?.id === "ifSession") schedule();
}, true);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) schedule();
});
window.addEventListener("focus", schedule);
