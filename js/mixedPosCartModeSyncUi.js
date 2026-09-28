const FAST_OVERLAY_ID = "fastPosOverlay";
const BRIDGE_KEY = "__icelollyPosCartBridge";

function text(value) {
  return String(value ?? "").trim();
}

function parseMoney(value) {
  const raw = text(value)
    .replace(/[^0-9.,-]/g, "")
    .replace(/,/g, "");
  if (!raw || raw === "-" || raw === ".") return null;
  const amount = Number(raw);
  return Number.isFinite(amount) ? Math.max(0, amount) : null;
}

function totalElements() {
  const label = [...document.querySelectorAll("strong")]
    .find(element =>
      !element.closest(`#${FAST_OVERLAY_ID}`) &&
      text(element.textContent).toUpperCase() === "TOTAL"
    );
  return {
    label: label || null,
    value: label?.nextElementSibling || null
  };
}

function currency() {
  return text(
    document.querySelector(`#${FAST_OVERLAY_ID} .fp-currency`)?.value ||
    localStorage.getItem("icelolly-sales-pos-currency") ||
    "JPY"
  ).toUpperCase();
}

function formatAmount(amount) {
  const code = currency();
  const digits = code === "JPY" ? 0 : 2;
  return `${code} ${Number(amount || 0).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  })}`;
}

function bridge() {
  return window[BRIDGE_KEY] || null;
}

function ensureKnownSubtotalBaseline() {
  const overlay = document.getElementById(FAST_OVERLAY_ID);
  if (!overlay) return null;

  const stored = Number(overlay.dataset.mixedKnownSubtotal);
  if (Number.isFinite(stored) && overlay.dataset.mixedKnownSubtotal !== "") {
    return Math.max(0, stored);
  }

  const displayed = parseMoney(totalElements().value?.textContent);
  if (displayed === null) return null;

  const representedFast = Number(bridge()?.fastAmount?.() || 0);
  const known = Math.max(0, displayed - representedFast);
  overlay.dataset.mixedKnownSubtotal = String(known);
  return known;
}

function reflectCombinedTotal(amount) {
  const overlay = document.getElementById(FAST_OVERLAY_ID);
  if (!overlay) return;

  const known = ensureKnownSubtotalBaseline();
  if (known === null) return;

  const target = totalElements().value;
  if (!target) return;
  target.textContent = formatAmount(known + Math.max(0, Number(amount || 0)));
}

function syncBeforeLeavingFast(mode) {
  if (mode === "fast") return;
  bridge()?.syncFromFastOverlay?.();
  bridge()?.refreshSummary?.();
}

// Capture before Fast POS keypad/mode target handlers so the existing
// Quick/SKU subtotal is remembered before the amount-only line changes.
document.addEventListener("click", event => {
  const target = event.target;
  if (!(target instanceof Element)) return;

  if (target.closest(`#${FAST_OVERLAY_ID} .fp-key`)) {
    ensureKnownSubtotalBaseline();
    return;
  }

  const choice = target.closest(`#${FAST_OVERLAY_ID} .fp-mode-choice`);
  if (choice) {
    syncBeforeLeavingFast(text(choice.dataset.mode));
  }
}, true);

document.addEventListener("icelolly:fast-cart-changed", event => {
  reflectCombinedTotal(event.detail?.amount || 0);
}, false);

const observer = new MutationObserver(() => {
  const overlay = document.getElementById(FAST_OVERLAY_ID);
  if (!overlay) return;
  ensureKnownSubtotalBaseline();
  bridge()?.refreshSummary?.();
});

observer.observe(document.body, { childList: true, subtree: true });
