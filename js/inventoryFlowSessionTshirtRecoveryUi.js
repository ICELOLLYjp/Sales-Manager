import { getFirebaseState } from "./firebase.js";
import { tshirtAdapter } from "./inventoryAdapters/tshirtAdapter.js?v=20260915-empty-size-cells-1";
import { filterTshirtRowsForEventGroups } from "./services/eventTshirtDesigns.mjs?v=20260926-group-compat-1";
import { loadEventInventoryFlow, saveEventInventoryCheckpoint } from "./services/inventoryFlowService.js?v=20260913-inventory-flow-1";

const PANEL_ID = "inventoryFlowOverlay";
const CARD_CLASS = "if-tshirt-fallback-card";
const SIZES = ["S", "M", "L", "XL", "XXL"];
let loading = false;
let saving = false;

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

function selectedSessionId() {
  return text(document.querySelector(`#${PANEL_ID} #ifSession`)?.value);
}

function currentEmail() {
  return text(getFirebaseState()?.auth?.currentUser?.email);
}

function findTshirtCard(overlay) {
  return [...overlay.querySelectorAll(":scope .if-card")]
    .find(card => text(card.querySelector("h3")?.textContent) === "Tシャツ在庫ボード") || null;
}

function ensureTshirtCard(overlay) {
  const existing = findTshirtCard(overlay);
  if (existing) return existing;

  const wrap = overlay.querySelector(".if-wrap");
  if (!wrap) return null;

  const card = document.createElement("section");
  card.className = `if-card ${CARD_CLASS}`;
  card.innerHTML = `<h3>Tシャツ在庫ボード</h3>`;

  const accessory = document.getElementById("inventoryFlowAccessoryCard");
  if (accessory?.parentElement === wrap) {
    accessory.insertAdjacentElement("beforebegin", card);
  } else {
    wrap.appendChild(card);
  }
  return card;
}

function installStyles() {
  if (document.getElementById("inventoryFlowSessionTshirtRecoveryStyles")) return;
  const style = document.createElement("style");
  style.id = "inventoryFlowSessionTshirtRecoveryStyles";
  style.textContent = `
    #${PANEL_ID} .if-session-tshirt-note{margin:8px 0}
    #${PANEL_ID} .if-session-tshirt-cell{min-width:118px!important;padding:8px 5px!important;background:#fff!important}
    #${PANEL_ID} .if-session-tshirt-stepper{display:grid;grid-template-columns:32px 48px 32px;gap:4px;align-items:center;justify-content:center;width:max-content;margin:0 auto}
    #${PANEL_ID} .if-session-tshirt-stepper button{width:32px;height:38px;padding:0;border:1px solid #c9c9c4;border-radius:9px;background:#fff;color:#222;font:800 21px/1 system-ui,sans-serif;touch-action:manipulation}
    #${PANEL_ID} .if-session-tshirt-stepper input{box-sizing:border-box;width:48px!important;min-width:48px!important;height:38px;margin:0!important;padding:0 3px!important;border:1.5px solid #aaa;border-radius:9px;background:#fff;color:#111;text-align:center;font:800 18px/1 system-ui,sans-serif}
    #${PANEL_ID} .if-session-tshirt-status{min-height:18px;margin-top:7px;font-size:10px;font-weight:700;color:#28713d}
    #${PANEL_ID} .if-session-tshirt-save{width:100%;min-height:46px;margin-top:10px;border:1px solid #222;border-radius:10px;background:#222;color:#fff;font:800 13px system-ui,sans-serif}
    #${PANEL_ID} .if-session-tshirt-save:disabled{opacity:.5}
  `;
  document.head.appendChild(style);
}

function groupRows(rows) {
  const groups = new Map();
  (Array.isArray(rows) ? rows : []).forEach(row => {
    const key = [text(row.designId), text(row.bodyId), text(row.colorId)].join("|||");
    if (!groups.has(key)) {
      groups.set(key, {
        design: text(row.design),
        body: text(row.body),
        color: text(row.color),
        rows: []
      });
    }
    groups.get(key).rows.push(row);
  });
  return [...groups.values()];
}

