import { getFirebaseState } from "./firebase.js";
import { commitQuickSale } from "./services/transactionService.js?v=20260914-event-flow-pos-1";
import { enqueueOfflineSale, loadPosOfflineSnapshot } from "./services/offlineQueueService.js?v=20260911-offline-resilience-1";
import {
  createStripeCheckout,
  getStripeCheckoutStatus,
  expireStripeCheckout,
  markStripeSaleCommitted,
  renderStripeQr
} from "./services/stripePaymentService.js?v=20260912-stripe-live-short-ui-1";
import {
  fastAmountHintLabel,
  normalizeFastAmountTransaction,
  normalizeFastAmountSalesForSession
} from "./services/fastAmountSaleService.js?v=20260927-mixed-cart-1";

const DRAFT_KEY = "icelolly-sales-fast-cart-draft-v1";
const STYLE_ID = "mixedFastCartStyles";
let scheduled = false;
let checkoutBusy = false;
let suppressClearIntercept = false;
let normalizeTimer = 0;

function text(value) {
  return String(value ?? "").trim();
}

function number(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function activeSessionId() {
  return text(localStorage.getItem("icelolly-sales-active-session"));
}

function currentCurrency() {
  return text(document.querySelector("#posCurrency")?.value || localStorage.getItem("icelolly-sales-pos-currency") || "JPY").toUpperCase();
}

function currentEmail() {
  return text(getFirebaseState()?.auth?.currentUser?.email);
}

function moneyText(amount, currency = currentCurrency()) {
  const digits = currency === "JPY" ? 0 : 2;
  return `${currency} ${number(amount).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  })}`;
}

function parseMoney(value) {
  const normalized = text(value)
    .replaceAll("−", "-")
    .replaceAll(",", "")
    .replace(/[^0-9.\-]/g, " ");
  const matches = normalized.match(/-?\d+(?:\.\d+)?/g) || [];
  if (!matches.length) return 0;
  return number(matches[matches.length - 1]);
}

function createTransactionId() {
  if (globalThis.crypto?.randomUUID) return `sale_mixed_${globalThis.crypto.randomUUID()}`;
  return `sale_mixed_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .mixed-fast-row{background:#f7f6ff;border-radius:12px;padding:10px 12px!important;margin:6px 0}
    .mixed-fast-row strong{color:#5148e5}
    .mixed-fast-remove{min-height:36px;padding:0 12px;border:1px solid #d8d4ff;border-radius:10px;background:#fff;color:#5148e5;font-weight:800}
    .mixed-total-note{font-size:11px;color:#6d68a8;margin-top:4px;text-align:right}
    .mixed-checkout-overlay{position:fixed;inset:0;z-index:2147483400;background:rgba(0,0,0,.38);display:flex;align-items:center;justify-content:center;padding:20px}
    .mixed-checkout-card{width:min(420px,100%);max-height:88vh;overflow:auto;background:#fff;border-radius:20px;padding:20px;box-shadow:0 18px 60px rgba(0,0,0,.22)}
    .mixed-checkout-card h2{margin:0 0 8px;font-size:22px}
    .mixed-checkout-card .amount{font-size:30px;font-weight:900;margin:10px 0 14px}
    .mixed-checkout-card .qr{text-align:center;padding:8px 0 14px}
    .mixed-checkout-card button{width:100%;min-height:48px;border:0;border-radius:13px;font-weight:800}
    .mixed-checkout-card .secondary{margin-top:9px;border:1px solid #ddd;background:#fff;color:#222}
  `;
  document.head.appendChild(style);
}

export function getFastDraft() {
  let draft = null;
  try {
    draft = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || "null");
  } catch {
    sessionStorage.removeItem(DRAFT_KEY);
    return null;
  }

  if (!draft || number(draft.amount) <= 0) return null;
  const sessionId = activeSessionId();
  if (!sessionId || text(draft.sessionId) !== sessionId) {
    sessionStorage.removeItem(DRAFT_KEY);
    return null;
  }
  return {
    sessionId,
    currency: text(draft.currency || currentCurrency()).toUpperCase(),
    amount: Math.max(0, number(draft.amount)),
    hint: text(draft.hint || "unclassified") || "unclassified"
  };
}

