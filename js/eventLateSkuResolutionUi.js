import { getFirebaseState } from "./firebase.js";
import {
  loadLateSkuResolutionSummary,
  linkUnregisteredItemToSku,
  resolveClosedQuickGroupToSku
} from "./services/eventLateSkuResolutionService.js?v=20260916-late-sku-resolution-1";

const INVENTORY_SESSION_KEY = "icelolly-sales-inventory-session";
const HUB_CARD_ID = "eventLateSkuResolutionCard";
const INVENTORY_CARD_ID = "eventUnregisteredSkuLinkCard";
const OVERLAY_ID = "inventoryFlowOverlay";
const CATEGORY_LABELS = {
  tshirt: "Tシャツ",
  pierce: "ピアス",
  earring: "イヤリング",
  drop_pierce: "ドロップピアス",
  drop_earring: "ドロップイヤリング"
};

function text(value) { return String(value ?? "").trim(); }
function esc(value) {
  return text(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function currentEmail() { return text(getFirebaseState()?.auth?.currentUser?.email); }
function hubSessionId() { return text(localStorage.getItem(INVENTORY_SESSION_KEY)); }
function overlaySessionId() { return text(document.querySelector(`#${OVERLAY_ID} #ifSession`)?.value); }
function categoryLabel(value) { return CATEGORY_LABELS[text(value)] || text(value); }

function installStyles() {
  if (document.querySelector("#eventLateSkuResolutionStyles")) return;
  const style = document.createElement("style");
  style.id = "eventLateSkuResolutionStyles";
  style.textContent = `
    #${HUB_CARD_ID},#${INVENTORY_CARD_ID}{margin-top:10px;padding:11px;border:1px solid #d6c7f2;border-radius:12px;background:#faf7ff}
    .elsr-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}.elsr-title{font-size:13px;font-weight:900}.elsr-note{font-size:10px;line-height:1.5;color:#6e657a;margin-top:3px}
    .elsr-list{display:grid;gap:7px;margin-top:9px}.elsr-row{padding:8px;border:1px solid #e4dcf2;border-radius:9px;background:#fff;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center}.elsr-name{font-size:11px;font-weight:850}.elsr-meta{font-size:9px;line-height:1.45;color:#777;margin-top:3px}.elsr-row button{min-height:38px}
    .elsr-sheet-backdrop{position:fixed;inset:0;z-index:12000;background:rgba(0,0,0,.42);display:flex;align-items:flex-end;justify-content:center;padding:12px 9px calc(12px + env(safe-area-inset-bottom))}.elsr-sheet{width:min(470px,100%);max-height:90vh;overflow:auto;background:#fff;border-radius:18px;padding:14px}.elsr-sheet h3{margin:0 0 4px;font-size:17px}.elsr-sheet-note{font-size:10px;line-height:1.5;color:#666}.elsr-search{width:100%;min-height:44px;box-sizing:border-box;border:1px solid #ccc;border-radius:10px;padding:0 10px;font:inherit;font-size:16px;margin-top:10px}.elsr-qty{display:grid;grid-template-columns:48px 1fr 48px;gap:6px;align-items:center;margin-top:9px}.elsr-qty button{height:44px;border:1px solid #ccc;border-radius:9px;background:#fff;font-size:24px}.elsr-qty input{height:44px;width:100%;min-width:0;border:1px solid #bbb;border-radius:9px;text-align:center;font:inherit;font-weight:800;font-size:18px}.elsr-candidates{display:grid;gap:6px;margin-top:9px}.elsr-candidate{width:100%;text-align:left;padding:9px;border:1px solid #ddd;border-radius:10px;background:#fff;font:inherit}.elsr-candidate.selected{border-color:#5a42a8;background:#f2edff}.elsr-candidate strong{display:block;font-size:11px}.elsr-candidate span{display:block;font-size:9px;color:#777;line-height:1.4;margin-top:2px}.elsr-actions{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:12px}.elsr-actions button{min-height:46px;border:1px solid #ccc;border-radius:10px;background:#fff;font:inherit;font-weight:800}.elsr-actions .primary{background:#17131f;color:#fff;border-color:#17131f}.elsr-error{font-size:10px;color:#a32d2d;margin-top:8px;line-height:1.4}
    @media(max-width:520px){.elsr-row{grid-template-columns:minmax(0,1fr) 92px;padding:7px}.elsr-row button{padding:0 7px;font-size:10px}}
  `;
  document.head.appendChild(style);
}

function candidateSearchText(candidate) {
  return [candidate.label, candidate.detail, candidate.sku, candidate.variantId, candidate.body, candidate.color, candidate.size]
    .map(text).join(" ").toLocaleLowerCase("ja");
}

function candidateScore(candidate, target) {
  let score = 0;
  if (target.type === "quick" && target.tshirtBodyKey) {
    const key = text(target.tshirtBodyKey).toLocaleLowerCase("ja");
    if (text(candidate.bodyId).toLocaleLowerCase("ja") === key) score += 100;
    if (text(candidate.body).toLocaleLowerCase("ja") === key) score += 80;
  }
  if (target.type === "unregistered") {
    const label = text(target.label).toLocaleLowerCase("ja");
    if (label && text(candidate.label).toLocaleLowerCase("ja").includes(label)) score += 50;
    const size = text(target.sizeName).toLocaleLowerCase("ja");
    if (size && text(candidate.size).toLocaleLowerCase("ja") === size) score += 20;
    const color = text(target.colorName).toLocaleLowerCase("ja");
    if (color && text(candidate.color).toLocaleLowerCase("ja").includes(color)) score += 10;
  }
  return score;
}

function openCandidateSheet({ summary, target, onSaved }) {
  installStyles();
  const candidates = summary.candidates
    .filter(candidate => text(candidate.category) === text(target.category))
    .sort((a, b) => candidateScore(b, target) - candidateScore(a, target) || text(a.label).localeCompare(text(b.label), "ja"));

  const backdrop = document.createElement("div");
  backdrop.className = "elsr-sheet-backdrop";
  const isQuick = target.type === "quick";
  const maxQty = isQuick ? Number(target.quantity || 0) : 1;
  backdrop.innerHTML = `<div class="elsr-sheet" role="dialog" aria-modal="true">
    <h3>${isQuick ? "未特定販売をSKUへ確定" : "未登録商品を正式SKUへ紐付け"}</h3>
    <div class="elsr-sheet-note">
      <strong>${esc(target.label || categoryLabel(target.category))}</strong><br>
      ${esc(target.detail || "")}${target.unitPrice !== undefined ? `${target.detail ? " / " : ""}${esc(String(target.unitPrice))} ${esc(summary.currency)}` : ""}<br>
      ${isQuick
        ? "選んだ数量だけ正式実在庫を減算します。すでに反映済みの販売は二重処理しません。正式在庫が0でも紐付けでき、必要なら負在庫になります。"
        : "これは商品名の対応関係だけを記録します。紐付けだけでは会社実在庫を増減しません。"}
    </div>
    ${isQuick ? `<div class="elsr-qty"><button type="button" data-delta="-1">−</button><input id="elsrQty" type="number" inputmode="numeric" min="1" max="${maxQty}" value="${maxQty}"><button type="button" data-delta="1">＋</button></div>` : ""}
    <input id="elsrSearch" class="elsr-search" type="search" placeholder="商品名 / Body / Color / Sizeで検索">
    <div id="elsrCandidates" class="elsr-candidates"></div>
    <div id="elsrError" class="elsr-error"></div>
    <div class="elsr-actions"><button type="button" id="elsrCancel">キャンセル</button><button type="button" class="primary" id="elsrConfirm" disabled>このSKUに紐付け</button></div>
  </div>`;
  document.body.appendChild(backdrop);

  let selected = null;
  const search = backdrop.querySelector("#elsrSearch");
  const list = backdrop.querySelector("#elsrCandidates");
  const confirm = backdrop.querySelector("#elsrConfirm");
  const qtyInput = backdrop.querySelector("#elsrQty");

  function readQty() {
    if (!isQuick) return 1;
    const value = Math.trunc(Number(qtyInput?.value || 1));
    return Math.max(1, Math.min(maxQty, Number.isFinite(value) ? value : 1));
  }
  function setQty(value) {
    if (!qtyInput) return;
    qtyInput.value = String(Math.max(1, Math.min(maxQty, value)));
  }
  backdrop.querySelectorAll("[data-delta]").forEach(button => button.addEventListener("click", () => setQty(readQty() + Number(button.dataset.delta))));
  qtyInput?.addEventListener("change", () => setQty(readQty()));

  function renderCandidates() {
    const q = text(search.value).toLocaleLowerCase("ja");
    const filtered = candidates.filter(candidate => !q || candidateSearchText(candidate).includes(q)).slice(0, 30);
    list.innerHTML = filtered.length ? filtered.map(candidate => `
      <button type="button" class="elsr-candidate ${selected?.variantId === candidate.variantId ? "selected" : ""}" data-variant-id="${esc(candidate.variantId)}">
        <strong>${esc(candidate.label)}</strong>
        <span>${esc([candidate.detail, `正式在庫 ${candidate.currentStockQty}`].filter(Boolean).join(" / "))}</span>
      </button>`).join("") : `<div class="elsr-sheet-note" style="padding:10px 0">該当するSKUがありません。</div>`;
    list.querySelectorAll("[data-variant-id]").forEach(button => button.addEventListener("click", () => {
      selected = candidates.find(candidate => candidate.variantId === button.dataset.variantId) || null;
      confirm.disabled = !selected;
      renderCandidates();
    }));
  }
  search.addEventListener("input", renderCandidates);
  renderCandidates();

  const close = () => backdrop.remove();
  backdrop.querySelector("#elsrCancel").addEventListener("click", close);
  backdrop.addEventListener("click", event => { if (event.target === backdrop) close(); });
  confirm.addEventListener("click", async () => {
    if (!selected) return;
    confirm.disabled = true;
    backdrop.querySelector("#elsrError").textContent = "";
    try {
      if (isQuick) {
        const quantity = readQty();
        const ok = window.confirm(`${selected.label} に未特定販売 ${quantity} 点を確定します。\n正式実在庫を ${quantity} 点減算します。\n\nこの内容で進めますか？`);
        if (!ok) { confirm.disabled = false; return; }
        const result = await resolveClosedQuickGroupToSku({
          sessionId: summary.sessionId,
          groupKey: target.groupKey,
          variantId: selected.variantId,
          quantity,
          resolvedByEmail: currentEmail()
        });
        close();
        window.alert(result.stockWentNegative
          ? `${quantity} 点を紐付けました。正式在庫は ${result.stockAfter} 点になり、要確認の負在庫です。`
          : `${quantity} 点を ${selected.label} に紐付けました。未特定は残り ${result.unresolvedTotal} 点です。`);
      } else {
        const ok = window.confirm(`${target.label} を ${selected.label} に紐付けます。\nこの操作だけでは会社実在庫は変更しません。\n\nこの内容で進めますか？`);
        if (!ok) { confirm.disabled = false; return; }
        await linkUnregisteredItemToSku({
          sessionId: summary.sessionId,
          tempId: target.tempId,
          variantId: selected.variantId,
          linkedByEmail: currentEmail()
        });
        close();
        window.alert(`${target.label} を ${selected.label} に紐付けました。`);
      }
      await onSaved();
    } catch (error) {
      backdrop.querySelector("#elsrError").textContent = error?.message || String(error);
      confirm.disabled = false;
    }
  });
  setTimeout(() => search.focus(), 80);
}

function unregisteredRowsHtml(items) {
  return items.map(item => {
    const detail = [categoryLabel(item.category), item.bodyName, item.colorName, item.sizeName, item.detail].filter(Boolean).join(" / ");
    return `<div class="elsr-row"><div><div class="elsr-name">${esc(item.label)}</div><div class="elsr-meta">${esc(detail)}<br>イベント一時商品 → 正式SKU未紐付け</div></div><button type="button" class="if-mini elsr-link-unregistered" data-temp-id="${esc(item.tempId)}">SKU紐付け</button></div>`;
  }).join("");
}

function quickRowsHtml(groups, currency) {
  return groups.map(group => `<div class="elsr-row"><div><div class="elsr-name">${esc(categoryLabel(group.category))} × ${group.quantity}</div><div class="elsr-meta">${group.tshirtBodyKey ? `${esc(group.tshirtBodyKey)} / ` : ""}${esc(String(group.unitPrice))} ${esc(currency)}<br>正式在庫にはまだ ${group.quantity} 点未反映</div></div><button type="button" class="if-mini elsr-link-quick" data-group-key="${esc(group.groupKey)}">SKU確定</button></div>`).join("");
}

function bindCard(card, summary, onSaved, includeQuick) {
  card.querySelectorAll(".elsr-link-unregistered").forEach(button => button.addEventListener("click", () => {
    const item = summary.unregisteredItems.find(row => row.tempId === button.dataset.tempId);
    if (item) openCandidateSheet({ summary, target: { type: "unregistered", ...item }, onSaved });
  }));
  if (includeQuick) {
    card.querySelectorAll(".elsr-link-quick").forEach(button => button.addEventListener("click", () => {
      const group = summary.unresolvedQuickGroups.find(row => row.groupKey === button.dataset.groupKey);
      if (group) openCandidateSheet({ summary, target: { type: "quick", label: categoryLabel(group.category), ...group }, onSaved });
    }));
  }
}

function syncLegacyUnregisteredCard(summary) {
  const card = document.querySelector("#eventUnregisteredItemsCard");
  if (!card) return;
  const pendingIds = new Set(summary.unregisteredItems.map(item => item.tempId));
  let visibleCount = 0;
  card.querySelectorAll(".eui-row[data-temp-id]").forEach(row => {
    const visible = pendingIds.has(text(row.dataset.tempId));
    row.style.display = visible ? "" : "none";
    if (visible) visibleCount += 1;
  });
  card.querySelector("#elsrLegacyLinkedNote")?.remove();
  if (visibleCount === 0) {
    const list = card.querySelector(".eui-list");
    if (list) {
      const note = document.createElement("div");
      note.id = "elsrLegacyLinkedNote";
      note.className = "if-muted";
      note.style.marginTop = "8px";
      note.textContent = "未紐付けの一時商品はありません。";
      list.appendChild(note);
    }
  }
}

function placeHubCard(card) {
  const hub = document.querySelector("#eventCloseHub");
  if (!hub) return false;
  const reconcile = hub.querySelector(".ech-reconcile");
  if (reconcile) reconcile.insertAdjacentElement("beforebegin", card);
  else hub.appendChild(card);
  return true;
}

function placeInventoryCard(card) {
  const wrap = document.querySelector(`#${OVERLAY_ID} .if-wrap`);
  if (!wrap) return false;
  const unregistered = wrap.querySelector("#eventUnregisteredItemsCard");
  if (unregistered) unregistered.insertAdjacentElement("afterend", card);
  else {
    const history = [...wrap.querySelectorAll(":scope > .if-card")]
      .find(item => text(item.querySelector("h3")?.textContent) === "変更・カウント履歴");
    if (history) history.insertAdjacentElement("beforebegin", card);
    else wrap.appendChild(card);
  }
  return true;
}

let hubLoading = false;
let inventoryLoading = false;

async function renderHub(force = false) {
  if (hubLoading) return;
  const sessionId = hubSessionId();
  const hub = document.querySelector("#eventCloseHub");
  if (!sessionId || !hub) return;
  if (!force && document.querySelector(`#${HUB_CARD_ID}`)) return;
  hubLoading = true;
  try {
    const summary = await loadLateSkuResolutionSummary({ sessionId });
    if (hubSessionId() !== sessionId) return;
    document.querySelector(`#${HUB_CARD_ID}`)?.remove();
    const quickGroups = summary.sessionStatus === "closed" ? summary.unresolvedQuickGroups : [];
    if (!summary.unregisteredItems.length && !quickGroups.length) return;
    installStyles();
    const card = document.createElement("section");
    card.id = HUB_CARD_ID;
    card.innerHTML = `<div class="elsr-head"><div><div class="elsr-title">後からSKUを確定</div><div class="elsr-note">未登録商品は対応関係だけを記録。正式終了後の未特定Quickは、確定した数量だけ正式在庫へ1回反映します。</div></div></div><div class="elsr-list">${summary.unregisteredItems.length ? unregisteredRowsHtml(summary.unregisteredItems) : ""}${quickGroups.length ? quickRowsHtml(quickGroups, summary.currency) : ""}</div>`;
    if (!placeHubCard(card)) return;
    bindCard(card, summary, () => renderHub(true), true);
  } catch (error) {
    console.warn("Late SKU resolution hub could not be rendered.", error);
  } finally {
    hubLoading = false;
  }
}

async function renderInventory(force = false) {
  if (inventoryLoading) return;
  const sessionId = overlaySessionId();
  if (!sessionId || !document.querySelector(`#${OVERLAY_ID}`)) return;
  if (!force && document.querySelector(`#${INVENTORY_CARD_ID}`)) return;
  inventoryLoading = true;
  try {
    const summary = await loadLateSkuResolutionSummary({ sessionId });
    if (overlaySessionId() !== sessionId) return;
    document.querySelector(`#${INVENTORY_CARD_ID}`)?.remove();
    syncLegacyUnregisteredCard(summary);
    if (!summary.unregisteredItems.length) return;
    installStyles();
    const card = document.createElement("section");
    card.id = INVENTORY_CARD_ID;
    card.className = "if-card";
    card.innerHTML = `<div class="elsr-title">正式SKUへの紐付け</div><div class="elsr-note">イベント一時商品が正式SKUのどれだったか分かった時に使います。紐付けだけでは会社実在庫は変えません。</div><div class="elsr-list">${unregisteredRowsHtml(summary.unregisteredItems)}</div>`;
    if (!placeInventoryCard(card)) return;
    bindCard(card, summary, () => renderInventory(true), false);
  } catch (error) {
    console.warn("Unregistered SKU link card could not be rendered.", error);
  } finally {
    inventoryLoading = false;
  }
}

let scheduled = false;
function schedule(force = false) {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    void renderHub(force);
    void renderInventory(force);
  });
}

schedule();
new MutationObserver(() => schedule()).observe(document.body, { childList: true, subtree: true });
document.addEventListener("visibilitychange", () => { if (!document.hidden) schedule(true); });
window.addEventListener("focus", () => schedule(true));
