const PANEL_ID = "inventoryFlowOverlay";
const ACTIVE_SESSION_KEY = "icelolly-sales-active-session";
const APPLY_DELAY_MS = 300;
const TSHIRT_RETRY_DELAY_MS = 900;

let applying = false;
let scheduleTimer = null;
let currentOverlay = null;
let manualSessionId = "";

function text(value) {
  return String(value ?? "").trim();
}

function activeSessionId() {
  return text(localStorage.getItem(ACTIVE_SESSION_KEY));
}

function tshirtCardExists(overlay) {
  return Array.from(overlay.querySelectorAll(".if-card h3"))
    .some(heading => text(heading.textContent) === "Tシャツ在庫ボード");
}

function openingInventoryMissing(overlay) {
  return Array.from(overlay.querySelectorAll(".if-warning"))
    .some(item => text(item.textContent).includes("開始在庫がありません"));
}

function bindManualSelection(select) {
  if (select.dataset.inventorySessionPriorityBound === "1") return;
  select.dataset.inventorySessionPriorityBound = "1";
  select.addEventListener("change", () => {
    if (applying) return;
    manualSessionId = text(select.value);
  });
}

function scheduleTshirtRecovery(overlay, sessionId) {
  if (!overlay || !sessionId) return;
  if (overlay.dataset.tshirtRecoveryScheduled === sessionId) return;
  overlay.dataset.tshirtRecoveryScheduled = sessionId;

  window.setTimeout(() => {
    if (!overlay.isConnected) return;

    const select = overlay.querySelector("#ifSession");
    if (!select || text(select.value) !== sessionId) return;
    if (tshirtCardExists(overlay) || openingInventoryMissing(overlay)) return;
    if (overlay.dataset.tshirtRecoveryRetried === sessionId) return;

    overlay.dataset.tshirtRecoveryRetried = sessionId;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }, TSHIRT_RETRY_DELAY_MS);
}

function applyPreferredSession() {
  const overlay = document.getElementById(PANEL_ID);
  const select = overlay?.querySelector("#ifSession");
  if (!overlay || !select || !select.options.length) return;

  if (overlay !== currentOverlay) {
    currentOverlay = overlay;
    manualSessionId = "";
  }

  bindManualSelection(select);

  const activeId = activeSessionId();
  if (!activeId) return;

  const options = Array.from(select.options);
  const activeOption = options.find(option => option.value === activeId);
  if (!activeOption) return;

  options.forEach(option => {
    const baseLabel = option.dataset.baseLabel || option.textContent || "";
    option.dataset.baseLabel = baseLabel.replace(/^販売中\s*・\s*/, "");
    option.textContent = option.value === activeId
      ? `販売中 ・ ${option.dataset.baseLabel}`
      : option.dataset.baseLabel;
  });

  if (select.options[0] !== activeOption) {
    select.insertBefore(activeOption, select.options[0] || null);
  }

  if (manualSessionId && options.some(option => option.value === manualSessionId)) {
    scheduleTshirtRecovery(overlay, text(select.value));
    return;
  }

  if (text(select.value) !== activeId && overlay.dataset.activeSessionApplied !== activeId) {
    overlay.dataset.activeSessionApplied = activeId;
    applying = true;
    select.value = activeId;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    window.setTimeout(() => {
      applying = false;
    }, 0);
  }

  scheduleTshirtRecovery(overlay, activeId);
}

function schedule() {
  if (scheduleTimer) window.clearTimeout(scheduleTimer);
  scheduleTimer = window.setTimeout(() => {
    scheduleTimer = null;
    applyPreferredSession();
  }, APPLY_DELAY_MS);
}

schedule();
new MutationObserver(schedule).observe(document.body, {
  childList: true,
  subtree: true
});

window.addEventListener("storage", event => {
  if (event.key === ACTIVE_SESSION_KEY) schedule();
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) schedule();
});