export function setFastDraft({ sessionId = activeSessionId(), currency = currentCurrency(), amount = 0, hint = "unclassified" } = {}) {
  const cleanAmount = Math.max(0, number(amount));
  const cleanSessionId = text(sessionId);
  if (!cleanSessionId || cleanAmount <= 0) {
    clearFastDraft();
    return null;
  }

  const draft = {
    sessionId: cleanSessionId,
    currency: text(currency || "JPY").toUpperCase(),
    amount: cleanAmount,
    hint: text(hint || "unclassified") || "unclassified"
  };
  sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  schedule();
  return draft;
}

export function clearFastDraft() {
  sessionStorage.removeItem(DRAFT_KEY);
  schedule();
}

function checkoutCard() {
  return document.querySelector("#posCheckoutButton")?.closest(".card") || null;
}

function totalRow(card = checkoutCard()) {
  if (!card) return null;
  return Array.from(card.querySelectorAll(".list-row"))
    .find(row => Array.from(row.querySelectorAll("strong")).some(node => text(node.textContent) === "TOTAL")) || null;
}

export function normalCartSummary() {
  const card = checkoutCard();
  const row = totalRow(card);
  if (!card || !row) return { total: 0, hasItems: false, knownQuantity: 0 };

  let total = number(row.dataset.mixedBaseTotal);
  if (!row.dataset.mixedBaseTotal) {
    const values = Array.from(row.querySelectorAll("strong"));
    total = parseMoney(values[values.length - 1]?.textContent || "0");
  }

  const quantity = Array.from(card.querySelectorAll('.posQtyButton[data-change="-1"]'))
    .reduce((sum, button) => sum + Math.max(0, Math.floor(number(button.nextElementSibling?.textContent))), 0);

  return {
    total: Math.max(0, total),
    hasItems: Boolean(card.querySelector(".posLineDiscountInput")),
    knownQuantity: quantity
  };
}

function variantMap() {
  const rows = loadPosOfflineSnapshot()?.posSkuRows;
  return new Map((Array.isArray(rows) ? rows : []).map(row => [text(row?.variantId), row]));
}

function inferCategory(label, detail) {
  const value = `${text(label)} ${text(detail)}`;
  if (value.includes("Tシャツ") || /pigment|organic|made in japan/i.test(value)) return "tshirt";
  if (value.includes("ドロップ") && value.includes("イヤリング")) return "drop_earring";
  if (value.includes("ドロップ") && value.includes("ピアス")) return "drop_pierce";
  if (value.includes("イヤリング")) return "earring";
  if (value.includes("ピアス")) return "pierce";
  if (value.includes("ステッカー")) return "sticker";
  if (value.includes("ポストカード")) return "postcard";
  if (value.includes("プリント")) return "art_print";
  return "unclassified";
}

function extractNormalCartItems() {
  const card = checkoutCard();
  if (!card) return [];
  const variants = variantMap();

  return Array.from(card.querySelectorAll(".posLineDiscountInput"))
    .map(input => {
      const row = input.closest(".list-row");
      if (!row) return null;
      const key = text(input.dataset.key);
      const minus = row.querySelector('.posQtyButton[data-change="-1"]');
      const quantity = Math.max(0, Math.floor(number(minus?.nextElementSibling?.textContent)));
      if (!key || quantity <= 0) return null;

      const left = row.firstElementChild;
      const label = text(left?.firstElementChild?.textContent) || key;
      const detail = text(Array.from(left?.querySelectorAll?.(".muted") || [])
        .find(node => !text(node.textContent).includes("セット値引") && !text(node.textContent).includes(currentCurrency()))?.textContent);
      const manualDiscount = Math.max(0, number(input.value));
      const setNode = Array.from(left?.querySelectorAll?.(".muted") || [])
        .find(node => text(node.textContent).includes("セット値引"));
      const setDiscount = Math.abs(parseMoney(setNode?.textContent || "0"));
      const netBeforeOrder = Math.max(0, parseMoney(row.lastElementChild?.textContent || "0"));
      const unitPrice = Math.max(0, (netBeforeOrder + setDiscount + manualDiscount) / quantity);

      if (key.startsWith("sku:")) {
        const variantId = key.slice(4);
        const variant = variants.get(variantId) || {};
        return {
          lineId: key,
          category: text(variant.category) || inferCategory(label, detail),
          label,
          detail,
          quantity,
          unitPrice,
          trackingMode: "sku",
          variantId,
          inventoryKey: variant.inventoryKey || null,
          inventorySource: variant.inventorySource || null,
          bodyId: variant.bodyId || null,
          designId: variant.designId || null,
          colorId: variant.colorId || null,
          sizeId: variant.sizeId || null,
          body: variant.body || null,
          design: variant.design || null,
          color: variant.color || null,
          size: variant.size || null,
          setDiscount,
          manualDiscount
        };
      }

      let category = key;
      let bodyId = null;
      if (key.startsWith("tshirt:")) {
        category = "tshirt";
        bodyId = key.slice(7) || null;
      }
      return {
        lineId: key,
        category: text(category) || inferCategory(label, detail),
        label,
        detail,
        quantity,
        unitPrice,
        trackingMode: "quick",
        bodyId,
        setDiscount,
        manualDiscount
      };
    })
    .filter(Boolean);
}

