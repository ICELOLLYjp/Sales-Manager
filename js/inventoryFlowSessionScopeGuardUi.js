const PANEL_ID = "inventoryFlowOverlay";
const EMPTY_CLASS = "if-session-scope-empty";

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
    card.querySelector(".if-tshirt-stock-commit")?.remove();

    if (!card.classList.contains("if-tshirt-fallback-card")) return;

    const note = card.querySelector(".if-tshirt-fallback-note");
    if (note) {
      note.textContent = "このSessionには開始在庫が登録されていません。会社全体の現在庫はここには表示しません。イベント在庫運用では、このSessionに登録された開始在庫と、その後の補充・修正・販売だけを表示します。";
    }

    card.querySelector(".if-matrix-wrap")?.remove();

    if (!card.querySelector(`.${EMPTY_CLASS}`)) {
      const empty = document.createElement("div");
      empty.className = `if-empty ${EMPTY_CLASS}`;
      empty.textContent = "このSessionのTシャツ開始在庫は未登録です。";
      card.appendChild(empty);
    }
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
