const PANEL_ID = "inventoryFlowOverlay";
const ACTIVE_SESSION_KEY = "icelolly-sales-active-session";

let applying = false;

function text(value) {
  return String(value ?? "").trim();
}

function activeSessionId() {
  return text(localStorage.getItem(ACTIVE_SESSION_KEY));
}

function applyPreferredSession() {
  if (applying) return;

  const overlay = document.getElementById(PANEL_ID);
  const select = overlay?.querySelector("#ifSession");
  if (!overlay || !select || !select.options.length) return;

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

  if (select.value === activeId) return;

  applying = true;
  select.value = activeId;
  select.dispatchEvent(new Event("change", { bubbles: true }));
  window.setTimeout(() => {
    applying = false;
  }, 0);
}

function schedule() {
  requestAnimationFrame(applyPreferredSession);
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