function inputValue({ variantId, stateById, openingIds, latestPhysical }) {
  if (latestPhysical.has(variantId)) return String(latestPhysical.get(variantId));
  if (!openingIds.has(variantId)) return "";
  const stateRow = stateById.get(variantId);
  return String(Math.max(0, Math.trunc(Number(stateRow?.expectedQty || 0))));
}

function cellStatus({ variantId, stateById, openingIds, latestPhysical }) {
  if (latestPhysical.has(variantId)) return "前回実数";
  if (!openingIds.has(variantId)) return "開始不明";
  const stateRow = stateById.get(variantId);
  return `予測 ${Math.max(0, Math.trunc(Number(stateRow?.expectedQty || 0)))}`;
}

function bindSteppers(card) {
  card.querySelectorAll(".if-session-tshirt-step").forEach(button => {
    button.addEventListener("click", () => {
      const input = button.parentElement?.querySelector(".if-session-tshirt-input");
      if (!input) return;
      const current = input.value === "" ? 0 : Math.max(0, Math.trunc(Number(input.value) || 0));
      const next = Math.max(0, current + Number(button.dataset.step || 0));
      input.value = String(next);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      if (navigator.vibrate) navigator.vibrate(8);
    });
  });
}

function collectCounts(card) {
  return [...card.querySelectorAll(".if-session-tshirt-input[data-variant-id]")]
    .filter(input => input.value !== "")
    .map(input => ({
      variantId: text(input.dataset.variantId),
      physicalQty: Math.max(0, Math.trunc(Number(input.value) || 0))
    }))
    .filter(item => item.variantId);
}

async function saveCounts(card, button, status) {
  if (saving) return;
  const sessionId = selectedSessionId();
  const items = collectCounts(card);
  if (!sessionId) return;
  if (!items.length) {
    window.alert("Tシャツの実数を1SKU以上入力してください。空欄は不明のまま残します。");
    return;
  }

  if (!window.confirm(`入力した ${items.length} SKUを、このSessionの途中カウントとして保存します。\n空欄は不明のまま残します。\n会社全体の実在庫は変更しません。\n\n進めますか？`)) return;

  saving = true;
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "Sessionへ保存中…";
  status.textContent = "";

  try {
    await saveEventInventoryCheckpoint({
      sessionId,
      items,
      type: "checkpoint",
      label: "Tシャツ実数",
      capturedByEmail: currentEmail()
    });
    status.textContent = `${items.length} SKUをSessionの途中カウントに保存しました。`;
    const select = document.querySelector(`#${PANEL_ID} #ifSession`);
    window.setTimeout(() => select?.dispatchEvent(new Event("change", { bubbles: true })), 150);
  } catch (error) {
    window.alert(error?.message || String(error));
  } finally {
    saving = false;
    button.disabled = false;
    button.textContent = original;
  }
}

