import { getFirebaseState } from "./firebase.js";
import {
  loadEventInventoryFlow,
  addEventInventoryAdjustment,
  backfillMissingAccessoryStock
} from "./services/inventoryFlowService.js?v=20260926-accessory-backfill-1";
import { loadAllAccessoryEventRows } from "./services/accessoryEventCatalogService.js?v=20260916-accessory-flow-1";
import { planAccessoryEventBackfill } from "./services/accessoryEventBackfill.mjs";
import { missingAccessoryEventRows } from "./services/accessoryOpeningRegistration.mjs";
import { accessoryAdapter } from "./inventoryAdapters/accessoryAdapter.js";
import { listAllProductVariants, syncAccessoryCatalogRows } from "./services/productAdminService.js";

const PANEL_ID = "inventoryFlowOverlay";
const CARD_ID = "inventoryFlowAccessoryCard";
const ACCESSORY_CATEGORIES = new Set([
  "pierce",
  "earring",
  "drop_pierce",
  "drop_earring"
]);
const CATEGORY_ORDER = ["pierce", "earring", "drop_pierce", "drop_earring"];
const CATEGORY_LABELS = {
  pierce: "ピアス",
  earring: "イヤリング",
  drop_pierce: "ドロップピアス",
  drop_earring: "ドロップイヤリング"
};

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

