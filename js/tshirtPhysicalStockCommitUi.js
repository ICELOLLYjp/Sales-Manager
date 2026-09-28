import { getFirebaseState } from "./firebase.js";
import { loadTshirtProductVariants } from "./services/catalogService.js";
import { saveTshirtPhysicalStock } from "./services/tshirtPhysicalStockService.js?v=20260928-physical-stock-1";

const PANEL_ID = "inventoryFlowOverlay";
const ACTION_ID = "ifSaveTshirtPhysicalStock";
const SIZES = ["S", "M", "L", "XL", "XXL"];
const fallbackFirstSeen = new WeakMap();
let variantsCache = null;
let variantsLoadedAt = 0;
let running = false;

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

function norm(value) {
  return text(value).toLocaleLowerCase("ja");
}

function currentEmail() {
  return text(getFirebaseState()?.auth?.currentUser?.email);
}

function selectedSessionId() {
  return text(document.querySelector(`#${PANEL_ID} #ifSession`)?.value);
}

function findTshirtCard() {
  const overlay = document.getElementById(PANEL_ID);
  if (!overlay) return null;
  return [...overlay.querySelectorAll(":scope .if-card")]
    .find(card => text(card.querySelector("h3")?.textContent) === "Tシャツ在庫ボード") || null;
}

function installStyles() {
  if (document.getElementById("tshirtPhysicalStockCommitStyles")) return;
  const style = document.createElement("style");
  style.id = "tshirtPhysicalStockCommitStyles";
  style.textContent = `
    #${PANEL_ID} .if-tshirt-stock-commit{
      margin-top:10px;
      padding-top:10px;
      border-top:1px solid #ecece7;
    }
    #${PANEL_ID} .if-tshirt-stock-commit-note{
      font-size:10px;
      line-height:1.45;
      color:#666;
      margin-bottom:7px;
    }
    #${PANEL_ID} #${ACTION_ID}{
      width:100%;
      min-height:46px;
      border:1px solid #176f3a;
      border-radius:10px;
      background:#176f3a;
      color:#fff;
      font:800 13px system-ui,sans-serif;
      touch-action:manipulation;
    }
    #${PANEL_ID} #${ACTION_ID}:disabled{opacity:.5}
    #${PANEL_ID} .if-tshirt-stock-commit-status{
      min-height:16px;
      margin-top:6px;
      font-size:10px;
      font-weight:700;
      color:#28713d;
    }
    #${PANEL_ID} .if-tshirt-zero-cell{background:#fff!important}
    #${PANEL_ID} .if-tshirt-zero-cell .if-sub{margin-bottom:3px}
  `;
  document.head.appendChild(style);
}

async function registeredVariants() {
  if (variantsCache && Date.now() - variantsLoadedAt < 30000) return variantsCache;
  const rows = await loadTshirtProductVariants();
  variantsCache = (Array.isArray(rows) ? rows : []).filter(row => {
    if (row?.active === false) return false;
    const saleStatus = norm(row?.saleStatus);
    if (["inactive", "disabled", "retired", "archived"].includes(saleStatus)) return false;
    return text(row?.variantId || row?.id) && SIZES.includes(text(row?.size));
  });
  variantsLoadedAt = Date.now();
  return variantsCache;
}

function variantGroupKey(row) {
  return [norm(row?.design), norm(row?.body), norm(row?.color)].join("|||");
}

function domRowKey(row) {
  const design = norm(row.querySelector(".if-design")?.textContent);
  const detail = text(row.querySelector(".if-detail")?.textContent);
  const parts = detail.split("/").map(item => norm(item)).filter(Boolean);
  return [design, parts[0] || "", parts[1] || ""].join("|||");
}

function createLabelCell(variant) {
  const cell = document.createElement("td");
  cell.innerHTML = `<div class="if-design">${esc(variant.design)}</div><div class="if-detail">${esc(`${variant.body} / ${variant.color}`)}</div>`;
  return cell;
}

function createEmptyCell() {
  const cell = document.createElement("td");
  cell.className = "if-cell";
  return cell;
}

function fillZeroCell(cell, variant) {
  if (!cell || cell.querySelector(".if-physical")) return;
  const variantId = text(variant?.variantId || variant?.id);
  if (!variantId) return;
  const label = `${text(variant.design)} ${text(variant.color)} ${text(variant.size)}`.trim();
  cell.className = "if-cell if-tshirt-fallback-cell if-tshirt-zero-cell";
  cell.innerHTML = `
    <div class="if-sub">現在実在庫</div>
    <div class="if-tshirt-fallback-stepper">
      <button type="button" class="if-tshirt-zero-step" data-step="-1" aria-label="${esc(`${label} を1減らす`)}">−</button>
      <input class="if-count if-physical if-tshirt-fallback-input if-tshirt-zero-input" type="number" inputmode="numeric" min="0" step="1" data-variant-id="${esc(variantId)}" value="0" aria-label="${esc(`${label} 実数`)}">
      <button type="button" class="if-tshirt-zero-step" data-step="1" aria-label="${esc(`${label} を1増やす`)}">＋</button>
    </div>`;
}

