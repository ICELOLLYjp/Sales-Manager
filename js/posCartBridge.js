(function () {
  const BRIDGE_KEY = "__icelollyPosCartBridge";
  if (window[BRIDGE_KEY]) return;

  const FAST_KEY = "fast:amount";
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
  let scheduledPolish = false;

  function text(value) {
    return String(value ?? "").trim();
  }

  function number(value) {
    const result = Number(value);
    return Number.isFinite(result) ? Math.max(0, result) : 0;
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

  function knownQuantity() {
    return cartValues()
      .filter(item => text(item?.key) !== FAST_KEY)
      .reduce((sum, item) => sum + Math.max(0, Number(item?.quantity || 0)), 0);
  }

  function hasOtherItems() {
    return cartValues().some(item =>
      text(item?.key) !== FAST_KEY &&
      Number(item?.quantity || 0) > 0
    );
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

    schedulePolish();
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
    }
    return result;
  };

  Map.prototype.delete = function patchedPosCartDelete(key) {
    const result = nativeDelete.call(this, key);
    if (this === cart && text(key) === FAST_KEY) {
      schedulePolish();
    }
    return result;
  };

  function setFastAmount(amount, hint = lastHint) {
    const cleanAmount = number(amount);
    lastHint = text(hint) || "unclassified";

    if (!cart) {
      return false;
    }

    if (cleanAmount <= 0) {
      nativeDelete.call(cart, FAST_KEY);
      dispatch("icelolly:fast-cart-changed", {
        amount: 0,
        hint: lastHint
      });
      schedulePolish();
      return true;
    }

    nativeSet.call(cart, FAST_KEY, fastItem(cleanAmount, lastHint));
    dispatch("icelolly:fast-cart-changed", {
      amount: cleanAmount,
      hint: lastHint
    });
    schedulePolish();
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
      schedulePolish();
    }
    return existed;
  }

  function fastAmount() {
    return number(currentFastItem()?.unitPrice || 0);
  }

  function parseDisplayedAmount() {
    const amountElement = document.querySelector("#fastPosOverlay #fpAmount");
    if (!amountElement) return 0;
    const raw = text(amountElement.textContent)
      .replace(/[^0-9.,-]/g, "")
      .replace(/,/g, "");
    return number(raw);
  }

  function currentHint() {
    return text(
      document.querySelector("#fastPosOverlay .fp-hint.active")?.dataset?.hint ||
      lastHint ||
      "unclassified"
    );
  }

  function formatAmount(value) {
    const currency = text(
      document.querySelector("#fastPosOverlay .fp-currency")?.value ||
      localStorage.getItem("icelolly-sales-pos-currency") ||
      "JPY"
    );
    const digits = currency === "JPY" ? 0 : 2;
    return `${currency} ${number(value).toLocaleString(undefined, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    })}`;
  }

  function syncFromFastOverlay() {
    const overlay = document.getElementById("fastPosOverlay");
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

    note.textContent = amount > 0
      ? `${formatAmount(amount)} をQuick・SKUと同じ会計に合算します。`
      : "金額を入力するとQuick・SKUと同じ会計に合算できます。";
  }

  function polishNormalCart() {
    const fastMinus = document.querySelector(`.posQtyButton[data-key="${FAST_KEY}"]`);
    const row = fastMinus?.closest(".list-row");

    if (row) {
      row.dataset.fastAmountLine = "true";

      const controls = fastMinus.parentElement;
      if (controls) {
        controls.style.display = "none";
      }

      const discountInput = row.querySelector(`.posLineDiscountInput[data-key="${FAST_KEY}"]`);
      const discountLabel = discountInput?.closest("label");
      if (discountLabel) {
        discountLabel.style.display = "none";
      }

      const detail = row.querySelector(".muted");
      if (detail && !detail.dataset.fastAmountPolished) {
        detail.dataset.fastAmountPolished = "true";
      }
    }

    const cards = Array.from(document.querySelectorAll("section.card"));
    const checkoutCard = cards.find(section =>
      section.querySelector(".card-title")?.textContent?.trim() === "会計"
    );

    if (checkoutCard && currentFastItem()) {
      const heading = checkoutCard.querySelector(".card-title")?.parentElement;
      const count = heading?.lastElementChild;
      if (count && count !== heading?.firstElementChild) {
        const known = knownQuantity();
        count.textContent = known > 0
          ? `${known} 点 + 金額入力`
          : "金額入力";
      }
    }
  }

  function schedulePolish() {
    if (scheduledPolish) return;
    scheduledPolish = true;
    requestAnimationFrame(() => {
      scheduledPolish = false;
      polishNormalCart();
      const overlay = document.getElementById("fastPosOverlay");
      if (overlay && !overlay.dataset.fastCartBridgeReady) {
        overlay.dataset.fastCartBridgeReady = "true";
        const existing = fastAmount();
        if (existing > 0) {
          const note = document.createElement("div");
          note.id = "fastExistingCartAmount";
          note.style.cssText = "margin:0 10px 8px;padding:8px 10px;border-radius:10px;background:#fff8df;font-size:11px;font-weight:700;line-height:1.45";
          note.textContent = `カートには最速入力 ${formatAmount(existing)} が入っています。新しく入力すると置き換わります。`;
          overlay.querySelector(".fp-wrap")?.prepend(note);
        }
      }
    });
  }

  document.addEventListener("click", event => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    if (target.closest("#fastPosOverlay .fp-key")) {
      window.setTimeout(syncFromFastOverlay, 0);
      return;
    }

    if (target.closest("#fastPosOverlay .fp-hint")) {
      window.setTimeout(() => {
        lastHint = currentHint();
        const amount = parseDisplayedAmount();
        if (amount > 0) setFastAmount(amount, lastHint);
        schedulePolish();
      }, 0);
    }
  }, false);

  document.addEventListener("click", event => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const checkoutButton = target.closest("#fastPosOverlay #fpManual, #fastPosOverlay #fpStripe");
    if (!checkoutButton) return;

    if (hasOtherItems()) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      window.alert("最速入力はQuick・SKUの商品と同じカートに入っています。QuickまたはSKUへ切り替えて、合計金額から会計してください。");
    }
  }, true);

  const observer = new MutationObserver(() => {
    schedulePolish();

    const overlay = document.getElementById("fastPosOverlay");
    if (!overlay) return;

    const success = overlay.querySelector(".fp-status.ok")?.textContent || "";
    if (
      success.includes("会計しました") ||
      success.includes("オフライン会計として保存") ||
      success.includes("Stripe支払い完了")
    ) {
      clearFastAmount();
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true
  });

  window[BRIDGE_KEY] = {
    key: FAST_KEY,
    setFastAmount,
    clearFastAmount,
    fastAmount,
    hasOtherItems,
    knownQuantity,
    currentItem: currentFastItem
  };

  schedulePolish();
})();