function int(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function nonNegativeInt(value) {
  return Math.max(0, int(value));
}

function timestampMs(value) {
  if (!value) return 0;
  try {
    if (typeof value.toMillis === "function") return value.toMillis();
    if (typeof value.toDate === "function") return value.toDate().getTime();
  } catch {}
  if (Number.isFinite(Number(value?.seconds))) {
    return Number(value.seconds) * 1000 + Math.floor(Number(value.nanoseconds || 0) / 1e6);
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function currentSessionId() {
  return text(document.querySelector(`#${PANEL_ID} #ifSession`)?.value);
}

function currentEmail() {
  return text(getFirebaseState()?.auth?.currentUser?.email);
}

async function firestoreModule() {
  return await import("https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js");
}

async function loadTransactions(sessionId) {
  const { db, enabled } = getFirebaseState();
  if (!enabled || !db || !sessionId) return [];
  const { collection, query, where, getDocsFromServer } = await firestoreModule();
  const snapshot = await getDocsFromServer(query(
    collection(db, "salesTransactions"),
    where("sessionId", "==", sessionId)
  ));
  return snapshot.docs.map(docSnap => ({ transactionId: docSnap.id, ...docSnap.data() }));
}

function installStyles() {
  if (document.querySelector("#inventoryFlowAccessoryStyles")) return;
  const style = document.createElement("style");
  style.id = "inventoryFlowAccessoryStyles";
  style.textContent = `
    #${CARD_ID} .ifa-top{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}
    #${CARD_ID} .ifa-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin-top:9px}
    #${CARD_ID} .ifa-stat{padding:7px;border:1px solid #eee;border-radius:9px;background:#fafafa}
    #${CARD_ID} .ifa-stat strong{display:block;font-size:17px}.ifa-stat span{font-size:9px;color:#777}
    #${CARD_ID} .ifa-search{box-sizing:border-box;width:100%;min-height:42px;margin-top:9px;border:1px solid #ccc;border-radius:9px;padding:0 10px;font:inherit;font-size:16px;background:#fff}
    #${CARD_ID} .ifa-chips{display:flex;gap:5px;overflow-x:auto;margin-top:8px;padding-bottom:2px}
    #${CARD_ID} .ifa-chip{flex:0 0 auto;min-height:34px;padding:0 9px;border:1px solid #ddd;border-radius:999px;background:#fff;font:inherit;font-size:10px;font-weight:800}
    #${CARD_ID} .ifa-chip.active{background:#222;color:#fff;border-color:#222}
    #${CARD_ID} .ifa-list{display:grid;gap:7px;margin-top:9px}
    #${CARD_ID} .ifa-row{display:grid;grid-template-columns:minmax(0,1fr) 134px;gap:8px;align-items:center;padding:8px;border:1px solid #eee;border-radius:10px;background:#fff}
    #${CARD_ID} .ifa-row.active-event{border-color:#e3cf83;background:#fffdf3}
    #${CARD_ID} .ifa-row.reuse{border-color:#b9ddbf;background:#f3fbf5}
    #${CARD_ID} .ifa-row.recheck{border-color:#eed38a;background:#fff9e8}
    #${CARD_ID} .ifa-name{font-size:12px;font-weight:800;line-height:1.35}
    #${CARD_ID} .ifa-meta{font-size:9px;color:#777;line-height:1.45;margin-top:3px}
    #${CARD_ID} .ifa-expected{font-size:18px;font-weight:900}.ifa-negative{color:#b00020}
    #${CARD_ID} .ifa-step{display:grid;grid-template-columns:42px 1fr 42px;gap:5px;align-items:center;margin-top:4px}
    #${CARD_ID} .ifa-step button{height:42px;border:1px solid #ccc;border-radius:9px;background:#fff;font-size:23px;font-weight:900}
    #${CARD_ID} .ifa-step input{width:100%;min-width:0;height:42px;border:1px solid #bbb;border-radius:9px;text-align:center;font:inherit;font-size:17px;font-weight:800}
    #${CARD_ID} .ifa-actions{display:flex;gap:5px;margin-top:5px}.ifa-actions button{flex:1}
    #${CARD_ID} .ifa-state{font-size:9px;font-weight:800;margin-top:4px}.ifa-state.ok{color:#28713d}.ifa-state.warn{color:#876b00}
    @media(max-width:520px){#${CARD_ID} .ifa-row{grid-template-columns:minmax(0,1fr) 126px;padding:7px}.ifa-actions .if-mini{padding:5px 4px}}
  `;
  document.head.appendChild(style);
}

function checkpointItem(checkpoint, variantId) {
  return (Array.isArray(checkpoint?.items) ? checkpoint.items : [])
    .find(item => text(item?.variantId) === variantId) || null;
}

function latestCheckpointForVariant(state, variantId) {
  const checkpoints = Array.isArray(state?.checkpoints) ? state.checkpoints : [];
  return [...checkpoints]
    .filter(cp => checkpointItem(cp, variantId))
    .sort((a, b) => timestampMs(a?.capturedAtIso) - timestampMs(b?.capturedAtIso))
    .at(-1) || null;
}

function transactionTime(transaction) {
  return timestampMs(transaction?.createdAt) || timestampMs(transaction?.committedAt) || timestampMs(transaction?.updatedAt);
}

function hasQuickAfter(transactions, category, checkpointMs) {
  return (Array.isArray(transactions) ? transactions : [])
    .filter(transaction => transaction?.status !== "voided")
    .some(transaction => {
      const txMs = transactionTime(transaction);
      return (Array.isArray(transaction?.items) ? transaction.items : []).some(item => {
        if (text(item?.variantId)) return false;
        if (text(item?.category) !== category || nonNegativeInt(item?.quantity) <= 0) return false;
        return !txMs || txMs > checkpointMs;
      });
    });
}

function checkpointState(row, state, transactions) {
  const checkpoint = latestCheckpointForVariant(state, row.variantId);
  if (!checkpoint) return { checkpoint: null, item: null, reusable: false, reasons: ["前回カウントなし"] };

  const item = checkpointItem(checkpoint, row.variantId);
  const checkpointMs = timestampMs(checkpoint?.capturedAtIso);
  const reasons = [];
  const capturedSold = nonNegativeInt(checkpoint?.soldByVariantSnapshot?.[row.variantId]);
  const currentSold = nonNegativeInt(state?.soldByVariant?.[row.variantId]);
  if (capturedSold !== currentSold) reasons.push("SKU販売/取消あり");

  const flowChanged = (Array.isArray(state?.flowEntries) ? state.flowEntries : []).some(entry =>
    text(entry?.variantId) === row.variantId &&
    ["restock", "opening_correction"].includes(text(entry?.type)) &&
    timestampMs(entry?.recordedAtIso) > checkpointMs
  );
  if (flowChanged) reasons.push("Restock/開始修正あり");
  if (hasQuickAfter(transactions, row.category, checkpointMs)) reasons.push("Quick販売あり");

  return { checkpoint, item, reusable: Boolean(item) && reasons.length === 0, reasons };
}

function mergedAccessoryRows(state, catalogRows) {
  const stateRows = (Array.isArray(state?.rows) ? state.rows : [])
    .filter(row => ACCESSORY_CATEGORIES.has(text(row?.category)));
  const byId = new Map(stateRows.map(row => [text(row?.variantId), { ...row }]));

  catalogRows.forEach(catalog => {
    const existing = byId.get(catalog.variantId);
    if (existing) {
      byId.set(catalog.variantId, { ...catalog, ...existing, label: existing.label || catalog.label, detail: existing.detail || catalog.detail });
      return;
    }

    const sold = nonNegativeInt(state?.soldByVariant?.[catalog.variantId]);
    byId.set(catalog.variantId, {
      ...catalog,
      openingQty: 0,
      restockQty: 0,
      openingCorrection: 0,
      skuSales: sold,
      expectedQty: -sold,
      physicalQty: null,
      difference: null
    });
  });

  return [...byId.values()].sort((a, b) => {
    const aActive = nonNegativeInt(a.openingQty) > 0 || nonNegativeInt(a.restockQty) > 0 || int(a.openingCorrection) !== 0 || nonNegativeInt(a.skuSales) > 0;
    const bActive = nonNegativeInt(b.openingQty) > 0 || nonNegativeInt(b.restockQty) > 0 || int(b.openingCorrection) !== 0 || nonNegativeInt(b.skuSales) > 0;
    return Number(bActive) - Number(aActive) ||
      CATEGORY_ORDER.indexOf(text(a.category)) - CATEGORY_ORDER.indexOf(text(b.category)) ||
      nonNegativeInt(b.priority) - nonNegativeInt(a.priority) ||
      text(a.label).localeCompare(text(b.label), "ja");
  });
}

function hideLegacyAccessoryRows() {
  const overlay = document.querySelector(`#${PANEL_ID}`);
  if (!overlay) return;
  overlay.querySelectorAll(".if-row").forEach(row => {
    const id = text(row.querySelector(".if-physical")?.dataset?.variantId);
    if (id.startsWith("accessory__")) row.style.display = "none";
  });

  overlay.querySelectorAll(".if-rowlist").forEach(list => {
    const visible = [...list.querySelectorAll(":scope > .if-row")].some(row => row.style.display !== "none");
    if (visible) return;
    const heading = list.previousElementSibling;
    if (heading?.tagName === "H3" && text(heading.textContent) === "その他") heading.style.display = "none";
    list.style.display = "none";
  });
}

function placeCard(card) {
  const wrap = document.querySelector(`#${PANEL_ID} .if-wrap`);
  if (!wrap) return false;
  const tshirtCard = [...wrap.querySelectorAll(":scope > .if-card")]
    .find(item => text(item.querySelector("h3")?.textContent) === "Tシャツ在庫ボード");
  if (tshirtCard) {
    tshirtCard.insertAdjacentElement("afterend", card);
    return true;
  }
  const history = [...wrap.querySelectorAll(":scope > .if-card")]
    .find(item => text(item.querySelector("h3")?.textContent) === "変更・カウント履歴");
  if (history) {
    history.insertAdjacentElement("beforebegin", card);
    return true;
  }
  wrap.appendChild(card);
  return true;
}

function adjustmentDialog(row, type) {
  return new Promise(resolve => {
    const isRestock = type === "restock";
    let value = isRestock ? 1 : 0;
    const backdrop = document.createElement("div");
    backdrop.className = "if-stepper-backdrop";
    backdrop.innerHTML = `<div class="if-stepper-sheet" role="dialog" aria-modal="true">
      <div class="if-stepper-title">${isRestock ? "補充" : "開始在庫の修正"}</div>
      <div class="if-stepper-detail">${esc(row.label)}<br>${esc(CATEGORY_LABELS[row.category] || row.detail || row.sku)}${isRestock ? "<br>イベント会場へ追加した数量を入力します。" : "<br>開始数の入力違いを差分で記録します。"}</div>
      <div class="if-stepper-control">
        <button type="button" data-delta="-1">−</button>
        <input class="if-stepper-value" type="number" inputmode="numeric" step="1" value="${value}" ${isRestock ? 'min="0"' : ""}>
        <button type="button" data-delta="1">＋</button>
      </div>
      <div class="if-stepper-actions"><button type="button" class="ifa-cancel">キャンセル</button><button type="button" class="save ifa-save">記録する</button></div>
    </div>`;
    document.body.appendChild(backdrop);
    const input = backdrop.querySelector(".if-stepper-value");
    const read = () => Number.isFinite(Number(input.value)) ? Math.trunc(Number(input.value)) : 0;
    const set = next => {
      value = isRestock ? Math.max(0, next) : next;
      input.value = String(value);
    };
    backdrop.querySelectorAll("[data-delta]").forEach(button => button.addEventListener("click", () => set(read() + Number(button.dataset.delta))));
    const close = result => { backdrop.remove(); resolve(result); };
    backdrop.querySelector(".ifa-cancel").addEventListener("click", () => close(null));
    backdrop.addEventListener("click", event => { if (event.target === backdrop) close(null); });
    backdrop.querySelector(".ifa-save").addEventListener("click", () => {
      const next = read();
      if (isRestock && next <= 0) return window.alert("補充数は1以上にしてください。");
      if (!isRestock && next === 0) return window.alert("修正数を＋または−で入力してください。");
      close(next);
    });
    setTimeout(() => input.focus(), 50);
  });
}

function refreshInventoryFlowPanel() {
  const select = document.querySelector(`#${PANEL_ID} #ifSession`);
  if (!select) return;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

function applyFilter(card) {
  const query = text(card.querySelector(".ifa-search")?.value).toLocaleLowerCase("ja");
  const category = text(card.dataset.categoryFilter || "all");
  card.querySelectorAll(".ifa-row").forEach(row => {
    const matchesCategory = category === "all" || row.dataset.category === category;
    const matchesQuery = !query || text(row.dataset.search).includes(query);
    row.hidden = !(matchesCategory && matchesQuery);
  });
}

let rendering = false;
let renderedSessionKey = "";

async function renderAccessoryCard(force = false) {
  if (rendering) return;
  const overlay = document.querySelector(`#${PANEL_ID}`);
  const sessionId = currentSessionId();
  if (!overlay || !sessionId) return;

  const sessionKey = sessionId;
  if (!force && renderedSessionKey === sessionKey && document.querySelector(`#${CARD_ID}`)) {
    hideLegacyAccessoryRows();
    return;
  }

  rendering = true;
  try {
    const [{ session, state }, catalogRows, transactions] = await Promise.all([
      loadEventInventoryFlow(sessionId),
      loadAllAccessoryEventRows(),
      loadTransactions(sessionId)
    ]);
    if (currentSessionId() !== sessionId) return;

    const rows = mergedAccessoryRows(state, catalogRows);
    const checkpointById = new Map(rows.map(row => [row.variantId, checkpointState(row, state, transactions)]));
    const reusableCount = rows.filter(row => checkpointById.get(row.variantId)?.reusable).length;
    const recheckCount = rows.filter(row => checkpointById.get(row.variantId)?.item && !checkpointById.get(row.variantId)?.reusable).length;
    const eventSkuCount = rows.filter(row => nonNegativeInt(row.openingQty) > 0 || nonNegativeInt(row.restockQty) > 0 || int(row.openingCorrection) !== 0 || nonNegativeInt(row.skuSales) > 0).length;
    const backfillPlan = session?.status === "open" && session?.inventoryCount?.opening
      ? planAccessoryEventBackfill(session, catalogRows)
      : [];
    const backfillQuantity = backfillPlan.reduce((sum, row) => sum + row.quantity, 0);
    document.querySelector(`#${CARD_ID}`)?.remove();
    installStyles();
    const card = document.createElement("section");
    card.id = CARD_ID;
    card.className = "if-card";
    card.dataset.categoryFilter = "all";

    const counts = Object.fromEntries(CATEGORY_ORDER.map(cat => [cat, rows.filter(row => row.category === cat).length]));
    card.innerHTML = `
      <div class="ifa-top"><div><h3>アクセサリー在庫</h3><div class="if-muted">イベント中の予測残・補充・開始在庫修正・実数カウントをここで管理します。会社全体の実在庫を直接変更する画面ではありません。</div></div></div>
      <div class="ifa-stats">
        <div class="ifa-stat"><strong>${eventSkuCount}</strong><span>イベント内SKU</span></div>
        <div class="ifa-stat"><strong>${reusableCount}</strong><span>再カウント不要</span></div>
        <div class="ifa-stat"><strong>${recheckCount}</strong><span>要再確認</span></div>
      </div>
      <input class="ifa-search" type="search" placeholder="アクセサリー名・種類を検索">
      <div class="ifa-chips">
        <button type="button" class="ifa-chip active" data-cat="all">すべて ${rows.length}</button>
        ${CATEGORY_ORDER.map(cat => `<button type="button" class="ifa-chip" data-cat="${cat}">${CATEGORY_LABELS[cat]} ${counts[cat] || 0}</button>`).join("")}
      </div>
      ${backfillPlan.length ? `<details class="ifa-backfill-review" style="margin:10px 0"><summary>未登録のアクセサリーを実在庫から一括追加（${backfillPlan.length} SKU、${backfillQuantity}点）</summary><div class="if-muted">実際に持参していない品目はチェックを外してください。開始数や補充を登録済みのSKUは変更しません。Quick販売はSKU別に割り当てず、品目別の予測残数には反映しません。後で実数を確認してください。</div><div style="max-height:250px;overflow-y:auto;padding:8px 0">${backfillPlan.map(row => `<label style="display:flex;gap:8px;align-items:center;padding:6px 0"><input class="ifa-backfill-choice" type="checkbox" checked value="${esc(row.variantId)}" style="width:20px;height:20px;flex:none"><span>${esc(row.label)}　${esc(CATEGORY_LABELS[row.category] || row.category)}　${row.quantity}点</span></label>`).join("")}</div><button type="button" class="button ifa-backfill" style="width:100%;min-height:48px;margin:10px 0">選択したアクセサリーを登録</button></details>` : ""}
      ${!backfillPlan.length ? `<div class="if-muted" style="margin-top:9px">実在庫から追加する未登録SKUはありません。すでにイベント在庫にあるSKUは再追加しません。</div>` : ""}
      ${eventSkuCount ? `<button type="button" class="if-btn ifa-register-existing" style="margin-top:9px;min-height:42px">イベント在庫にあるアクセサリーのSKU商品登録を確認</button>` : ""}
      <div class="ifa-list">
        ${rows.map(row => {
          const cp = checkpointById.get(row.variantId);
          const active = nonNegativeInt(row.openingQty) > 0 || nonNegativeInt(row.restockQty) > 0 || int(row.openingCorrection) !== 0 || nonNegativeInt(row.skuSales) > 0;
          const value = cp?.reusable ? nonNegativeInt(cp.item?.physicalQty) : "";
          const stateClass = cp?.reusable ? "reuse" : cp?.item ? "recheck" : "";
          const stateText = cp?.reusable ? "✓ 再カウント不要" : cp?.item ? `要再確認${cp.reasons.length ? `：${cp.reasons.join(" / ")}` : ""}` : "";
          const meta = `開始 ${nonNegativeInt(row.openingQty)} / 売 ${nonNegativeInt(row.skuSales)}${nonNegativeInt(row.restockQty) ? ` / 補充 +${nonNegativeInt(row.restockQty)}` : ""}${int(row.openingCorrection) ? ` / 修正 ${int(row.openingCorrection) > 0 ? "+" : ""}${int(row.openingCorrection)}` : ""}`;
          const search = `${row.label} ${CATEGORY_LABELS[row.category] || row.category} ${row.sku || ""}`.toLocaleLowerCase("ja");
          return `<div class="ifa-row ${active ? "active-event" : ""} ${stateClass}" data-category="${esc(row.category)}" data-search="${esc(search)}">
            <div>
              <div class="ifa-name">${esc(row.label || row.sku || row.variantId)}</div>
              <div class="ifa-meta">${esc(CATEGORY_LABELS[row.category] || row.category)}<br>${esc(meta)}</div>
              ${stateText ? `<div class="ifa-state ${cp?.reusable ? "ok" : "warn"}">${esc(stateText)}</div>` : ""}
            </div>
            <div>
              <div class="ifa-expected ${Number(row.expectedQty) < 0 ? "ifa-negative" : ""}">予測 ${int(row.expectedQty)}</div>
              <div class="ifa-step">
                <button type="button" data-step="-1">−</button>
                <input class="if-count if-physical" type="number" inputmode="numeric" min="0" step="1" data-variant-id="${esc(row.variantId)}" value="${value}">
                <button type="button" data-step="1">＋</button>
              </div>
              <div class="ifa-actions"><button type="button" class="if-mini ifa-restock" data-id="${esc(row.variantId)}">補充</button><button type="button" class="if-mini ifa-correct" data-id="${esc(row.variantId)}">修正</button></div>
            </div>
          </div>`;
        }).join("")}
      </div>
      <div class="if-muted" style="margin-top:8px">途中カウント／日次保存ボタンはTシャツと共通です。入力したTシャツ・アクセサリーの実数を同じCheckpointへ保存します。</div>
    `;

    if (!placeCard(card)) return;
    hideLegacyAccessoryRows();

    card.querySelector(".ifa-backfill")?.addEventListener("click", async event => {
      const button = event.currentTarget;
      const selectedVariantIds = [...card.querySelectorAll(".ifa-backfill-choice:checked")].map(input => input.value);
      const selected = backfillPlan.filter(row => selectedVariantIds.includes(row.variantId));
      if (!selected.length) return window.alert("登録するアクセサリーを選択してください。");
      const selectedQuantity = selected.reduce((sum, row) => sum + row.quantity, 0);
      if (!window.confirm(`選択した ${selected.length} SKU、${selectedQuantity}点を、このイベントの在庫に追加しますか？\nQuick販売は個別SKUから減らしません。後で棚卸しが必要です。販売記録や会社全体の実在庫は変更しません。`)) return;
      button.disabled = true;
      try {
        const result = await backfillMissingAccessoryStock({
          sessionId, catalogRows, selectedVariantIds, recordedByEmail: currentEmail()
        });
        if (result.added) {
          try {
            const [catalog, registered] = await Promise.all([
              accessoryAdapter.getCatalogSnapshot(), listAllProductVariants()
            ]);
            const ids = new Set(result.variantIds);
            const registeredIds = new Set(registered.map(row => row.variantId || row.id));
            const missing = catalog.rows.filter(row => ids.has(row.variantId) && !registeredIds.has(row.variantId));
            if (missing.length) await syncAccessoryCatalogRows(missing);
            if (result.variantIds.some(id => !registeredIds.has(id) && !missing.some(row => row.variantId === id))) {
              window.alert("一部のアクセサリーはSKUに登録できませんでした。在庫画面で未登録SKUを確認してください。");
            }
          } catch (error) {
            window.alert("イベント在庫は登録しましたが、SKUの商品登録を確認してください。在庫画面に未登録SKUが表示されます。");
          }
        }
        renderedSessionKey = "";
        refreshInventoryFlowPanel();
      } catch (error) {
        button.disabled = false;
        window.alert(error?.message || String(error));
      }
    });

    card.querySelector(".ifa-register-existing")?.addEventListener("click", async event => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        const registered = await listAllProductVariants();
        const missing = missingAccessoryEventRows(rows, catalogRows, registered);
        if (!missing.length) {
          window.alert("イベント在庫にあるアクセサリーのSKU商品登録は完了しています。イベント在庫と販売履歴は変更していません。");
          return;
        }
        const names = missing.slice(0, 12).map(row => `${row.label}（${CATEGORY_LABELS[row.category] || row.category}）`).join("、");
        if (!window.confirm(`イベント在庫にある ${missing.length} SKUの商品登録を補完しますか？\n${names}${missing.length > 12 ? " ほか" : ""}\nイベント在庫の数量、実在庫、販売履歴は変更しません。`)) return;
        await syncAccessoryCatalogRows(missing.map(row => ({
          ...row, displayName: row.label, design: row.label, categoryLabel: CATEGORY_LABELS[row.category] || row.category
        })));
        window.alert(`${missing.length} SKUの商品登録を補完しました。在庫数と販売履歴は変更していません。`);
      } catch (error) {
        window.alert(error?.message || String(error));
      } finally {
        button.disabled = false;
      }
    });

    card.querySelector(".ifa-search")?.addEventListener("input", () => applyFilter(card));
    card.querySelectorAll(".ifa-chip").forEach(button => button.addEventListener("click", () => {
      card.dataset.categoryFilter = button.dataset.cat;
      card.querySelectorAll(".ifa-chip").forEach(item => item.classList.toggle("active", item === button));
      applyFilter(card);
    }));

    card.querySelectorAll(".ifa-step").forEach(stepper => {
      const input = stepper.querySelector("input");
      stepper.querySelectorAll("[data-step]").forEach(button => button.addEventListener("click", () => {
        const current = input.value === "" ? 0 : nonNegativeInt(input.value);
        input.value = String(Math.max(0, current + Number(button.dataset.step)));
      }));
    });

    const rowById = new Map(rows.map(row => [row.variantId, row]));
    const bindAdjustment = (selector, type) => {
      card.querySelectorAll(selector).forEach(button => button.addEventListener("click", async () => {
        const row = rowById.get(text(button.dataset.id));
        if (!row) return;
        const quantity = await adjustmentDialog(row, type);
        if (quantity === null) return;
        try {
          await addEventInventoryAdjustment({
            sessionId,
            type,
            variantId: row.variantId,
            quantity,
            recordedByEmail: currentEmail(),
            item: row
          });
          renderedSessionKey = "";
          refreshInventoryFlowPanel();
        } catch (error) {
          window.alert(error?.message || String(error));
        }
      }));
    };
    bindAdjustment(".ifa-restock", "restock");
    bindAdjustment(".ifa-correct", "opening_correction");

    renderedSessionKey = sessionKey;
  } catch (error) {
    console.warn("Accessory event inventory panel could not be prepared.", error);
  } finally {
    rendering = false;
  }
}

let scheduled = false;
function schedule(force = false) {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    void renderAccessoryCard(force);
  });
}

new MutationObserver(() => schedule()).observe(document.body, { childList: true, subtree: true });
document.addEventListener("change", event => {
  if (event.target?.id === "ifSession") {
    renderedSessionKey = "";
    setTimeout(() => schedule(true), 100);
  }
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) schedule(true);
});
schedule(true);