async function renderSessionTshirts() {
  const overlay = document.getElementById(PANEL_ID);
  const sessionId = selectedSessionId();
  if (!overlay || !sessionId || loading) return;

  loading = true;
  try {
    installStyles();
    const card = ensureTshirtCard(overlay);
    if (!card) return;

    card.classList.add(CARD_CLASS);
    card.dataset.inventoryTshirtFallbackReady = "1";
    card.querySelector(".if-tshirt-stock-commit")?.remove();

    const [flow, snapshot] = await Promise.all([
      loadEventInventoryFlow(sessionId),
      tshirtAdapter.getInventorySnapshot()
    ]);
    if (!overlay.isConnected || selectedSessionId() !== sessionId) return;

    const allRows = Array.isArray(snapshot?.rows) ? snapshot.rows : [];
    const state = flow.state;
    const sessionRows = filterTshirtRowsForEventGroups(
      allRows,
      state.opening,
      state.flowEntries,
      state.soldByVariant
    );

    const groups = groupRows(sessionRows);
    const stateById = new Map((state.rows || []).map(row => [text(row.variantId), row]));
    const openingIds = new Set((state.opening || []).map(row => text(row.variantId)));
    const latestPhysical = new Map(
      (state.latestCheckpoint?.items || [])
        .filter(item => item?.physicalQty !== null && item?.physicalQty !== undefined)
        .map(item => [text(item.variantId), Math.max(0, Math.trunc(Number(item.physicalQty) || 0))])
    );

    if (!groups.length) {
      card.innerHTML = `
        <h3>Tシャツ在庫ボード</h3>
        <div class="if-warning if-session-tshirt-note">このSessionにはTシャツの開始在庫行がなく、Tシャツの販売・補充・開始在庫修正履歴からも対象カラーを確認できません。会社全体の現在庫は表示しません。</div>
        <div class="if-empty">このSessionで確認できるTシャツSKUはありません。</div>`;
      return;
    }

    card.innerHTML = `
      <h3>Tシャツ在庫ボード</h3>
      <div class="if-warning if-session-tshirt-note">Tシャツの開始在庫行が不足しているため、このSession内の販売・補充・開始在庫修正履歴から関係するカラーだけを復元表示しています。会社全体の他カラーは表示しません。開始数を確認できないSKUは空欄＝不明のままです。</div>
      <div class="if-matrix-wrap">
        <table class="if-matrix">
          <thead><tr><th>Design / Body / Color</th>${SIZES.map(size => `<th>${size}</th>`).join("")}</tr></thead>
          <tbody>
            ${groups.map(group => `
              <tr>
                <td><div class="if-design">${esc(group.design)}</div><div class="if-detail">${esc(`${group.body} / ${group.color}`)}</div></td>
                ${SIZES.map(size => {
                  const row = group.rows.find(item => text(item.size) === size);
                  if (!row?.variantId) return `<td class="if-cell"></td>`;
                  const variantId = text(row.variantId);
                  const value = inputValue({ variantId, stateById, openingIds, latestPhysical });
                  const statusLabel = cellStatus({ variantId, stateById, openingIds, latestPhysical });
                  return `<td class="if-cell if-session-tshirt-cell">
                    <div class="if-sub">${esc(statusLabel)}</div>
                    <div class="if-session-tshirt-stepper">
                      <button type="button" class="if-session-tshirt-step" data-step="-1" aria-label="${esc(`${group.design} ${group.color} ${size} を1減らす`)}">−</button>
                      <input class="if-count if-physical if-session-tshirt-input" type="number" inputmode="numeric" min="0" step="1" data-variant-id="${esc(variantId)}" value="${esc(value)}" placeholder="?" aria-label="${esc(`${group.design} ${group.color} ${size} 実数`)}">
                      <button type="button" class="if-session-tshirt-step" data-step="1" aria-label="${esc(`${group.design} ${group.color} ${size} を1増やす`)}">＋</button>
                    </div>
                  </td>`;
                }).join("")}
              </tr>`).join("")}
          </tbody>
        </table>
      </div>
      <button type="button" class="if-session-tshirt-save">Tシャツ実数をSessionに保存</button>
      <div class="if-session-tshirt-status" aria-live="polite"></div>`;

    bindSteppers(card);
    const saveButton = card.querySelector(".if-session-tshirt-save");
    const status = card.querySelector(".if-session-tshirt-status");
    saveButton?.addEventListener("click", () => void saveCounts(card, saveButton, status));
  } catch (error) {
    console.warn("Session-scoped T-shirt recovery board could not be prepared.", error);
  } finally {
    loading = false;
  }
}

let scheduled = false;
function schedule(delay = 0) {
  if (scheduled) return;
  scheduled = true;
  window.setTimeout(() => {
    scheduled = false;
    void renderSessionTshirts();
  }, delay);
}

new MutationObserver(() => schedule(40)).observe(document.body, { childList: true, subtree: true });
document.addEventListener("change", event => {
  if (event.target?.id === "ifSession") schedule(120);
}, true);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) schedule(120);
});
window.addEventListener("focus", () => schedule(120));
schedule(600);