function orderDiscount() {
  return Math.max(0, number(document.querySelector("#posOrderDiscount")?.value));
}

function buildCombinedPayload() {
  const draft = getFastDraft();
  const normalItems = extractNormalCartItems();
  const items = [...normalItems];
  if (draft) {
    items.push({
      lineId: "amount_only",
      category: "unclassified",
      label: fastAmountHintLabel(draft.hint),
      quantity: 1,
      unitPrice: draft.amount,
      trackingMode: "amount_only",
      setDiscount: 0,
      manualDiscount: 0
    });
  }

  return {
    transactionId: createTransactionId(),
    sessionId: activeSessionId(),
    items,
    orderDiscount: orderDiscount(),
    createdByEmail: currentEmail()
  };
}

function payloadTotal(payload) {
  const beforeOrder = (payload.items || []).reduce((sum, item) => {
    const gross = number(item.quantity) * number(item.unitPrice);
    return sum + Math.max(0, gross - number(item.setDiscount) - number(item.manualDiscount));
  }, 0);
  return Math.max(0, beforeOrder - Math.min(beforeOrder, Math.max(0, number(payload.orderDiscount))));
}

function knownItemCount(payload) {
  return (payload.items || [])
    .filter(item => text(item.trackingMode) !== "amount_only")
    .reduce((sum, item) => sum + Math.max(0, Math.floor(number(item.quantity))), 0);
}

function hasSku(payload) {
  return (payload.items || []).some(item => Boolean(text(item.variantId)));
}

async function clearNormalCart() {
  const clear = document.querySelector("#clearPosCart");
  if (!clear) return;
  const originalConfirm = window.confirm;
  suppressClearIntercept = true;
  try {
    window.confirm = () => true;
    clear.click();
  } finally {
    window.confirm = originalConfirm;
    suppressClearIntercept = false;
  }
  await new Promise(resolve => setTimeout(resolve, 30));
}

function removePaymentOverlay() {
  document.getElementById("mixedCheckoutOverlay")?.remove();
}

function createPaymentOverlay(title, total, currency) {
  removePaymentOverlay();
  const overlay = document.createElement("div");
  overlay.id = "mixedCheckoutOverlay";
  overlay.className = "mixed-checkout-overlay";
  overlay.innerHTML = `
    <div class="mixed-checkout-card">
      <h2>${title}</h2>
      <div class="amount">${moneyText(total, currency)}</div>
      <div id="mixedCheckoutStatus">処理しています</div>
      <div class="qr" id="mixedCheckoutQr"></div>
      <button type="button" class="secondary" id="mixedCheckoutCancel">キャンセル</button>
    </div>
  `;
  document.body.appendChild(overlay);
  return overlay;
}

