const PANEL_ID = "inventoryFlowOverlay";
const ACTIVE_SESSION_KEY = "icelolly-sales-active-session";
const APPLY_DELAY_MS = 80;
const RECOVERY_DELAYS_MS = [250, 700, 1600];

let applying = false;
let scheduleTimer = null;
let currentOverlay = null;
let manualSessionId = "";
let userSelecting = false;

function text(value) {
  return String(value ?? "").trim();
}

function activeSessionId() {
  return text(localStorage.getItem(ACTIVE_SESSION_KEY));
}

function hasTshirtRows(overlay) {
  const heading = Array.from(overlay.querySelectorAll(".if-card h3"))
    .find(item => text(item.textContent) === "Tシャツ在庫ボード");
  const card = heading?.closest(".if-card");
  return Boolean(card?.querySelector(".if-matrix tbody tr"));
}

function openingInventoryMissing(overlay) {
  return Array.from(overlay.querySelectorAll(".if-warning"))
    .some(item => text(item.textContent).includes("開始在庫がありません"));
}

function bindManualSelection(select) {
  if (select.dataset.inventorySessionPriorityBound === "1") return;
  select.dataset.inventorySessionPriorityBound = "1";

  const markUserIntent = () => {
    userSelecting = true;
  };

  select.addEventListener("pointerdown", markUserIntent, { capture: true });
  select.addEventListener("touchstart", markUserIntent, { capture: true, passive: true });
  select.addEventListener("keydown", markUserIntent, { capture: true });
  select.addEventListener("change", () => {
    if (applying) return;
    if (userSelecting) {
      manualSessionId = text(select.value);
    }
    userSelecting = false;
  });
}

function scheduleTshirtRecovery(overlay, sessionId) {
  if (!overlay || !sessionId) return;
  const key = `${sessionId}:${overlay.dataset.inventoryPriorityGeneration || "0"}`;
  if (overlay.dataset.tshirtRecoveryScheduled === key) return;
  overlay.dataset.tshirtRecoveryScheduled = key;

  RECOVERY_DELAYS_MS.forEach((delay, index) => {
    window.setTimeout(() => {
      if (!overlay.isConnected) return;
      const select = overlay.querySelector("#ifSession");
      if (!select || text(select.value) !== sessionId) return;
      if (hasTshirtRows(overlay) || openingInventoryMissing(overlay)) return;

      select.dispatchEvent(new Event("change", { bubbles: true }));

      if (index === RECOVERY_DELAYS_MS.length - 1) {
        window.setTimeout(() => {
          if (!overlay.isConnected) return;
          const current = overlay.querySelector("#ifSession");
          if (!current || text(current.value) !== sessionId) return;
          if (hasTshirtRows(overlay) || openingInventoryMissing(overlay)) return;
          overlay.dispatchEvent(new CustomEvent("inventory:tshirt-missing", {
            bubbles: true,
            detail: { sessionId }
          }));
        }, 250);
      }
    }, delay);
  });
}

function applyPreferredSession() {
  const overlay = document.getElementById(PANEL_ID);
  const select = overlay?.querySelector("#ifSession");
  if (!overlay || !select || !select.options.length) return;

  if (overlay !== currentOverlay) {
    currentOverlay = overlay;
    manualSessionId = "";
    userSelecting = false;
    overlay.dataset.inventoryPriorityGeneration = String(Date.now());
  }

  bindManualSelection(select);

  const activeId = activeSessionId();
  const options = Array.from(select.options);
  const activeOption = options.find(option => option.value === activeId);

  if (activeOption) {
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
  }

  const manualExists = manualSessionId &&
    options.some(option => option.value === manualSessionId);
  const preferredId = manualExists
    ? manualSessionId
    : activeOption
      ? activeId
      : text(select.value);

  if (preferredId && text(select.value) !== preferredId) {
    applying = true;
    select.value = preferredId;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    window.setTimeout(() => {
      applying = false;
    }, 0);
  }

  scheduleTshirtRecovery(overlay, preferredId);
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
