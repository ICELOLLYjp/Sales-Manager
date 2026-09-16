import { getFirebaseState } from "./firebase.js";
import {
  loadFastAmountAllocation,
  classifyFastAmountByCategory,
  classifyFastAmountToSku
} from "./services/fastAmountAllocationService.js?v=20260916-fast-amount-allocation-1";

const BUTTON_CLASS = "fast-amount-allocation-button";
const CATEGORY_LABELS = {
  tshirt: "Tシャツ",
  accessory: "アクセサリー",
  other: "その他"
};
const SKU_CATEGORY_LABELS = {
  tshirt: "Tシャツ",
  pierce: "ピアス",
  earring: "イヤリング",
  drop_pierce: "ドロップピアス",
  drop_earring: "ドロップイヤリング"
};
const transactionCache = new Map();

function text(value) {
  return String(value ?? "").trim();
}

function esc(value) {
  return text(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function currentEmail() {
  return text(getFirebaseState()?.auth?.currentUser?.email);
}

function transactionIdFromRow(row) {
  return text(row?.textContent).match(/\bsale_[A-Za-z0-9_-]+\b/)?.[0] || "";
}

function isTargetSale(sale) {
  return sale?.amountOnly === true &&
    text(sale?.classificationStatus || "unclassified") === "unclassified" &&
    sale?.status !== "voided";
}

async function firestoreModule() {
  return await import("https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js");
}

async function loadTransaction(transactionId) {
  if (transactionCache.has(transactionId)) return transactionCache.get(transactionId);
  const { db, enabled } = getFirebaseState();
  if (!enabled || !db) return null;
  const { doc, getDocFromServer } = await firestoreModule();
  const snapshot = await getDocFromServer(doc(db, "salesTransactions", transactionId));
  const sale = snapshot.exists() ? { transactionId: snapshot.id, ...snapshot.data() } : null;
  transactionCache.set(transactionId, sale);
  return sale;
}

function installStyles() {
  if (document.querySelector("#fastAmountAllocationStyles")) return;
  const style = document.createElement("style");
  style.id = "fastAmountAllocationStyles";
  style.textContent = `
    .${BUTTON_CLASS}{width:100%;min-height:42px;margin-top:8px;border:1px solid #6655e8;border-radius:10px;background:#f1efff;color:#4433c7;font:800 13px/1.2 system-ui,sans-serif}
    .faa-backdrop{position:fixed;inset:0;z-index:14000;display:flex;align-items:flex-end;justify-content:center;padding:12px 9px calc(12px + env(safe-area-inset-bottom));background:rgba(0,0,0,.44)}
    .faa-sheet{width:min(480px,100%);max-height:91vh;overflow:auto;box-sizing:border-box;padding:15px;border-radius:19px;background:#fff}
    .faa-sheet h3{margin:0 0 4px;font-size:18px}.faa-note{font-size:11px;line-height:1.55;color:#666}.faa-section{margin-top:14px;padding-top:13px;border-top:1px solid #ecebe7}.faa-section-title{font-size:13px;font-weight:900;margin-bottom:7px}
    .faa-category-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}.faa-category-grid button{min-height:46px;padding:6px;border:1px solid #cbc9c2;border-radius:11px;background:#fff;font:800 12px/1.2 system-ui,sans-serif}
    .faa-search{width:100%;min-height:44px;box-sizing:border-box;margin-top:8px;padding:0 11px;border:1px solid #ccc;border-radius:10px;background:#fff;font:16px system-ui,sans-serif}
    .faa-qty{display:grid;grid-template-columns:48px minmax(0,1fr) 48px;gap:6px;align-items:center;margin-top:8px}.faa-qty button{height:44px;border:1px solid #ccc;border-radius:9px;background:#fff;font-size:24px}.faa-qty input{width:100%;height:44px;box-sizing:border-box;border:1px solid #bbb;border-radius:9px;text-align:center;font:800 18px system-ui,sans-serif}
    .faa-candidates{display:grid;gap:6px;margin-top:8px}.faa-candidate{width:100%;padding:9px;border:1px solid #ddd;border-radius:10px;background:#fff;text-align:left;font:inherit}.faa-candidate.selected{border-color:#5f4ded;background:#f1efff}.faa-candidate strong{display:block;font-size:12px}.faa-candidate span{display:block;margin-top:2px;color:#777;font-size:10px;line-height:1.4}
    .faa-actions{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:12px}.faa-actions button{min-height:46px;border:1px solid #ccc;border-radius:10px;background:#fff;font:800 13px system-ui,sans-serif}.faa-actions .primary{border-color:#5f4ded;background:#5f4ded;color:#fff}.faa-actions .primary:disabled{opacity:.45}.faa-error{min-height:16px;margin-top:8px;color:#a32d2d;font-size:11px;line-height:1.4}
  `;
  document.head.appendChild(style);
}

function candidateSearchText(candidate) {
  return [
    candidate.label,
    candidate.detail,
    candidate.sku,
    candidate.variantId,
    candidate.body,
    candidate.color,
    candidate.size,
    SKU_CATEGORY_LABELS[candidate.category]
  ].map(text).join(" ").toLocaleLowerCase("ja");
}

function openAllocationSheet(summary) {
  installStyles();
  const sale = summary.sale;
  const transactionId = text(sale.transactionId);
  const currency = text(sale.currency || "JPY");
  const amount = Number(sale.netSales || 0).toLocaleString("ja-JP", { maximumFractionDigits: 2 });
  const backdrop = document.createElement("div");
  backdrop.className = "faa-backdrop";
  backdrop.innerHTML = `<div class="faa-sheet" role="dialog" aria-modal="true">
    <h3>未分類会計を後から分類</h3>
    <div class="faa-note"><strong>${esc(amount)} ${esc(currency)}</strong><br>${esc(transactionId)}<br>売上金額は変更しません。カテゴリのみの確定では在庫を変更せず、SKU確定では指定数量を正式実在庫から一度だけ減算します。</div>
    <div class="faa-section">
      <div class="faa-section-title">カテゴリのみ確定</div>
      <div class="faa-note">複数商品をまとめた会計や、数量が不明な場合はこちらを選びます。</div>
      <div class="faa-category-grid">
        ${Object.entries(CATEGORY_LABELS).map(([value, label]) => `<button type="button" data-category="${esc(value)}">${esc(label)}</button>`).join("")}
      </div>
    </div>
    <div class="faa-section">
      <div class="faa-section-title">単一SKUと数量へ確定</div>
      <div class="faa-note">この金額が1種類のSKUの販売だった場合に使用します。</div>
      <div class="faa-qty"><button type="button" data-delta="-1">−</button><input id="faaQty" type="number" inputmode="numeric" min="1" value="1"><button type="button" data-delta="1">＋</button></div>
      <input id="faaSearch" class="faa-search" type="search" placeholder="商品名 / Body / Color / Size / SKU">
      <div id="faaCandidates" class="faa-candidates"></div>
    </div>
    <div id="faaError" class="faa-error"></div>
    <div class="faa-actions"><button type="button" id="faaCancel">キャンセル</button><button type="button" id="faaConfirmSku" class="primary" disabled>このSKUへ確定</button></div>
  </div>`;
  document.body.appendChild(backdrop);

  const errorBox = backdrop.querySelector("#faaError");
  const qtyInput = backdrop.querySelector("#faaQty");
  const search = backdrop.querySelector("#faaSearch");
  const list = backdrop.querySelector("#faaCandidates");
  const confirmSku = backdrop.querySelector("#faaConfirmSku");
  let selected = null;
  let busy = false;

  function readQty() {
    const value = Math.trunc(Number(qtyInput.value || 1));
    return Math.max(1, Number.isFinite(value) ? value : 1);
  }
  function setQty(value) {
    qtyInput.value = String(Math.max(1, Math.trunc(Number(value) || 1)));
  }
  backdrop.querySelectorAll("[data-delta]").forEach(button => button.addEventListener("click", () => setQty(readQty() + Number(button.dataset.delta))));
  qtyInput.addEventListener("change", () => setQty(readQty()));

  function renderCandidates() {
    const query = text(search.value).toLocaleLowerCase("ja");
    const visible = summary.candidates
      .filter(candidate => !query || candidateSearchText(candidate).includes(query))
      .slice(0, 30);
    list.innerHTML = visible.length ? visible.map(candidate => `
      <button type="button" class="faa-candidate ${selected?.variantId === candidate.variantId ? "selected" : ""}" data-variant-id="${esc(candidate.variantId)}">
        <strong>${esc(candidate.label)}</strong>
        <span>${esc([SKU_CATEGORY_LABELS[candidate.category] || candidate.category, candidate.detail, `正式在庫 ${candidate.currentStockQty}`].filter(Boolean).join(" / "))}</span>
      </button>`).join("") : `<div class="faa-note" style="padding:8px 0">該当するSKUがありません。</div>`;
    list.querySelectorAll("[data-variant-id]").forEach(button => button.addEventListener("click", () => {
      selected = summary.candidates.find(candidate => candidate.variantId === button.dataset.variantId) || null;
      confirmSku.disabled = !selected || busy;
      renderCandidates();
    }));
  }
  search.addEventListener("input", renderCandidates);
  renderCandidates();

  const close = () => { if (!busy) backdrop.remove(); };
  backdrop.querySelector("#faaCancel").addEventListener("click", close);
  backdrop.addEventListener("click", event => { if (event.target === backdrop) close(); });

  async function run(action) {
    if (busy) return;
    busy = true;
    errorBox.textContent = "";
    confirmSku.disabled = true;
    backdrop.querySelectorAll("button").forEach(button => { button.disabled = true; });
    try {
      const result = await action();
      backdrop.remove();
      if (result?.stockWentNegative) {
        window.alert(`分類しました。正式在庫は ${result.stockAfter} 点になり、要確認の負在庫です。`);
      } else {
        window.alert("未分類会計を分類しました。売上金額は変更していません。");
      }
      window.location.reload();
    } catch (error) {
      errorBox.textContent = error?.message || String(error);
      busy = false;
      backdrop.querySelectorAll("button").forEach(button => { button.disabled = false; });
      confirmSku.disabled = !selected;
    }
  }

  backdrop.querySelectorAll("[data-category]").forEach(button => button.addEventListener("click", () => {
    const category = button.dataset.category;
    if (!window.confirm(`${CATEGORY_LABELS[category]}として確定します。\n売上金額と在庫数は変更しません。\n\nこの内容で進めますか？`)) return;
    run(() => classifyFastAmountByCategory({
      transactionId,
      category,
      classifiedByEmail: currentEmail()
    }));
  }));

  confirmSku.addEventListener("click", () => {
    if (!selected) return;
    const quantity = readQty();
    if (!window.confirm(`${selected.label} ${quantity} 点として確定します。\n正式実在庫を ${quantity} 点減算します。売上金額は変更しません。\n\nこの内容で進めますか？`)) return;
    run(() => classifyFastAmountToSku({
      transactionId,
      variantId: selected.variantId,
      quantity,
      classifiedByEmail: currentEmail()
    }));
  });
}

async function enhanceRow(row) {
  if (!row || row.dataset.fastAmountAllocationChecked === "1") return;
  row.dataset.fastAmountAllocationChecked = "1";
  const transactionId = transactionIdFromRow(row);
  if (!transactionId) return;
  try {
    const sale = await loadTransaction(transactionId);
    if (!isTargetSale(sale) || !row.isConnected || row.querySelector(`.${BUTTON_CLASS}`)) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = BUTTON_CLASS;
    button.textContent = "未分類を後から分類";
    button.addEventListener("click", async () => {
      button.disabled = true;
      button.textContent = "読み込み中…";
      try {
        const summary = await loadFastAmountAllocation({ transactionId });
        openAllocationSheet(summary);
      } catch (error) {
        window.alert(error?.message || String(error));
      } finally {
        button.disabled = false;
        button.textContent = "未分類を後から分類";
      }
    });
    const voidButton = row.querySelector(".voidSaleTransactionButton");
    if (voidButton) voidButton.insertAdjacentElement("beforebegin", button);
    else row.appendChild(button);
  } catch (error) {
    console.warn("Fast amount allocation check failed", transactionId, error);
    delete row.dataset.fastAmountAllocationChecked;
  }
}

function enhanceHistory() {
  document.querySelectorAll(".voidSaleTransactionButton").forEach(button => enhanceRow(button.closest("div[style]") || button.parentElement));
}

let scheduled = false;
function scheduleEnhance() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    enhanceHistory();
  });
}

installStyles();
const view = document.querySelector("#view");
if (view) new MutationObserver(scheduleEnhance).observe(view, { childList: true, subtree: true });
scheduleEnhance();
