import { getFirebaseState } from "./firebase.js";
import { buildSalesAggregation } from "./services/salesAggregationService.js?v=20260926-category-fix-1";

const REPORT_ID = "normalizedTshirtSalesAggregation";

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

function money(value, currency) {
  const amount = Number(value || 0);
  try {
    return new Intl.NumberFormat("ja-JP", {
      style: "currency",
      currency: text(currency || "JPY"),
      maximumFractionDigits: 2
    }).format(amount);
  } catch {
    return `${amount.toLocaleString("ja-JP")} ${text(currency)}`;
  }
}

async function firestoreModule() {
  return await import("https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js");
}

function findCategorySection() {
  const title = Array.from(document.querySelectorAll("#sessionSalesDetail .card-title"))
    .find(element => text(element.textContent) === "カテゴリ別");
  return title?.parentElement || null;
}

function activeTransactionIds() {
  return Array.from(document.querySelectorAll("#sessionSalesDetail .voidSaleTransactionButton[data-transaction-id]"))
    .map(button => text(button.dataset.transactionId))
    .filter(Boolean);
}

async function loadAggregation() {
  const { db, enabled } = getFirebaseState();
  if (!enabled || !db) throw new Error("Firebase is not connected.");
  const { doc, getDocFromServer } = await firestoreModule();
  const ids = activeTransactionIds();
  const snapshots = await Promise.all(ids.map(id => getDocFromServer(doc(db, "salesTransactions", id))));
  const transactions = snapshots
    .filter(snapshot => snapshot.exists())
    .map(snapshot => ({ transactionId: snapshot.id, ...snapshot.data() }))
    .filter(transaction => transaction.status !== "voided");
  const variantIds = Array.from(new Set(
    transactions.flatMap(transaction => Array.isArray(transaction.items) ? transaction.items : [])
      .map(item => text(item?.variantId))
      .filter(Boolean)
  ));
  const variantSnapshots = await Promise.all(
    variantIds.map(id => getDocFromServer(doc(db, "productVariants", id)).catch(() => null))
  );
  const variantsById = new Map();
  variantSnapshots.forEach((snapshot, index) => {
    if (snapshot?.exists()) variantsById.set(variantIds[index], { id: snapshot.id, ...snapshot.data() });
  });
  return {
    aggregation: buildSalesAggregation({ transactions, variantsById }),
    currency: text(transactions[0]?.currency || "JPY")
  };
}

function dimensionCard(title, rows, currency) {
  return `<div class="tsa-dimension"><div class="tsa-dimension-title">${esc(title)}</div>${rows.map(row => `
    <div class="tsa-row"><span>${esc(row.label)} <small>${row.quantity}点</small></span><strong>${esc(money(row.sales, currency))}</strong></div>
  `).join("")}</div>`;
}

function renderReport(section, aggregation, currency) {
  const legacyRows = Array.from(section.children)
    .filter(element => element.classList?.contains("list-row"));

  section.querySelector(`#${REPORT_ID}`)?.remove();

  const report = document.createElement("div");
  report.id = REPORT_ID;
  report.innerHTML = `
    <div class="tsa-category-list">${aggregation.categories.map(item => `
      <div class="tsa-category-row"><span>${esc(item.label)} <small>${item.quantity}点</small></span><strong>${esc(money(item.sales, currency))}</strong></div>
    `).join("")}</div>
    ${aggregation.tshirt.sales > 0 || aggregation.tshirt.quantity > 0 ? `
      <details open class="tsa-details">
        <summary>Tシャツ内訳（Design / Body / Color / Size）</summary>
        <div class="tsa-note">カテゴリはTシャツに統一し、4項目を独立して集計しています。Quick販売で不明な項目は0に変換せず「未特定」と表示します。</div>
        <div class="tsa-grid">
          ${dimensionCard("Design", aggregation.tshirt.dimensions.design, currency)}
          ${dimensionCard("Body", aggregation.tshirt.dimensions.body, currency)}
          ${dimensionCard("Color", aggregation.tshirt.dimensions.color, currency)}
          ${dimensionCard("Size", aggregation.tshirt.dimensions.size, currency)}
        </div>
      </details>` : ""}
  `;

  section.appendChild(report);

  // The original sales detail already renders a legacy category list.
  // Once the normalized report is ready, remove those rows instead of only
  // setting the hidden attribute. Some existing list-row CSS can make hidden
  // rows visible again, which looks like every category is counted twice.
  legacyRows.forEach(row => row.remove());

  section.dataset.tshirtAggregationReady = "1";
}

function installStyles() {
  if (document.querySelector("#tshirtSalesAggregationStyles")) return;
  const style = document.createElement("style");
  style.id = "tshirtSalesAggregationStyles";
  style.textContent = `
    .tsa-category-list{display:grid}.tsa-category-row,.tsa-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;padding:10px 0;border-bottom:1px solid #ecece7}.tsa-category-row small,.tsa-row small{color:#777;font-weight:400}.tsa-details{margin-top:10px}.tsa-details>summary{cursor:pointer;padding:9px 0;font-size:13px;font-weight:900}.tsa-note{margin-bottom:8px;color:#777;font-size:10px;line-height:1.5}.tsa-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px}.tsa-dimension{min-width:0;padding:10px;border:1px solid #ecece7;border-radius:12px;background:#fafaf8}.tsa-dimension-title{margin-bottom:5px;font-size:12px;font-weight:900}.tsa-row{padding:5px 0;font-size:11px}.tsa-row span{min-width:0;overflow-wrap:anywhere}.tsa-row strong{white-space:nowrap}
  `;
  document.head.appendChild(style);
}

let scheduled = false;
async function enhance() {
  const section = findCategorySection();
  if (!section || section.dataset.tshirtAggregationReady === "1" || section.dataset.tshirtAggregationLoading === "1") return;
  const ids = activeTransactionIds();
  if (!ids.length) return;
  section.dataset.tshirtAggregationLoading = "1";
  try {
    const { aggregation, currency } = await loadAggregation();
    if (!section.isConnected || findCategorySection() !== section) return;
    renderReport(section, aggregation, currency);
  } catch (error) {
    console.warn("T-shirt sales aggregation failed", error);
  } finally {
    delete section.dataset.tshirtAggregationLoading;
  }
}

function scheduleEnhance() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    enhance();
  });
}

installStyles();
const view = document.querySelector("#view");
if (view) new MutationObserver(scheduleEnhance).observe(view, { childList: true, subtree: true });
scheduleEnhance();
