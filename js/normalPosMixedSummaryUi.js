const BRIDGE_KEY = "__icelollyPosCartBridge";
const FAST_OVERLAY_ID = "fastPosOverlay";
const SUMMARY_ID = "normalCombinedCartSummary";
const STYLE_ID = "normalCombinedCartSummaryStyles";

let scheduled = false;

function text(value) {
  return String(value ?? "").trim();
}

function number(value) {
  const result = Number(value);
  return Number.isFinite(result) ? Math.max(0, result) : 0;
}

function esc(value) {
  return text(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function bridge() {
  return window[BRIDGE_KEY] || null;
}

function currency() {
  return text(localStorage.getItem("icelolly-sales-pos-currency") || "JPY").toUpperCase();
}

function formatAmount(value) {
  const code = currency();
  const digits = code === "JPY" ? 0 : 2;
  return `${code} ${number(value).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  })}`;
}

function parseMoney(value) {
  const raw = text(value)
    .replace(/[^0-9.,-]/g, "")
    .replace(/,/g, "");
  if (!raw || raw === "-" || raw === ".") return null;
  const result = Number(raw);
  return Number.isFinite(result) ? Math.max(0, result) : null;
}

function normalDisplayedTotal() {
  const checkoutTitle = Array.from(document.querySelectorAll(".card-title"))
    .find(element => element.textContent?.trim() === "会計");
  const checkoutCard = checkoutTitle?.closest("section.card");
  if (!checkoutCard) return null;

  const label = Array.from(checkoutCard.querySelectorAll("strong"))
    .find(element => text(element.textContent).toUpperCase() === "TOTAL");
  return parseMoney(label?.nextElementSibling?.textContent);
}

function itemMode(item) {
  const key = text(item?.key);
  return key.startsWith("sku:") || key.startsWith("tshirt:") ? "SKU" : "Quick";
}

function lineLabel(item) {
  return text(item?.label || item?.detail || item?.category || item?.key || "商品");
}

function fallbackKnownSubtotal(items) {
  return items.reduce((sum, item) => {
    const qty = Math.max(0, Number(item?.quantity || 0));
    const unit = number(item?.unitPrice || 0);
    const discount = number(item?.manualDiscount || 0);
    return sum + Math.max(0, unit * qty - discount);
  }, 0);
}

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    #normalFastAmountSummary{display:none!important}
    #${SUMMARY_ID}{
      margin:0 auto 12px!important;
      border:1px solid #d9d5ff!important;
      background:#fbfaff!important;
      box-shadow:none!important;
    }
    #${SUMMARY_ID} .mixed-summary-row{
      display:flex;
      justify-content:space-between;
      gap:10px;
      align-items:flex-start;
      padding:6px 0;
      border-bottom:1px solid #eceaf8;
      font-size:12px;
      line-height:1.35;
    }
    #${SUMMARY_ID} .mixed-summary-fast{color:#5148e5}
    #${SUMMARY_ID} .mixed-summary-total{
      display:flex;
      justify-content:space-between;
      gap:10px;
      padding-top:9px;
      margin-top:3px;
      border-top:2px solid #d9d5ff;
      font-size:18px;
      font-weight:900;
    }
  `;
  document.head.appendChild(style);
}

function findAnchor() {
  const quick = document.getElementById("posModeQuick");
  const sku = document.getElementById("posModeSku");
  if (!quick || !sku) return null;

  const modeRow = quick.parentElement;
  if (!modeRow || sku.parentElement !== modeRow) return null;

  const caption = modeRow.nextElementSibling;
  return caption?.classList.contains("fp-mode-caption-top")
    ? caption
    : modeRow;
}

function render() {
  installStyles();

  const existing = document.getElementById(SUMMARY_ID);
  if (document.getElementById(FAST_OVERLAY_ID)) {
    existing?.remove();
    return;
  }

  const anchor = findAnchor();
  if (!anchor) {
    existing?.remove();
    return;
  }

  const cartBridge = bridge();
  const fastItem = cartBridge?.currentItem?.() || null;
  const fastAmount = number(fastItem?.unitPrice || 0);

  // The normal checkout already shows Quick/SKU-only carts. Add this compact
  // summary only when a Fast amount is mixed in, which keeps normal navigation
  // light and avoids duplicating the checkout card unnecessarily.
  if (fastAmount <= 0) {
    existing?.remove();
    return;
  }

  const items = Array.isArray(cartBridge?.knownItems?.())
    ? cartBridge.knownItems()
    : [];

  let summary = existing;
  if (!summary) {
    summary = document.createElement("section");
    summary.id = SUMMARY_ID;
    summary.className = "card";
    anchor.insertAdjacentElement("afterend", summary);
  } else if (summary.previousElementSibling !== anchor) {
    anchor.insertAdjacentElement("afterend", summary);
  }

  const displayedTotal = normalDisplayedTotal();
  const fallbackKnown = fallbackKnownSubtotal(items);
  const total = displayedTotal === null
    ? fallbackKnown + fastAmount
    : displayedTotal;
  const knownNet = Math.max(0, total - fastAmount);

  const signature = JSON.stringify({
    mode: localStorage.getItem("icelolly-sales-pos-mode") || "quick",
    currency: currency(),
    items: items.map(item => [
      text(item?.key),
      Number(item?.quantity || 0),
      number(item?.unitPrice || 0),
      number(item?.manualDiscount || 0)
    ]),
    fastAmount,
    total,
    knownNet
  });

  if (summary.dataset.signature === signature) return;
  summary.dataset.signature = signature;

  const detailRows = items.map(item => `
    <div class="mixed-summary-row">
      <span><strong>${esc(itemMode(item))}</strong> ${esc(lineLabel(item))} × ${Math.max(0, Number(item?.quantity || 0))}</span>
    </div>
  `).join("");

  summary.innerHTML = `
    <div style="font-size:16px;font-weight:900;margin-bottom:7px">会計内訳</div>
    ${detailRows || `<div style="padding:4px 0 7px;color:#777;font-size:11px">Quick / SKU の商品はまだありません</div>`}
    <div class="mixed-summary-row mixed-summary-fast">
      <span><strong>最速・金額入力</strong></span>
      <strong>${esc(formatAmount(fastAmount))}</strong>
    </div>
    <div style="display:flex;justify-content:space-between;gap:10px;padding:8px 0 4px;font-size:12px">
      <span>Quick / SKU 分</span>
      <strong>${esc(formatAmount(knownNet))}</strong>
    </div>
    <div class="mixed-summary-total">
      <span>TOTAL</span>
      <strong>${esc(formatAmount(total))}</strong>
    </div>
    <div style="margin-top:7px;font-size:10px;line-height:1.45;color:#6b6596">このTOTALが下の会計確定・Stripe QRに使われます。</div>
  `;
}

function schedule(delay = 0) {
  if (delay > 0) {
    window.setTimeout(() => schedule(), delay);
    return;
  }
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    render();
  });
}

const view = document.getElementById("view");
if (view) {
  new MutationObserver(() => schedule()).observe(view, {
    childList: true,
    subtree: true
  });
}

document.addEventListener("icelolly:fast-cart-changed", () => schedule(20));
document.addEventListener("icelolly:fast-cart-released", () => schedule(40));
document.addEventListener("click", event => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (target.closest("#posModeQuick,#posModeSku,.fp-mode-choice,.posQtyButton,.posQuickItem,.posSkuItem")) {
    schedule(20);
    schedule(100);
  }
}, true);

document.addEventListener("input", event => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (target.matches(".posLineDiscountInput,#posOrderDiscount")) {
    schedule(40);
  }
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) schedule(50);
});

schedule(100);
