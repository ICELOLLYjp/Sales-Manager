import { loadDailyInventoryTrend } from "./services/eventDailyInventoryTrendService.js?v=20260916-daily-trend-1";

const FLOW_PANEL_ID = "inventoryFlowOverlay";
const DAILY_CARD_ID = "eventDailyCloseCard";
const OVERLAY_ID = "eventDailyTrendOverlay";
let loading = false;
let trend = null;
let filter = "all";
let searchText = "";

function text(value) { return String(value ?? "").trim(); }
function esc(value) {
  return text(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
function fmt(value) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? text(value) : d.toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
function catLabel(category) {
  return category === "tshirt" ? "Tシャツ" : ["pierce", "earring", "drop_pierce", "drop_earring"].includes(category) ? "アクセサリー" : category;
}
function statusLabel(cell) {
  if (!cell || cell.status === "unknown" || cell.physicalQty === null) return "不明";
  const prefix = cell.status === "inherited" ? "引継 " : "";
  return `${prefix}${Number(cell.physicalQty || 0)}`;
}
function installStyles() {
  if (document.querySelector("#eventDailyTrendStyles")) return;
  const style = document.createElement("style");
  style.id = "eventDailyTrendStyles";
  style.textContent = `
    #eventDailyTrendOpen{width:100%;min-height:44px;margin-top:7px;border:1px solid #c7d3df;border-radius:10px;background:#fff;font:800 12px system-ui,sans-serif}
    #${OVERLAY_ID}{position:fixed;inset:0;z-index:10100;background:#f6f6f3;overflow:auto;-webkit-overflow-scrolling:touch;color:#222}
    #${OVERLAY_ID} .edt-head{position:sticky;top:0;z-index:20;background:#fff;border-bottom:1px solid #ddd;padding:calc(10px + env(safe-area-inset-top)) 10px 9px;display:flex;align-items:center;gap:8px}
    #${OVERLAY_ID} .edt-head h2{font-size:16px;margin:0;flex:1}
    #${OVERLAY_ID} .edt-close{border:0;background:#eee;border-radius:9px;padding:8px 12px;font-size:14px}
    #${OVERLAY_ID} .edt-wrap{max-width:1050px;margin:auto;padding:10px 8px calc(70px + env(safe-area-inset-bottom))}
    #${OVERLAY_ID} .edt-card{background:#fff;border:1px solid #e3e3df;border-radius:13px;padding:10px;margin-bottom:9px}
    #${OVERLAY_ID} .edt-note{font-size:10px;line-height:1.5;color:#666}
    #${OVERLAY_ID} .edt-days{display:flex;gap:8px;overflow-x:auto;padding:2px 0 6px;scroll-snap-type:x proximity}
    #${OVERLAY_ID} .edt-day{min-width:210px;scroll-snap-align:start;border:1px solid #e0e0dc;border-radius:11px;padding:9px;background:#fff}
    #${OVERLAY_ID} .edt-day.current{border-color:#9eb7cf;background:#fbfdff}
    #${OVERLAY_ID} .edt-day-title{display:flex;justify-content:space-between;gap:8px;align-items:baseline;font-size:13px;font-weight:900}
    #${OVERLAY_ID} .edt-day-title span{font-size:9px;font-weight:500;color:#777}
    #${OVERLAY_ID} .edt-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px;margin-top:7px}
    #${OVERLAY_ID} .edt-stat{background:#f8f8f5;border-radius:8px;padding:6px}
    #${OVERLAY_ID} .edt-stat strong{display:block;font-size:15px}.edt-stat span{font-size:8px;color:#777}
    #${OVERLAY_ID} .edt-unknown{background:#fff7df}
    #${OVERLAY_ID} .edt-tools{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:7px;margin-bottom:8px}
    #${OVERLAY_ID} .edt-search{min-height:42px;border:1px solid #ccc;border-radius:9px;padding:0 9px;font-size:16px;min-width:0}
    #${OVERLAY_ID} .edt-filters{display:flex;gap:5px;flex-wrap:wrap}
    #${OVERLAY_ID} .edt-chip{min-height:42px;border:1px solid #ccc;border-radius:9px;background:#fff;padding:0 9px;font:700 11px system-ui,sans-serif}
    #${OVERLAY_ID} .edt-chip.active{background:#222;color:#fff;border-color:#222}
    #${OVERLAY_ID} .edt-table-wrap{overflow:auto;border:1px solid #e5e5e1;border-radius:10px;background:#fff}
    #${OVERLAY_ID} table{border-collapse:separate;border-spacing:0;min-width:640px;width:100%;font-size:10px}
    #${OVERLAY_ID} th,#${OVERLAY_ID} td{padding:7px 6px;border-right:1px solid #eee;border-bottom:1px solid #eee;text-align:center;vertical-align:middle}
    #${OVERLAY_ID} th{position:sticky;top:0;background:#fafafa;z-index:3}
    #${OVERLAY_ID} th:first-child,#${OVERLAY_ID} td:first-child{position:sticky;left:0;z-index:4;background:#fff;text-align:left;min-width:165px;max-width:165px}
    #${OVERLAY_ID} th:first-child{background:#fafafa;z-index:5}
    #${OVERLAY_ID} .edt-name{font-size:11px;font-weight:800;overflow-wrap:anywhere}.edt-detail{font-size:8px;color:#777;margin-top:2px}
    #${OVERLAY_ID} .edt-cell.unknown{background:#fff8e8;color:#8a6510}.edt-cell.inherited{background:#f1f7f1}.edt-cell.confirmed{font-weight:800}
    #${OVERLAY_ID} .edt-empty{text-align:center;padding:22px;color:#777}
    @media(max-width:430px){#${OVERLAY_ID} .edt-tools{grid-template-columns:1fr}#${OVERLAY_ID} .edt-day{min-width:190px}#${OVERLAY_ID} th:first-child,#${OVERLAY_ID} td:first-child{min-width:135px;max-width:135px}}
  `;
  document.head.appendChild(style);
}
function selectedSessionId() { return text(document.querySelector(`#${FLOW_PANEL_ID} #ifSession`)?.value); }
function dayCard(day) {
  return `<div class="edt-day ${day.current ? "current" : ""}">
    <div class="edt-day-title"><div>${esc(day.label)}</div><span>${day.current ? "現在" : esc(fmt(day.closedAtIso))}</span></div>
    <div class="edt-grid">
      <div class="edt-stat"><strong>${day.knownQty}</strong><span>確認できている実数合計</span></div>
      <div class="edt-stat ${day.unknownCount ? "edt-unknown" : ""}"><strong>${day.unknownCount}</strong><span>不明SKU</span></div>
      <div class="edt-stat"><strong>${day.tshirtKnownQty}</strong><span>Tシャツ確認数</span></div>
      <div class="edt-stat"><strong>${day.accessoryKnownQty}</strong><span>アクセサリー確認数</span></div>
      <div class="edt-stat"><strong>${day.exactSales}</strong><span>SKU販売</span></div>
      <div class="edt-stat"><strong>${day.quickSales}</strong><span>Quick販売</span></div>
      <div class="edt-stat"><strong>${day.restock}</strong><span>Restock</span></div>
      <div class="edt-stat"><strong>${day.openingCorrection > 0 ? "+" : ""}${day.openingCorrection}</strong><span>開始修正</span></div>
    </div>
  </div>`;
}
function filteredVariants() {
  if (!trend) return [];
  const q = searchText.toLocaleLowerCase("ja");
  return trend.variants.filter(row => {
    const groupOk = filter === "all" || (filter === "tshirt" ? row.category === "tshirt" : row.category !== "tshirt");
    const textOk = !q || `${row.label} ${row.detail} ${row.variantId}`.toLocaleLowerCase("ja").includes(q);
    return groupOk && textOk;
  });
}
function renderTable() {
  const target = document.querySelector(`#${OVERLAY_ID} #eventDailyTrendTable`);
  if (!target || !trend) return;
  const rows = filteredVariants();
  if (!rows.length) { target.innerHTML = `<div class="edt-empty">該当するSKUはありません。</div>`; return; }
  target.innerHTML = `<table><thead><tr><th>商品</th>${trend.days.map(day => `<th>${esc(day.current ? `Day ${day.dayNumber} 現在` : `Day ${day.dayNumber}`)}</th>`).join("")}</tr></thead><tbody>${rows.map(row => `<tr><td><div class="edt-name">${esc(row.label)}</div><div class="edt-detail">${esc([catLabel(row.category), row.detail].filter(Boolean).join(" / "))}</div></td>${trend.days.map(day => { const cell = row.days[day.key]; const cls = !cell || cell.status === "unknown" ? "unknown" : cell.status === "inherited" ? "inherited" : "confirmed"; return `<td class="edt-cell ${cls}">${esc(statusLabel(cell))}</td>`; }).join("")}</tr>`).join("")}</tbody></table>`;
}
function renderOverlay() {
  installStyles();
  document.querySelector(`#${OVERLAY_ID}`)?.remove();
  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.innerHTML = `<div class="edt-head"><h2>日別在庫推移</h2><button type="button" class="edt-close">閉じる</button></div><div class="edt-wrap">
    <div class="edt-card"><strong>${esc(trend?.eventName || "Event")}</strong><div class="edt-note" style="margin-top:4px">確認済みの実数・引継値・不明をDayごとに表示します。「確認できている実数合計」は、不明SKUがある日はイベント全在庫の合計ではありません。</div></div>
    <div class="edt-card"><div class="edt-days">${trend.days.map(dayCard).join("")}</div></div>
    <div class="edt-card"><div class="edt-tools"><input id="eventDailyTrendSearch" class="edt-search" type="search" placeholder="商品 / Design / SKUを検索"><div class="edt-filters"><button class="edt-chip active" data-filter="all">すべて</button><button class="edt-chip" data-filter="tshirt">Tシャツ</button><button class="edt-chip" data-filter="accessory">アクセサリー</button></div></div><div id="eventDailyTrendTable" class="edt-table-wrap"></div></div>
  </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector(".edt-close")?.addEventListener("click", () => overlay.remove());
  overlay.querySelector("#eventDailyTrendSearch")?.addEventListener("input", event => { searchText = text(event.target.value); renderTable(); });
  overlay.querySelectorAll(".edt-chip").forEach(button => button.addEventListener("click", () => { filter = button.dataset.filter || "all"; overlay.querySelectorAll(".edt-chip").forEach(b => b.classList.toggle("active", b === button)); renderTable(); }));
  renderTable();
}
async function openTrend() {
  const sessionId = selectedSessionId();
  if (!sessionId || loading) return;
  loading = true;
  try {
    trend = await loadDailyInventoryTrend({ sessionId });
    filter = "all"; searchText = "";
    renderOverlay();
  } catch (error) {
    window.alert(error?.message || String(error));
  } finally { loading = false; }
}
function ensureButton() {
  const card = document.querySelector(`#${DAILY_CARD_ID}`);
  if (!card || card.querySelector("#eventDailyTrendOpen")) return;
  const button = document.createElement("button");
  button.id = "eventDailyTrendOpen";
  button.type = "button";
  button.textContent = "日別在庫推移を見る";
  button.addEventListener("click", openTrend);
  const history = card.querySelector(".edc-history");
  if (history) history.insertAdjacentElement("beforebegin", button); else card.appendChild(button);
}
installStyles();
ensureButton();
new MutationObserver(ensureButton).observe(document.body, { childList: true, subtree: true });