function showCompletion(total, currency, message = "会計を保存しました") {
  removePaymentOverlay();
  document.getElementById("fastPosOverlay")?.remove();
  const overlay = document.createElement("div");
  overlay.id = "mixedCheckoutOverlay";
  overlay.className = "mixed-checkout-overlay";
  overlay.innerHTML = `
    <div class="mixed-checkout-card">
      <h2>${message}</h2>
      <div class="amount">${moneyText(total, currency)}</div>
      <button type="button" id="mixedCheckoutOk">OK</button>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector("#mixedCheckoutOk")?.addEventListener("click", () => overlay.remove());
}

async function finishSuccess(total, currency, message) {
  clearFastDraft();
  await clearNormalCart();
  document.querySelector('.nav-btn[data-route="pos"]')?.click();
  showCompletion(total, currency, message);
}

async function checkoutManual(payload, total, currency) {
  if (!navigator.onLine) {
    const snapshot = loadPosOfflineSnapshot();
    if (hasSku(payload) && !snapshot?.posUsesEventOpeningInventory) {
      throw new Error("オフラインでSKUを含む会計をするには、イベント開始在庫の保存が必要です。");
    }
    enqueueOfflineSale({
      sale: payload,
      display: {
        netSales: total,
        currency,
        itemCount: knownItemCount(payload),
        kind: "mixed_fast"
      }
    });
    await finishSuccess(total, currency, "オフライン会計として保存しました");
    return { queued: true };
  }

  const result = await commitQuickSale({ ...payload, paymentMethod: "manual" });
  await normalizeFastAmountTransaction({ transactionId: payload.transactionId });
  await finishSuccess(total, currency, "会計を保存しました");
  return result;
}

async function checkoutStripe(payload, total, currency, statusHost = null) {
  if (!navigator.onLine) throw new Error("Stripeはオンライン時のみ利用できます。");

  const checkout = await createStripeCheckout({ salePayload: payload });
  if (!checkout?.url) throw new Error("Stripe支払いURLを作成できませんでした。");

  let overlay = null;
  let qrHost = null;
  let cancelButton = null;
  let statusNode = null;

  if (statusHost) {
    statusHost.innerHTML = `
      <div class="fp-status">お客様の支払いを待っています…</div>
      <div class="fp-qr" id="mixedFastQr"></div>
      <button type="button" class="fp-cancel" id="mixedFastCancel">Stripe会計をキャンセル</button>
    `;
    qrHost = statusHost.querySelector("#mixedFastQr");
    cancelButton = statusHost.querySelector("#mixedFastCancel");
    statusNode = statusHost.querySelector(".fp-status");
  } else {
    overlay = createPaymentOverlay("Stripe支払い", total, currency);
    qrHost = overlay.querySelector("#mixedCheckoutQr");
    cancelButton = overlay.querySelector("#mixedCheckoutCancel");
    statusNode = overlay.querySelector("#mixedCheckoutStatus");
    if (statusNode) statusNode.textContent = "お客様の支払いを待っています";
  }

  await renderStripeQr(qrHost, checkout.url);
  let canceled = false;
  cancelButton?.addEventListener("click", async () => {
    canceled = true;
    try { await expireStripeCheckout(payload.transactionId); } catch {}
    if (overlay) overlay.remove();
    if (statusHost) statusHost.innerHTML = '<div class="fp-status">Stripe会計をキャンセルしました。</div>';
  });

  for (let attempt = 0; attempt < 90; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 1500));
    if (canceled) return { canceled: true };
    const latest = await getStripeCheckoutStatus(payload.transactionId);

    if (latest?.paymentStatus === "paid") {
      const result = await commitQuickSale({
        ...payload,
        paymentMethod: "stripe",
        paymentProvider: "stripe",
        providerPaymentIntentId: latest?.paymentIntentId || "",
        providerCheckoutSessionId: latest?.checkoutSessionId || checkout?.checkoutSessionId || "",
        providerPaymentStatus: latest?.paymentStatus || "paid"
      });
      await normalizeFastAmountTransaction({ transactionId: payload.transactionId });
      try { await markStripeSaleCommitted({ transactionId: payload.transactionId }); } catch (error) {
        console.warn("Mixed Stripe committed marker failed", error);
      }
      await finishSuccess(total, currency, "Stripe支払い完了");
      return result;
    }

    if (latest?.status === "expired" || latest?.status === "complete" && latest?.paymentStatus !== "paid") {
      throw new Error("Stripe会計は完了しませんでした。");
    }
  }

  throw new Error("支払い確認がタイムアウトしました。会計履歴とStripe状態を確認してください。");
}

export async function checkoutCombined({ paymentMethod = "manual", statusHost = null } = {}) {
  if (checkoutBusy) return { busy: true };
  const payload = buildCombinedPayload();
  if (!payload.sessionId) throw new Error("販売セッションを選択してください。");
  if (!payload.items.length) throw new Error("会計内容がありません。");
  const currency = getFastDraft()?.currency || currentCurrency();
  const total = payloadTotal(payload);
  if (total <= 0) throw new Error("会計金額は0より大きい必要があります。");

  const label = paymentMethod === "stripe" ? "Stripe支払い" : "会計";
  if (!window.confirm(`${moneyText(total, currency)} の${label}を確定しますか？`)) {
    return { canceled: true };
  }

  checkoutBusy = true;
  try {
    if (paymentMethod === "stripe") {
      return await checkoutStripe(payload, total, currency, statusHost);
    }
    return await checkoutManual(payload, total, currency);
  } finally {
    checkoutBusy = false;
  }
}

function applyDraftUi() {
  installStyles();
  if (document.getElementById("fastPosOverlay")) return;
  const draft = getFastDraft();
  if (!draft) return;

  const card = checkoutCard();
  const row = totalRow(card);
  if (!card || !row) return;

  if (!row.dataset.mixedBaseTotal) {
    const amounts = Array.from(row.querySelectorAll("strong"));
    row.dataset.mixedBaseTotal = String(Math.max(0, parseMoney(amounts[amounts.length - 1]?.textContent || "0")));
  }

  let synthetic = card.querySelector("#mixedFastDraftLine");
  if (!synthetic) {
    synthetic = document.createElement("div");
    synthetic.id = "mixedFastDraftLine";
    synthetic.className = "list-row mixed-fast-row";
    row.parentElement?.insertBefore(synthetic, row);
  }
  synthetic.innerHTML = `
    <div>
      <strong>${fastAmountHintLabel(draft.hint)}</strong>
      <div class="muted" style="margin-top:3px">最速入力</div>
    </div>
    <div style="display:flex;align-items:center;gap:9px">
      <strong>${moneyText(draft.amount, draft.currency)}</strong>
      <button type="button" class="mixed-fast-remove" id="mixedFastRemove">削除</button>
    </div>
  `;

  const totalStrong = Array.from(row.querySelectorAll("strong")).pop();
  const baseTotal = Math.max(0, number(row.dataset.mixedBaseTotal));
  if (totalStrong) totalStrong.textContent = moneyText(baseTotal + draft.amount, draft.currency);

  let note = row.querySelector(".mixed-total-note");
  if (!note) {
    note = document.createElement("div");
    note.className = "mixed-total-note";
    row.appendChild(note);
  }
  note.textContent = "Quick・SKU・最速を合算";

  const checkout = card.querySelector("#posCheckoutButton");
  const stripe = card.querySelector("#posStripeCheckoutButton");
  if (checkout) {
    checkout.disabled = false;
    checkout.style.opacity = "1";
    if (!card.querySelector(".posLineDiscountInput")) checkout.textContent = "会計確定";
  }
  if (stripe) {
    stripe.disabled = !navigator.onLine;
    stripe.style.opacity = navigator.onLine ? "1" : ".48";
  }

  synthetic.querySelector("#mixedFastRemove")?.addEventListener("click", () => {
    clearFastDraft();
    document.querySelector('.nav-btn[data-route="pos"]')?.click();
  }, { once: true });
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    applyDraftUi();
  });
}

document.addEventListener("click", event => {
  if (suppressClearIntercept) return;
  const button = event.target?.closest?.("#posCheckoutButton,#posStripeCheckoutButton,#clearPosCart");
  if (!button) return;
  const draft = getFastDraft();
  if (!draft) return;

  if (button.id === "clearPosCart") {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!window.confirm("Quick・SKU・最速の会計内容をすべてクリアしますか？")) return;
    clearFastDraft();
    const originalConfirm = window.confirm;
    suppressClearIntercept = true;
    try {
      window.confirm = () => true;
      button.click();
    } finally {
      window.confirm = originalConfirm;
      suppressClearIntercept = false;
    }
    return;
  }

  event.preventDefault();
  event.stopImmediatePropagation();
  void checkoutCombined({
    paymentMethod: button.id === "posStripeCheckoutButton" ? "stripe" : "manual"
  }).catch(error => {
    window.alert(error?.message || String(error));
    schedule();
  });
}, true);

new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
window.addEventListener("focus", schedule);
document.addEventListener("visibilitychange", () => { if (!document.hidden) schedule(); });
window.addEventListener("online", () => {
  window.clearTimeout(normalizeTimer);
  normalizeTimer = window.setTimeout(() => {
    const sessionId = activeSessionId();
    if (sessionId) void normalizeFastAmountSalesForSession(sessionId).catch(error => console.warn(error));
  }, 3000);
  schedule();
});

installStyles();
schedule();