async function addRegisteredZeroInputs(card) {
  if (!card?.classList.contains("if-tshirt-fallback-card")) return;
  const tbody = card.querySelector(".if-matrix tbody");
  if (!tbody) return;

  if (!fallbackFirstSeen.has(card)) fallbackFirstSeen.set(card, Date.now());
  const hasRows = Boolean(tbody.querySelector("tr"));
  const fallbackLoaderStarted = card.dataset.inventoryTshirtFallbackReady === "1";
  const waitedLongEnough = Date.now() - fallbackFirstSeen.get(card) > 3500;
  if (!hasRows && !(fallbackLoaderStarted && waitedLongEnough)) return;

  let variants;
  try {
    variants = await registeredVariants();
  } catch (error) {
    console.warn("Registered zero-stock T-shirt variants could not be loaded.", error);
    return;
  }

  const rowByKey = new Map();
  tbody.querySelectorAll("tr").forEach(row => rowByKey.set(domRowKey(row), row));

  const groups = new Map();
  variants.forEach(variant => {
    const key = variantGroupKey(variant);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(variant);
  });

  groups.forEach(groupVariants => {
    const sample = groupVariants[0];
    const key = variantGroupKey(sample);
    let row = rowByKey.get(key);
    if (!row) {
      row = document.createElement("tr");
      row.className = "if-tshirt-fallback-row if-tshirt-registered-zero-row";
      row.appendChild(createLabelCell(sample));
      SIZES.forEach(() => row.appendChild(createEmptyCell()));
      tbody.appendChild(row);
      rowByKey.set(key, row);
    }

    groupVariants.forEach(variant => {
      const sizeIndex = SIZES.indexOf(text(variant.size));
      if (sizeIndex < 0) return;
      const cell = row.children[sizeIndex + 1];
      fillZeroCell(cell, variant);
    });
  });
}

function collectPhysicalRows(card) {
  const map = new Map();
  card.querySelectorAll(".if-physical[data-variant-id]").forEach(input => {
    if (input.value === "") return;
    const variantId = text(input.dataset.variantId);
    const raw = Number(input.value);
    if (!variantId || !Number.isFinite(raw) || raw < 0) return;
    map.set(variantId, {
      variantId,
      quantity: Math.max(0, Math.trunc(raw))
    });
  });
  return [...map.values()];
}

async function savePhysicalStock(card, button, status) {
  if (running) return;
  const rows = collectPhysicalRows(card);
  if (!rows.length) {
    window.alert("Tシャツの実数を1点以上入力してください。");
    return;
  }

  const zeroCount = rows.filter(row => row.quantity === 0).length;
  const ok = window.confirm(
    `入力中の ${rows.length} SKUをTシャツの正式な現在庫へ反映します。\n` +
    `0で入力した ${zeroCount} SKUも在庫0として保存します。\n\n` +
    "この操作は tshirtStock/master の実在庫を更新します。進めますか？"
  );
  if (!ok) return;

  running = true;
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "実在庫へ反映中…";
  status.textContent = "";

  try {
    const result = await saveTshirtPhysicalStock({
      rows,
      sessionId: selectedSessionId(),
      savedByEmail: currentEmail(),
      source: card.classList.contains("if-tshirt-fallback-card")
        ? "inventory_flow_fallback_physical_count"
        : "inventory_flow_physical_count"
    });

    card.querySelectorAll(".if-physical[data-variant-id]").forEach(input => {
      if (input.value !== "") input.dataset.savedPhysicalQty = String(Math.max(0, Math.trunc(Number(input.value) || 0)));
    });

    status.textContent = `正式在庫へ反映済み：${result.savedCount} SKU（変更 ${result.changedCount} SKU）`;
    window.dispatchEvent(new CustomEvent("inventory:tshirt-stock-updated", {
      detail: { ...result, sessionId: selectedSessionId() }
    }));
  } catch (error) {
    window.alert(error?.message || String(error));
  } finally {
    running = false;
    button.disabled = false;
    button.textContent = original;
  }
}

function ensureCommitAction(card) {
  if (!card || card.querySelector(`#${ACTION_ID}`)) return;
  const host = document.createElement("div");
  host.className = "if-tshirt-stock-commit";
  host.innerHTML = `
    <div class="if-tshirt-stock-commit-note">入力した実数をTシャツの正式な現在庫へ保存します。0も有効な実数として反映します。</div>
    <button type="button" id="${ACTION_ID}">Tシャツ実数を保存・現在庫へ反映</button>
    <div class="if-tshirt-stock-commit-status" aria-live="polite"></div>`;
  card.appendChild(host);
  const button = host.querySelector(`#${ACTION_ID}`);
  const status = host.querySelector(".if-tshirt-stock-commit-status");
  button.addEventListener("click", () => void savePhysicalStock(card, button, status));
}

function bindZeroStepperDelegation() {
  if (document.documentElement.dataset.tshirtZeroStepperBound === "1") return;
  document.documentElement.dataset.tshirtZeroStepperBound = "1";
  document.addEventListener("click", event => {
    const button = event.target.closest?.(".if-tshirt-zero-step");
    if (!button) return;
    const input = button.parentElement?.querySelector(".if-tshirt-zero-input");
    if (!input) return;
    const current = Math.max(0, Math.trunc(Number(input.value) || 0));
    input.value = String(Math.max(0, current + Number(button.dataset.step || 0)));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    if (navigator.vibrate) navigator.vibrate(8);
  });
}

let scheduled = false;
function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    installStyles();
    bindZeroStepperDelegation();
    const card = findTshirtCard();
    if (!card) return;
    ensureCommitAction(card);
    void addRegisteredZeroInputs(card);
  });
}

schedule();
new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
document.addEventListener("change", event => {
  if (event.target?.id === "ifSession") schedule();
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) schedule();
});
window.addEventListener("focus", schedule);
