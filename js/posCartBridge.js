(function () {
  const BRIDGE_KEY = "__icelollyPosCartBridge";
  if (window[BRIDGE_KEY]) return;

  const FAST_KEY = "fast:amount";
  const FAST_OVERLAY_ID = "fastPosOverlay";
  const KNOWN_QUICK_KEYS = new Set([
    "pierce",
    "earring",
    "drop_pierce",
    "drop_earring",
    "sticker",
    "postcard",
    "art_print"
  ]);

  const nativeGet = Map.prototype.get;
  const nativeSet = Map.prototype.set;
  const nativeDelete = Map.prototype.delete;
  const nativeHas = Map.prototype.has;
  const nativeValues = Map.prototype.values;

  let cart = null;
  let lastHint = "unclassified";
  let scheduledUi = false;
  let observedOverlay = null;
  let overlayObserver = null;
  let overlayWatchTimer = 0;

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

  function isCartKey(key) {
    const value = text(key);
    return value === FAST_KEY ||
      value.startsWith("sku:") ||
      value.startsWith("tshirt:") ||
      KNOWN_QUICK_KEYS.has(value);
  }

  function isCartItem(value) {
    return Boolean(
      value &&
      typeof value === "object" &&
      text(value.key) &&
      text(value.category) &&
      Object.prototype.hasOwnProperty.call(value, "quantity") &&
      Object.prototype.hasOwnProperty.call(value, "unitPrice")
    );
  }

  function fastLabel(hint) {
    switch (text(hint)) {
      case "tshirt":
        return "未分類売上（Tシャツ）";
      case "accessory":
        return "未分類売上（アクセサリー）";
      case "other":
        return "未分類売上（その他）";
      default:
        return "未分類売上";
    }
  }

  function fastItem(amount, hint) {
    return {
      key: FAST_KEY,
      category: "unclassified",
      label: fastLabel(hint),
      detail: "最速POS 金額入力",
      quantity: 1,
      unitPrice: number(amount),
      manualDiscount: 0,
      trackingMode: "amount_only",
      physicalQuantityKnown: false,
      variantId: null,
      inventoryKey: null,
      inventorySource: null
    };
  }

  function cartValues(target = cart) {
    if (!target) return [];
    try {
      return Array.from(nativeValues.call(target));
    } catch {
      return [];
    }
  }

  function knownItems() {
    return cartValues().filter(item =>
      text(item?.key) !== FAST_KEY &&
      Number(item?.quantity || 0) > 0
    );
  }

  function knownQuantity() {
    return knownItems().reduce(
      (sum, item) => sum + Math.max(0, Number(item?.quantity || 0)),
      0
    );
  }

  function hasOtherItems() {
    return knownItems().length > 0;
  }

  function currentFastItem() {
    if (!cart) return null;
    return nativeGet.call(cart, FAST_KEY) || null;
  }

  function dispatch(name, detail = {}) {
    document.dispatchEvent(new CustomEvent(name, { detail }));
  }

  function captureCart(candidate) {
    if (!candidate || candidate === cart) return;

    const previous = cart;
    const previousHadFast = previous
      ? nativeHas.call(previous, FAST_KEY)
      : false;

    cart = candidate;

    if (previousHadFast) {
      dispatch("icelolly:fast-cart-released", {
        sessionId: text(localStorage.getItem("icelolly-sales-active-session"))
      });
    }

    scheduleUi();
  }

  Map.prototype.get = function patchedPosCartGet(key) {
    const value = nativeGet.call(this, key);
    if (isCartKey(key) && (value === undefined || isCartItem(value))) {
      captureCart(this);
    }
    return value;
  };

  Map.prototype.set = function patchedPosCartSet(key, value) {
    const result = nativeSet.call(this, key, value);
    if (isCartKey(key) && isCartItem(value)) {
      captureCart(this);
      scheduleUi();
    }
    return result;
  };

  Map.prototype.delete = function patchedPosCartDelete(key) {
    const result = nativeDelete.call(this, key);
    if (this === cart && isCartKey(key)) {
      scheduleUi();
    }
    return result;
  };

  Map.prototype.values = function patchedPosCartValues() {
    // Stack inspection is intentionally only used until the app POS cart is
    // captured. Repeating Error().stack on every Map.values() call made route
    // changes noticeably slower on iPhone.
    if (!cart) {
      const stack = String(new Error().stack || "");
      if (stack.includes("posCartTotals")) {
        captureCart(this);
      }
    }
    return nativeValues.call(this);
  };

  function setFastAmount(amount, hint = lastHint) {
    const cleanAmount = number(amount);
    lastHint = text(hint) || "unclassified";

    if (!cart) return false;

    if (cleanAmount <= 0) {
      nativeDelete.call(cart, FAST_KEY);
      dispatch("icelolly:fast-cart-changed", {
        amount: 0,
        hint: lastHint
      });
      scheduleUi();
      return true;
    }

    nativeSet.call(cart, FAST_KEY, fastItem(cleanAmount, lastHint));
    dispatch("icelolly:fast-cart-changed", {
      amount: cleanAmount,
      hint: lastHint
    });
    scheduleUi();
    return true;
  }

  function clearFastAmount() {
    if (!cart) return false;
    const existed = nativeHas.call(cart, FAST_KEY);
    nativeDelete.call(cart, FAST_KEY);
    if (existed) {
      dispatch("icelolly:fast-cart-changed", {
        amount: 0,
        hint: lastHint
      });
      scheduleUi();
    }
    return existed;
  }

  function fastAmount() {
    return number(currentFastItem()?.unitPrice || 0);
  }

  function parseDisplayedAmount() {
    const amountElement = document.querySelector(`#${FAST_OVERLAY_ID} #fpAmount`);
    if (!amountElement) return 0;
    const raw = text(amountElement.textContent)
      .replace(/[^0-9.,-]/g, "")
      .replace(/,/g, "");
    return number(raw);
  }

  function currentHint() {
    return text(
      document.querySelector(`#${FAST_OVERLAY_ID} .fp-hint.active`)?.dataset?.hint ||
      lastHint ||
      "unclassified"
    );
  }

  function currentCurrency() {
    return text(
      document.querySelector(`#${FAST_OVERLAY_ID} .fp-currency`)?.value ||
      localStorage.getItem("icelolly-sales-pos-currency") ||
      "JPY"
    ).toUpperCase();
  }

  function formatAmount(value) {
    const currency = currentCurrency();
    const digits = currency === "JPY" ? 0 : 2;
    return `${currency} ${number(value).toLocaleString(undefined, {
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
    const labels = Array.from(document.querySelectorAll("strong"));
    const totalLabel = labels.find(element =>
      !element.closest(`#${FAST_OVERLAY_ID}`) &&
      !element.closest("#normalCombinedCartSummary") &&
      text(element.textContent).toUpperCase() === "TOTAL"
    );
    return parseMoney(totalLabel?.nextElementSibling?.textContent);
  }

  function fallbackKnownSubtotal() {
    return knownItems().reduce((sum, item) => {
      const quantity = Math.max(0, Number(item?.quantity || 0));
      const unitPrice = number(item?.unitPrice || 0);
      const discount = number(item?.manualDiscount || 0);
      return sum + Math.max(0, unitPrice * quantity - discount);
    }, 0);
  }

  function knownSubtotal() {
    const displayed = normalDisplayedTotal();
    if (displayed !== null) {
      return Math.max(0, displayed - fastAmount());
    }
    return fallbackKnownSubtotal();
  }

  function itemMode(item) {
    const key = text(item?.key);
    return key.startsWith("sku:") || key.startsWith("tshirt:")
      ? "SKU"
      : "Quick";
  }

  function lineLabel(item) {
    return text(item?.label || item?.detail || item?.category || item?.key || "商品");
  }

  function syncFromFastOverlay() {
    const overlay = document.getElementById(FAST_OVERLAY_ID);
    if (!overlay) return;

    const amount = parseDisplayedAmount();
    setFastAmount(amount, currentHint());

    let note = overlay.querySelector("#fastMixedCartNote");
    if (!note) {
      note = document.createElement("div");
      note.id = "fastMixedCartNote";
      note.style.cssText = [
        "margin-top:8px",
        "padding:8px 10px",
        "border-radius:10px",
        "background:#f4f2ff",
        "color:#4f49a8",
        "font-size:11px",
        "font-weight:700",
        "line-height:1.45"
      ].join(";");
      overlay.querySelector(".fp-card")?.appendChild(note);
    }

    const nextText = amount > 0
      ? `${formatAmount(amount)} をQuick・SKUと同じ会計に合算します。`
      : "金額を入力するとQuick・SKUと同じ会計に合算できます。";

    if (note.textContent !== nextText) {
      note.textContent = nextText;
    }

    renderFastCartSummary();
  }

  function renderFastCartSummary() {
    const overlay = document.getElementById(FAST_OVERLAY_ID);
    if (!overlay) return;
    const wrap = overlay.querySelector(".fp-wrap");
    if (!wrap) return;

    const items = knownItems();
    const amount = fastAmount();
    let summary = overlay.querySelector("#fastCombinedCartSummary");

    if (!items.length && amount <= 0) {
      summary?.remove();
      return;
    }

    if (!summary) {
      summary = document.createElement("section");
      summary.id = "fastCombinedCartSummary";
      summary.className = "fp-card";
      summary.style.cssText = "border-color:#d9d5ff;background:#fbfaff";
      wrap.prepend(summary);
    }

    const knownTotal = knownSubtotal();
    const combined = knownTotal + amount;
    const signature = JSON.stringify({
      currency: currentCurrency(),
      amount,
      knownTotal,
      items: items.map(item => [
        text(item?.key),
        Number(item?.quantity || 0),
        number(item?.unitPrice || 0),
        number(item?.manualDiscount || 0)
      ])
    });

    // Do not rewrite innerHTML when nothing changed. The old implementation
    // rewrote this section on every observed DOM mutation, which created a
    // self-sustaining MutationObserver loop and slowed all navigation.
    if (summary.dataset.signature === signature) return;
    summary.dataset.signature = signature;

    const detailRows = items.length
      ? items.map(item => `
          <div style="display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-bottom:1px solid #eceaf8;font-size:11px;line-height:1.35">
            <span style="min-width:0"><strong>${esc(itemMode(item))}</strong> ${esc(lineLabel(item))} × ${Math.max(0, Number(item?.quantity || 0))}</span>
          </div>
        `).join("")
      : `<div style="padding:5px 0;color:#777;font-size:11px">Quick / SKU の商品はまだありません</div>`;

    summary.innerHTML = `
      <div style="font-size:13px;font-weight:900;margin-bottom:6px">会計内訳</div>
      ${detailRows}
      <div style="display:flex;justify-content:space-between;gap:10px;padding:7px 0 4px;font-size:12px">
        <span>Quick / SKU 小計</span>
        <strong>${esc(formatAmount(knownTotal))}</strong>
      </div>
      <div style="display:flex;justify-content:space-between;gap:10px;padding:4px 0 7px;font-size:12px;color:#5148e5">
        <span>最速・金額入力</span>
        <strong>${esc(formatAmount(amount))}</strong>
      </div>
      <div style="display:flex;justify-content:space-between;gap:10px;padding-top:8px;border-top:2px solid #d9d5ff;font-size:17px;font-weight:900">
        <span>TOTAL</span>
        <strong>${esc(formatAmount(combined))}</strong>
      </div>
      ${items.length ? `<div style="margin-top:7px;font-size:10px;line-height:1.45;color:#6b6596">Quick / SKUの商品を含む場合は、QuickまたはSKUへ戻ってこのTOTALで会計します。</div>` : ""}
    `;
  }

  function polishNormalFastRow() {
    if (!document.getElementById("posModeQuick") && !document.getElementById("posModeSku")) {
      return;
    }

    const fastMinus = document.querySelector(`.posQtyButton[data-key="${FAST_KEY}"]`);
    const row = fastMinus?.closest(".list-row");
    if (!row) return;

    row.dataset.fastAmountLine = "true";
    row.style.borderColor = "#d9d5ff";
    row.style.background = "#fbfaff";

    const controls = fastMinus.parentElement;
    if (controls) controls.style.display = "none";

    const discountInput = row.querySelector(`.posLineDiscountInput[data-key="${FAST_KEY}"]`);
    const discountLabel = discountInput?.closest("label");
    if (discountLabel) discountLabel.style.display = "none";

    const checkoutCard = row.closest("section.card");
    const heading = checkoutCard?.querySelector(".card-title")?.parentElement;
    const count = heading?.lastElementChild;
    if (count && count !== heading?.firstElementChild) {
      const known = knownQuantity();
      const nextText = known > 0 ? `${known} 点 + 金額入力` : "金額入力";
      if (count.textContent !== nextText) count.textContent = nextText;
    }
  }

  function initializeFastOverlay(overlay) {
    if (!overlay || overlay.dataset.fastCartBridgeReady === "true") return;
    overlay.dataset.fastCartBridgeReady = "true";

    const existing = fastAmount();
    if (existing > 0) {
      const amountElement = overlay.querySelector("#fpAmount");
      if (amountElement && parseDisplayedAmount() <= 0) {
        amountElement.textContent = formatAmount(existing);
      }

      if (!overlay.querySelector("#fastExistingCartAmount")) {
        const note = document.createElement("div");
        note.id = "fastExistingCartAmount";
        note.style.cssText = "margin:0 10px 8px;padding:8px 10px;border-radius:10px;background:#fff8df;font-size:11px;font-weight:700;line-height:1.45";
        note.textContent = `カートには最速入力 ${formatAmount(existing)} が入っています。新しく入力すると置き換わります。`;
        overlay.querySelector(".fp-wrap")?.prepend(note);
      }
    }
  }

  function checkFastCheckoutSuccess(overlay) {
    const success = overlay?.querySelector(".fp-status.ok")?.textContent || "";
    if (
      success.includes("会計しました") ||
      success.includes("オフライン会計として保存") ||
      success.includes("Stripe支払い完了")
    ) {
      clearFastAmount();
    }
  }

  function scheduleUi() {
    if (scheduledUi) return;
    scheduledUi = true;
    requestAnimationFrame(() => {
      scheduledUi = false;
      polishNormalFastRow();
      const overlay = document.getElementById(FAST_OVERLAY_ID);
      if (overlay) {
        initializeFastOverlay(overlay);
        renderFastCartSummary();
        checkFastCheckoutSuccess(overlay);
      }
    });
  }

  function attachOverlayObserver() {
    const overlay = document.getElementById(FAST_OVERLAY_ID);
    if (overlay === observedOverlay) return Boolean(overlay);

    overlayObserver?.disconnect();
    overlayObserver = null;
    observedOverlay = overlay || null;

    if (!overlay) return false;

    overlayObserver = new MutationObserver(() => {
      scheduleUi();
    });
    overlayObserver.observe(overlay, {
      childList: true,
      subtree: true
    });
    scheduleUi();
    return true;
  }

  function watchForOverlay() {
    window.clearInterval(overlayWatchTimer);
    let attempts = 0;
    overlayWatchTimer = window.setInterval(() => {
      attempts += 1;
      if (attachOverlayObserver() || attempts >= 80) {
        window.clearInterval(overlayWatchTimer);
        overlayWatchTimer = 0;
      }
    }, 50);
  }

  document.addEventListener("click", event => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    if (target.closest("#fastPosOpenButton")) {
      watchForOverlay();
      return;
    }

    if (target.closest(`#${FAST_OVERLAY_ID} .fp-key`)) {
      window.setTimeout(syncFromFastOverlay, 0);
      return;
    }

    if (target.closest(`#${FAST_OVERLAY_ID} .fp-hint`)) {
      window.setTimeout(() => {
        lastHint = currentHint();
        const amount = parseDisplayedAmount();
        if (amount > 0) setFastAmount(amount, lastHint);
        scheduleUi();
      }, 0);
      return;
    }

    if (target.closest(`#${FAST_OVERLAY_ID} .fp-close, #${FAST_OVERLAY_ID} .fp-mode-choice`)) {
      window.setTimeout(attachOverlayObserver, 80);
    }
  }, false);

  document.addEventListener("click", event => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const checkoutButton = target.closest(
      `#${FAST_OVERLAY_ID} #fpManual, #${FAST_OVERLAY_ID} #fpStripe`
    );
    if (!checkoutButton || !hasOtherItems()) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    window.alert("Quick・SKUの商品も同じカートに入っています。上の会計内訳でTOTALを確認し、QuickまたはSKUへ切り替えて会計してください。");
  }, true);

  const view = document.getElementById("view");
  if (view) {
    new MutationObserver(() => {
      if (document.getElementById("posModeQuick") || document.getElementById("posModeSku")) {
        scheduleUi();
      }
    }).observe(view, {
      childList: true,
      subtree: true
    });
  }

  window[BRIDGE_KEY] = {
    key: FAST_KEY,
    setFastAmount,
    clearFastAmount,
    fastAmount,
    hasOtherItems,
    knownQuantity,
    knownItems: () => knownItems().map(item => ({ ...item })),
    currentItem: currentFastItem,
    syncFromFastOverlay,
    refreshSummary: scheduleUi
  };

  attachOverlayObserver();
  scheduleUi();
})();
