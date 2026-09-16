import { getFirebaseState } from "./firebase.js";
import {
  loadEventUnregisteredItems,
  addEventUnregisteredItem,
  updateEventUnregisteredItemCount,
  removeEventUnregisteredItem
} from "./services/eventUnregisteredItemService.js?v=20260916-unregistered-items-1";

const INVENTORY_SESSION_KEY = "icelolly-sales-inventory-session";
const OVERLAY_ID = "inventoryFlowOverlay";
const CARD_ID = "eventUnregisteredItemsCard";
const CLOSE_PANEL_ID = "eventUnregisteredCloseNote";
const CATEGORY_LABELS = {
  tshirt: "Tシャツ",
  pierce: "ピアス",
  earring: "イヤリング",
  drop_pierce: "ドロップピアス",
  drop_earring: "ドロップイヤリング"
};

function text(value) { return String(value ?? "").trim(); }
function esc(value) {
  return text(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
function email() { return text(getFirebaseState()?.auth?.currentUser?.email); }
function selectedSessionId() {
  return text(document.querySelector(`#${OVERLAY_ID} #ifSession`)?.value) ||
    text(localStorage.getItem(INVENTORY_SESSION_KEY));
}
function currentCount(item) {
  const n = Number(item?.countedQty);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
}

function installStyles() {
  if (document.querySelector("#eventUnregisteredItemsStyles")) return;
  const style = document.createElement("style");
  style.id = "eventUnregisteredItemsStyles";
  style.textContent = `
    #${CARD_ID} .eui-head{display:flex;align-items:flex-start;gap:8px;justify-content:space-between}
    #${CARD_ID} .eui-warning{margin-top:7px;padding:8px;border:1px solid #efcf84;background:#fff8df;border-radius:9px;font-size:10px;line-height:1.5}
    #${CARD_ID} .eui-list{display:grid;gap:6px;margin-top:9px}
    #${CARD_ID} .eui-row{display:grid;grid-template-columns:minmax(0,1fr) 132px;gap:8px;padding:8px;border:1px dashed #c6a868;border-radius:10px;background:#fffdf7}
    #${CARD_ID} .eui-name{font-size:12px;font-weight:850}.eui-meta{font-size:9px;color:#777;line-height:1.45;margin-top:3px}
    #${CARD_ID} .eui-step{display:grid;grid-template-columns:38px 1fr 38px;gap:4px}.eui-step button{height:40px;border:1px solid #ccc;border-radius:8px;background:#fff;font-size:21px}.eui-step input{width:100%;min-width:0;height:40px;border:1px solid #bbb;border-radius:8px;text-align:center;font:inherit;font-weight:800}
    #${CARD_ID} .eui-row-actions{display:grid;grid-template-columns:1fr auto;gap:4px;margin-top:5px}.eui-row-actions button{min-height:34px}
    .eui-sheet-backdrop{position:fixed;inset:0;z-index:11000;background:rgba(0,0,0,.38);display:flex;align-items:flex-end;justify-content:center;padding:14px 10px calc(14px + env(safe-area-inset-bottom))}
    .eui-sheet{width:min(440px,100%);max-height:88vh;overflow:auto;background:#fff;border-radius:18px;padding:15px}.eui-sheet h3{margin:0 0 5px;font-size:17px}.eui-sheet .eui-note{font-size:11px;color:#666;line-height:1.5;margin-bottom:10px}
    .eui-field{display:grid;gap:4px;margin-top:8px}.eui-field label{font-size:10px;font-weight:800;color:#666}.eui-field input,.eui-field select{width:100%;min-height:44px;box-sizing:border-box;border:1px solid #ccc;border-radius:10px;padding:0 10px;font:inherit;font-size:16px;background:#fff}.eui-grid2{display:grid;grid-template-columns:1fr 1fr;gap:7px}.eui-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:13px}.eui-actions button{min-height:46px;border:1px solid #ccc;border-radius:11px;background:#fff;font:inherit;font-weight:800}.eui-actions .primary{background:#111;color:#fff;border-color:#111}
    #${CLOSE_PANEL_ID}{margin-top:8px;padding:9px;border:1px solid #efcf84;background:#fff8df;border-radius:10px;font-size:11px;line-height:1.45}
    @media(max-width:520px){#${CARD_ID} .eui-row{grid-template-columns:minmax(0,1fr) 122px}.eui-grid2{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);
}

function openAddSheet(sessionId, onSaved) {
  const backdrop = document.createElement("div");
  backdrop.className = "eui-sheet-backdrop";
  backdrop.innerHTML = `<div class="eui-sheet" role="dialog" aria-modal="true">
    <h3>未登録商品を追加</h3>
    <div class="eui-note">イベント内だけの一時商品です。正式SKU・会社実在庫には反映しません。後から正式SKUへ紐付けます。</div>
    <div class="eui-field"><label>カテゴリ</label><select id="euiCategory"><option value="tshirt">Tシャツ</option><option value="pierce">ピアス</option><option value="earring">イヤリング</option><option value="drop_pierce">ドロップピアス</option><option value="drop_earring">ドロップイヤリング</option></select></div>
    <div class="eui-field"><label>商品名 *</label><input id="euiLabel" placeholder="例：新作シャーク"></div>
    <div class="eui-field"><label>メモ / 詳細</label><input id="euiDetail" placeholder="特徴など"></div>
    <div id="euiTshirtFields" class="eui-grid2">
      <div class="eui-field"><label>Body</label><input id="euiBody" placeholder="Vintage など"></div>
      <div class="eui-field"><label>Color</label><input id="euiColor" placeholder="Gray など"></div>
      <div class="eui-field"><label>Size</label><input id="euiSize" placeholder="M など"></div>
    </div>
    <div class="eui-grid2">
      <div class="eui-field"><label>開始数（分かる場合のみ）</label><input id="euiOpening" type="number" inputmode="numeric" min="0" placeholder="不明なら空欄"></div>
      <div class="eui-field"><label>今ある実数（分かる場合）</label><input id="euiCounted" type="number" inputmode="numeric" min="0" placeholder="未確認なら空欄"></div>
    </div>
    <div id="euiError" class="eui-note" style="color:#a32d2d;margin-top:8px"></div>
    <div class="eui-actions"><button type="button" id="euiCancel">キャンセル</button><button type="button" class="primary" id="euiSave">追加する</button></div>
  </div>`;
  document.body.appendChild(backdrop);
  const category = backdrop.querySelector("#euiCategory");
  const toggle = () => backdrop.querySelector("#euiTshirtFields").style.display = category.value === "tshirt" ? "grid" : "none";
  category.addEventListener("change", toggle); toggle();
  const close = () => backdrop.remove();
  backdrop.querySelector("#euiCancel").addEventListener("click", close);
  backdrop.addEventListener("click", event => { if (event.target === backdrop) close(); });
  backdrop.querySelector("#euiSave").addEventListener("click", async event => {
    const button = event.currentTarget;
    const openingValue = backdrop.querySelector("#euiOpening").value;
    const countedValue = backdrop.querySelector("#euiCounted").value;
    button.disabled = true;
    try {
      await addEventUnregisteredItem({
        sessionId,
        category: category.value,
        label: backdrop.querySelector("#euiLabel").value,
        detail: backdrop.querySelector("#euiDetail").value,
        bodyName: backdrop.querySelector("#euiBody").value,
        colorName: backdrop.querySelector("#euiColor").value,
        sizeName: backdrop.querySelector("#euiSize").value,
        openingKnown: openingValue !== "",
        openingQty: openingValue === "" ? null : Number(openingValue),
        countedQty: countedValue === "" ? null : Number(countedValue),
        savedByEmail: email()
      });
      close();
      await onSaved();
    } catch (error) {
      backdrop.querySelector("#euiError").textContent = error?.message || String(error);
      button.disabled = false;
    }
  });
  setTimeout(() => backdrop.querySelector("#euiLabel")?.focus(), 80);
}

function placeCard(card) {
  const wrap = document.querySelector(`#${OVERLAY_ID} .if-wrap`);
  if (!wrap) return false;
  const history = [...wrap.querySelectorAll(":scope > .if-card")]
    .find(item => text(item.querySelector("h3")?.textContent) === "変更・カウント履歴");
  if (history) history.insertAdjacentElement("beforebegin", card);
  else wrap.appendChild(card);
  return true;
}

let rendering = false;
async function renderInventoryCard() {
  if (rendering || !document.querySelector(`#${OVERLAY_ID}`)) return;
  const sessionId = selectedSessionId();
  if (!sessionId) return;
  rendering = true;
  try {
    const result = await loadEventUnregisteredItems({ sessionId });
    if (selectedSessionId() !== sessionId) return;
    installStyles();
    document.querySelector(`#${CARD_ID}`)?.remove();
    const card = document.createElement("section");
    card.id = CARD_ID;
    card.className = "if-card";
    card.innerHTML = `<div class="eui-head"><div><h3>未登録商品</h3><div class="if-muted">正式SKUにまだ存在しない商品をイベント内だけで記録します。</div></div><button class="if-btn" id="euiAddButton" type="button">＋ 追加</button></div>
      <div class="eui-warning">ここで追加しても会社実在庫は変わりません。Quick販売とのSKU自動割当にも使わず、後から正式SKUへ紐付けるまで「未登録」のまま保持します。</div>
      <div class="eui-list">${result.items.length ? result.items.map(item => {
        const details = [CATEGORY_LABELS[item.category] || item.category, item.bodyName, item.colorName, item.sizeName, item.detail].filter(Boolean).join(" / ");
        const opening = item.openingKnown ? `開始 ${item.openingQty ?? 0}` : "開始数 不明";
        return `<div class="eui-row" data-temp-id="${esc(item.tempId)}"><div><div class="eui-name">${esc(item.label)}</div><div class="eui-meta">${esc(details)}<br>${esc(opening)} / 正式SKU未紐付け</div></div><div><div class="eui-step"><button type="button" data-delta="-1">−</button><input class="eui-count" type="number" inputmode="numeric" min="0" value="${item.countedQty === null ? "" : currentCount(item)}" placeholder="実数"><button type="button" data-delta="1">＋</button></div><div class="eui-row-actions"><button class="if-mini eui-save-count" type="button">実数保存</button><button class="if-mini eui-remove" type="button">取消</button></div></div></div>`;
      }).join("") : `<div class="if-muted" style="margin-top:8px">未登録商品はありません。</div>`}</div>`;
    if (!placeCard(card)) return;
    card.querySelector("#euiAddButton")?.addEventListener("click", () => openAddSheet(sessionId, renderInventoryCard));
    card.querySelectorAll(".eui-row").forEach(row => {
      const input = row.querySelector(".eui-count");
      row.querySelectorAll("[data-delta]").forEach(button => button.addEventListener("click", () => {
        const current = input.value === "" ? 0 : Number(input.value);
        input.value = String(Math.max(0, Math.trunc(Number.isFinite(current) ? current : 0) + Number(button.dataset.delta)));
      }));
      row.querySelector(".eui-save-count")?.addEventListener("click", async event => {
        if (input.value === "") return window.alert("実数を入力してください。");
        event.currentTarget.disabled = true;
        try {
          await updateEventUnregisteredItemCount({ sessionId, tempId: row.dataset.tempId, countedQty: input.value, savedByEmail: email() });
          await renderInventoryCard();
        } catch (error) { window.alert(error?.message || String(error)); event.currentTarget.disabled = false; }
      });
      row.querySelector(".eui-remove")?.addEventListener("click", async event => {
        if (!window.confirm("この未登録商品をイベント記録から取り消しますか？")) return;
        event.currentTarget.disabled = true;
        try { await removeEventUnregisteredItem({ sessionId, tempId: row.dataset.tempId }); await renderInventoryCard(); }
        catch (error) { window.alert(error?.message || String(error)); event.currentTarget.disabled = false; }
      });
    });
  } catch (error) {
    console.warn("Unregistered item card could not be rendered.", error);
  } finally {
    rendering = false;
  }
}

async function renderCloseNote() {
  const hub = document.querySelector("#eventCloseHub");
  const sessionId = text(localStorage.getItem(INVENTORY_SESSION_KEY));
  if (!hub || !sessionId) return;
  try {
    const result = await loadEventUnregisteredItems({ sessionId });
    document.querySelector(`#${CLOSE_PANEL_ID}`)?.remove();
    const pending = result.items.filter(item => !item.linkedVariantId && item.status !== "linked");
    if (!pending.length) return;
    installStyles();
    const note = document.createElement("div");
    note.id = CLOSE_PANEL_ID;
    note.innerHTML = `<strong>未登録商品 ${pending.length}件</strong><br>正式SKUにはまだ紐付いていません。会社実在庫へは反映せず、このイベント記録に残したまま終了できます。`;
    const reconcile = hub.querySelector(".ech-reconcile");
    if (reconcile) reconcile.insertAdjacentElement("beforebegin", note);
    else hub.appendChild(note);
  } catch (error) {
    console.warn("Unregistered item close note could not be rendered.", error);
  }
}

let scheduled = false;
function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    void renderInventoryCard();
    void renderCloseNote();
  });
}

schedule();
new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
document.addEventListener("visibilitychange", () => { if (!document.hidden) schedule(); });
window.addEventListener("focus", schedule);
