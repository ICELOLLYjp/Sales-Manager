import { getFirebaseState } from "./firebase.js";

const CONTROL_CLASS = "transaction-history-search-controls";
const PRODUCT_INFO_CLASS = "transaction-history-product-info";
const CATEGORY_LABELS = {
  tshirt: "Tシャツ",
  pierce: "ピアス",
  earring: "イヤリング",
  drop_pierce: "ドロップタイプピアス",
  drop_earring: "ドロップタイプイヤリング",
  sticker: "ステッカー",
  postcard: "ポストカード",
  art_print: "アートプリント"
};

const transactionCache = new Map();
const variantCache = new Map();

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("ja")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function parseMoneyText(value) {
  const normalized = String(value || "")
    .normalize("NFKC")
    .replace(/,/g, "")
    .replace(/[^\d.\-]/g, "");
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function transactionNetSales(row) {
  const summary = row.firstElementChild;
  const right = summary?.children?.[1];
  const amount = right?.firstElementChild;
  return parseMoneyText(amount?.textContent || "");
}

function transactionIdFromRow(row) {
  const text = String(row?.textContent || "");
  return text.match(/\bsale_[A-Za-z0-9_-]+\b/)?.[0] || "";
}

async function firestoreModule() {
  return await import(
    "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js"
  );
}

async function loadTransaction(transactionId) {
  if (!transactionId) return null;
  if (transactionCache.has(transactionId)) {
    return transactionCache.get(transactionId);
  }

  const { db, enabled } = getFirebaseState();
  if (!enabled || !db) return null;

  const { doc, getDocFromServer } = await firestoreModule();
  const snap = await getDocFromServer(
    doc(db, "salesTransactions", transactionId)
  );

  const result = snap.exists()
    ? { id: snap.id, ...snap.data() }
    : null;

  transactionCache.set(transactionId, result);
  return result;
}

async function loadVariant(variantId) {
  if (!variantId) return null;
  if (variantCache.has(variantId)) {
    return variantCache.get(variantId);
  }

  const { db, enabled } = getFirebaseState();
  if (!enabled || !db) return null;

  const { doc, getDocFromServer } = await firestoreModule();
  const snap = await getDocFromServer(
    doc(db, "productVariants", variantId)
  );

  const result = snap.exists()
    ? { id: snap.id, ...snap.data() }
    : null;

  variantCache.set(variantId, result);
  return result;
}

function itemDisplay(item, variant) {
  const category = String(item?.category || variant?.category || "");
  const categoryLabel = CATEGORY_LABELS[category] || category || "商品";

  const design = String(
    variant?.design ||
    variant?.displayName ||
    item?.label ||
    categoryLabel
  ).trim();

  const body = String(variant?.body || item?.body || "").trim();
  const color = String(variant?.color || item?.color || "").trim();
  const size = String(variant?.size || item?.size || "").trim();
  const sku = String(
    variant?.pinkoiSku ||
    variant?.sku ||
    item?.sku ||
    item?.variantId ||
    ""
  ).trim();

  const detailParts = [];

  if (category === "tshirt") {
    detailParts.push(categoryLabel, body, color, size);
  } else {
    detailParts.push(categoryLabel);
    if (size) detailParts.push(size);
  }

  if (sku && item?.variantId) {
    detailParts.push(`SKU ${sku}`);
  }

  return {
    design: design || categoryLabel,
    detail: detailParts.filter(Boolean).join(" / "),
    quantity: Math.max(0, Number(item?.quantity || 0)),
    categoryLabel
  };
}

async function renderProductInfo(row, section) {
  if (!row || row.querySelector(`.${PRODUCT_INFO_CLASS}`)) return;

  const transactionId = transactionIdFromRow(row);
  if (!transactionId) return;

  try {
    const transaction = await loadTransaction(transactionId);
    const items = Array.isArray(transaction?.items)
      ? transaction.items
      : [];

    if (!items.length) return;

    const rendered = await Promise.all(
      items.map(async item => {
        const variant = item?.variantId
          ? await loadVariant(String(item.variantId))
          : null;

        return itemDisplay(item, variant);
      })
    );

    const box = document.createElement("div");
    box.className = PRODUCT_INFO_CLASS;
    box.style.cssText = [
      "margin-top:9px",
      "padding:9px 10px",
      "border-radius:10px",
      "background:#f7f7f4",
      "display:grid",
      "gap:7px"
    ].join(";");

    box.innerHTML = rendered.map(item => `
      <div
        style="
          display:grid;
          grid-template-columns:minmax(0,1fr) auto;
          gap:8px;
          align-items:start;
        "
      >
        <div style="min-width:0;">
          <div
            style="
              font-size:13px;
              font-weight:800;
              line-height:1.3;
              overflow-wrap:anywhere;
            "
          >
            ${escapeHtml(item.design)}
          </div>
          ${
            item.detail
              ? `
                <div
                  class="muted"
                  style="
                    margin-top:2px;
                    font-size:11px;
                    line-height:1.4;
                    overflow-wrap:anywhere;
                  "
                >
                  ${escapeHtml(item.detail)}
                </div>
              `
              : ""
          }
        </div>

        <strong
          style="
            font-size:12px;
            white-space:nowrap;
          "
        >
          × ${item.quantity}
        </strong>
      </div>
    `).join("");

    const transactionIdBox = Array.from(row.children)
      .find(element =>
        element.classList?.contains("muted") &&
        String(element.textContent || "").includes(transactionId)
      );

    if (transactionIdBox) {
      transactionIdBox.insertAdjacentElement("beforebegin", box);
    } else {
      row.appendChild(box);
    }

    row.dataset.productInfoReady = "true";
    row.dataset.productSearch = normalizeSearchText(
      rendered
        .map(item => [
          item.design,
          item.detail,
          item.categoryLabel
        ].filter(Boolean).join(" "))
        .join(" ")
    );

    const controls = section?.querySelector(
      `.${CONTROL_CLASS} .transaction-history-search-input`
    );

    controls?.dispatchEvent(
      new Event("input", { bubbles: true })
    );

  } catch (error) {
    console.warn("Transaction product info load failed", transactionId, error);
  }
}

function findHistorySections() {
  return Array.from(document.querySelectorAll(".card-title"))
    .filter(element => element.textContent?.trim() === "会計履歴")
    .map(element => ({
      title: element,
      section: element.parentElement
    }))
    .filter(item => item.section);
}

function historyRows(section, title) {
  return Array.from(section.children)
    .filter(element => (
      element !== title &&
      element.tagName === "DIV" &&
      (
        element.querySelector(".voidSaleTransactionButton") ||
        element.textContent?.includes("取消済み")
      )
    ));
}

function enhanceHistorySection({ title, section }) {
  const transactionRows = historyRows(section, title);

  if (!transactionRows.length) return;

  transactionRows.forEach(row => renderProductInfo(row, section));

  if (section.querySelector(`.${CONTROL_CLASS}`)) {
    return;
  }

  const controls = document.createElement("div");
  controls.className = CONTROL_CLASS;
  controls.style.cssText = "display:grid;gap:7px;margin:8px 0 4px";

  controls.innerHTML = `
    <input
      class="transaction-history-search-input"
      type="search"
      placeholder="商品・デザイン・サイズ・ID・時刻で検索"
      autocomplete="off"
      style="
        width:100%;
        min-height:44px;
        padding:0 12px;
        border:1px solid #deded9;
        border-radius:12px;
        background:#fff;
      "
    >

    <input
      class="transaction-history-amount-filter"
      type="number"
      inputmode="decimal"
      step="0.01"
      min="0"
      placeholder="金額 完全一致（例 40）"
      style="
        width:100%;
        min-height:44px;
        padding:0 12px;
        border:1px solid #deded9;
        border-radius:12px;
        background:#fff;
      "
    >

    <div
      style="
        display:grid;
        grid-template-columns:repeat(2,minmax(0,1fr));
        gap:7px;
      "
    >
      <select
        class="transaction-history-payment-filter"
        style="
          width:100%;
          min-height:40px;
          padding:0 9px;
          border:1px solid #deded9;
          border-radius:10px;
          background:#fff;
        "
      >
        <option value="all">支払方法：すべて</option>
        <option value="stripe">Stripe</option>
        <option value="other">Stripe以外</option>
      </select>

      <select
        class="transaction-history-status-filter"
        style="
          width:100%;
          min-height:40px;
          padding:0 9px;
          border:1px solid #deded9;
          border-radius:10px;
          background:#fff;
        "
      >
        <option value="all">状態：すべて</option>
        <option value="active">有効</option>
        <option value="voided">取消済み</option>
      </select>
    </div>

    <div
      class="transaction-history-search-count muted"
      style="
        min-height:16px;
        font-size:11px;
      "
    ></div>
  `;

  title.insertAdjacentElement("afterend", controls);

  const searchInput = controls.querySelector(
    ".transaction-history-search-input"
  );
  const amountFilter = controls.querySelector(
    ".transaction-history-amount-filter"
  );
  const paymentFilter = controls.querySelector(
    ".transaction-history-payment-filter"
  );
  const statusFilter = controls.querySelector(
    ".transaction-history-status-filter"
  );
  const count = controls.querySelector(
    ".transaction-history-search-count"
  );

  function applyFilter() {
    const query = normalizeSearchText(searchInput?.value);
    const amountRaw = String(amountFilter?.value || "").trim();
    const amount = amountRaw === "" ? null : Number(amountRaw);
    const payment = paymentFilter?.value || "all";
    const status = statusFilter?.value || "all";

    let visibleCount = 0;

    transactionRows.forEach(row => {
      const rowText = normalizeSearchText(row.textContent);
      const productText = normalizeSearchText(row.dataset.productSearch || "");
      const combinedSearchText = `${rowText} ${productText}`.trim();
      const isStripe = rowText.includes("stripe");
      const isVoided = rowText.includes("取消済み");
      const netSales = transactionNetSales(row);

      const searchMatches = !query || combinedSearchText.includes(query);
      const amountMatches = amount === null || (
        Number.isFinite(amount) &&
        netSales !== null &&
        Math.abs(netSales - amount) < 0.005
      );
      const paymentMatches = (
        payment === "all" ||
        (payment === "stripe" && isStripe) ||
        (payment === "other" && !isStripe)
      );
      const statusMatches = (
        status === "all" ||
        (status === "active" && !isVoided) ||
        (status === "voided" && isVoided)
      );

      const visible = (
        searchMatches &&
        amountMatches &&
        paymentMatches &&
        statusMatches
      );

      row.style.display = visible ? "" : "none";

      if (visible) visibleCount += 1;
    });

    if (count) {
      count.textContent = `${visibleCount} / ${transactionRows.length} 件`;
    }
  }

  searchInput?.addEventListener("input", applyFilter);
  amountFilter?.addEventListener("input", applyFilter);
  paymentFilter?.addEventListener("change", applyFilter);
  statusFilter?.addEventListener("change", applyFilter);

  applyFilter();
}

function enhanceTransactionHistory() {
  findHistorySections().forEach(enhanceHistorySection);
}

const view = document.querySelector("#view");

if (view) {
  const observer = new MutationObserver(() => {
    enhanceTransactionHistory();
  });

  observer.observe(view, {
    childList: true,
    subtree: true
  });
}

enhanceTransactionHistory();
