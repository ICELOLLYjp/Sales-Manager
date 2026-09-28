import { listOpenEventSessions } from "./services/inventoryFlowService.js?v=20260926-accessory-backfill-1";
import { tshirtAdapter } from "./inventoryAdapters/tshirtAdapter.js";

const PANEL_ID = "inventoryFlowOverlay";
const ACTIVE_SESSION_KEY = "icelolly-sales-active-session";
const STYLE_ID = "inventoryFlowOperationalPolishStyles";

let currentOverlay = null;
let manualSessionSelection = false;
let applyingSession = false;
let scheduled = false;
let preferredRun = 0;

function text(value) {
  return String(value ?? "").trim();
}

function todayIso() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isCurrentPeriod(session, today = todayIso()) {
  const start = text(session?.startDate);
  const end = text(session?.endDate) || start;
  if (!start) return false;
  return start <= today && today <= end;
}

function activeSessionId() {
  return text(localStorage.getItem(ACTIVE_SESSION_KEY));
}

function installOperationalStyles() {
  let style = document.getElementById(STYLE_ID);
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #inventoryFlowAccessoryCard .ifa-list{
        display:grid!important;
        grid-template-columns:repeat(2,minmax(0,1fr))!important;
        gap:7px!important;
        align-items:stretch;
      }
      #inventoryFlowAccessoryCard .ifa-row{
        display:grid!important;
        grid-template-columns:1fr!important;
        gap:6px!important;
        align-content:start;
        padding:8px!important;
        min-width:0;
      }
      #inventoryFlowAccessoryCard .ifa-row[data-category="pierce"],
      #inventoryFlowAccessoryCard .ifa-row[data-category="earring"]{
        background:#fbfdfe!important;
        border-color:#e5f0f5!important;
      }
      #inventoryFlowAccessoryCard .ifa-row[data-category="drop_pierce"],
      #inventoryFlowAccessoryCard .ifa-row[data-category="drop_earring"]{
        background:#fffaf7!important;
        border-color:#f2e4dc!important;
      }
      #inventoryFlowAccessoryCard .ifa-name{
        min-height:2.7em;
        font-size:12px!important;
        line-height:1.35!important;
      }
      #inventoryFlowAccessoryCard .ifa-meta{
        font-size:9px!important;
        line-height:1.35!important;
      }
      #inventoryFlowAccessoryCard .ifa-expected{
        font-size:15px!important;
        margin-top:1px;
      }
      #inventoryFlowAccessoryCard .ifa-step{
        grid-template-columns:38px minmax(0,1fr) 38px!important;
        gap:4px!important;
        margin-top:3px!important;
      }
      #inventoryFlowAccessoryCard .ifa-step button,
      #inventoryFlowAccessoryCard .ifa-step input{
        height:38px!important;
      }
      #inventoryFlowAccessoryCard .ifa-step button{
        font-size:21px!important;
      }
      #inventoryFlowAccessoryCard .ifa-step input{
        font-size:16px!important;
      }
      #inventoryFlowAccessoryCard .ifa-actions{
        gap:4px!important;
        margin-top:4px!important;
      }
      #inventoryFlowAccessoryCard .ifa-actions .if-mini{
        min-height:30px;
        padding:4px 3px!important;
        font-size:9px!important;
      }
      #inventoryFlowAccessoryCard .ifa-chips{
        gap:6px!important;
      }
      #${PANEL_ID} .if-tshirt-fallback-note{
        margin:7px 0 0;
        padding:7px 8px;
        border-radius:8px;
        background:#f3f7fb;
        border:1px solid #dbe7f1;
        font-size:10px;
        line-height:1.45;
        color:#425466;
      }
      @media(max-width:380px){
        #inventoryFlowAccessoryCard .ifa-list{gap:5px!important}
        #inventoryFlowAccessoryCard .ifa-row{padding:6px!important}
        #inventoryFlowAccessoryCard .ifa-step{grid-template-columns:34px minmax(0,1fr) 34px!important}
        #inventoryFlowAccessoryCard .ifa-step button,#inventoryFlowAccessoryCard .ifa-step input{height:36px!important}
      }
    `;
    document.head.appendChild(style);
  } else if (document.head.lastElementChild !== style) {
    document.head.appendChild(style);
  }
}

function bindManualSelection(select) {
  if (select.dataset.inventoryPriorityBound === "1") return;
  select.dataset.inventoryPriorityBound = "1";
  select.addEventListener("change", () => {
    if (applyingSession) return;
    manualSessionSelection = true;
  });
}

async function resolvePreferredSession(select) {
  const sessions = await listOpenEventSessions();
  const available = new Set(Array.from(select.options).map(option => text(option.value)));
  const activeId = activeSessionId();
  const active = activeId && sessions.find(session => text(session.id) === activeId && available.has(activeId));
  if (active) return { id: activeId, label: "販売中" };

  const current = sessions.find(session => available.has(text(session.id)) && isCurrentPeriod(session));
  if (current) return { id: text(current.id), label: "開催中" };

  return { id: text(select.options[0]?.value), label: "" };
}

function relabelAndPrioritize(select, preferred) {
  const options = Array.from(select.options);
  const preferredOption = options.find(option => text(option.value) === preferred.id);
  if (!preferredOption) return;

  options.forEach(option => {
    const raw = option.dataset.baseLabel || text(option.textContent);
    const base = raw.replace(/^(販売中|開催中)\s*・\s*/, "");
    option.dataset.baseLabel = base;
    option.textContent = text(option.value) === preferred.id && preferred.label
      ? `${preferred.label} ・ ${base}`
      : base;
  });

  if (select.options[0] !== preferredOption) {
    select.insertBefore(preferredOption, select.options[0] || null);
  }
}

async function ensurePreferredSession(overlay) {
  const select = overlay?.querySelector("#ifSession");
  if (!select || !select.options.length) return;
  bindManualSelection(select);

  const run = ++preferredRun;
  let preferred;
  try {
    preferred = await resolvePreferredSession(select);
  } catch (error) {
    console.warn("Could not resolve preferred inventory session.", error);
    preferred = { id: activeSessionId() || text(select.options[0]?.value), label: activeSessionId() ? "販売中" : "" };
  }
  if (run !== preferredRun || !overlay.isConnected) return;

  relabelAndPrioritize(select, preferred);

  if (!manualSessionSelection && preferred.id && text(select.value) !== preferred.id) {
    applyingSession = true;
    select.value = preferred.id;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    window.setTimeout(() => {
      applyingSession = false;
    }, 0);
    return;
  }

  if (text(select.value) === preferred.id) {
    await ensureTshirtFallback(overlay, preferred.id);
  }
}

function tshirtCard(overlay) {
  return Array.from(overlay.querySelectorAll(".if-card"))
    .find(card => text(card.querySelector("h3")?.textContent) === "Tシャツ在庫ボード") || null;
}

function existingTshirtRows(card) {
  if (!card) return 0;
  return card.querySelectorAll(".if-matrix tbody tr").length;
}

function html(value) {
  return text(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function buildFallbackGroups() {
  const snapshot = await tshirtAdapter.getInventorySnapshot();
  const rows = Array.isArray(snapshot?.rows) ? snapshot.rows : [];
  const options = await tshirtAdapter.getMasterOptions();
  const sizeOptions = (options?.sizes || [])
    .filter(size => ["S", "M", "L", "XL", "XXL"].includes(text(size.name)))
    .sort((a, b) => Number(a.order || 999) - Number(b.order || 999));

  const groupMap = new Map();
  rows.forEach(row => {
    const key = `${row.bodyId}|${row.designId}|${row.colorId}`;
    if (!groupMap.has(key)) groupMap.set(key, row);
  });

  const result = [];
  for (const base of groupMap.values()) {
    const cells = [];
    for (const size of sizeOptions) {
      const draft = await tshirtAdapter.buildVariantDraft({
        bodyId: base.bodyId,
        designId: base.designId,
        colorId: base.colorId,
        sizeId: size.id
      });
      cells.push({ ...draft, sizeLabel: text(size.name) });
    }
    result.push({ base, cells });
  }
  return { groups: result, sizes: sizeOptions.map(size => text(size.name)) };
}

async function ensureTshirtFallback(overlay, sessionId) {
  if (!overlay?.isConnected || !sessionId) return;
  const select = overlay.querySelector("#ifSession");
  if (!select || text(select.value) !== sessionId) return;

  const card = tshirtCard(overlay);
  if (!card || existingTshirtRows(card) > 0 || card.dataset.fallbackLoading === "1") return;

  card.dataset.fallbackLoading = "1";
  try {
    const { groups, sizes } = await buildFallbackGroups();
    if (!overlay.isConnected || text(select.value) !== sessionId) return;
    if (existingTshirtRows(card) > 0) return;

    const table = card.querySelector(".if-matrix");
    const tbody = table?.querySelector("tbody");
    if (!table || !tbody) return;

    if (!card.querySelector(".if-tshirt-fallback-note")) {
      const note = document.createElement("div");
      note.className = "if-tshirt-fallback-note";
      note.textContent = "このSessionにTシャツ開始在庫が登録されていないため、現在のTシャツ実在庫を棚卸用に表示しています。入力欄は現在庫で開始し、＋／−または直接入力で数え直せます。";
      const muted = card.querySelector(".if-muted");
      muted?.insertAdjacentElement("afterend", note);
    }

    const headerCells = table.querySelectorAll("thead th");
    if (headerCells.length > 1 && sizes.length) {
      Array.from(headerCells).slice(1).forEach((th, index) => {
        if (sizes[index]) th.textContent = sizes[index];
      });
    }

    tbody.innerHTML = groups.map(({ base, cells }) => `
      <tr data-tshirt-fallback="1">
        <td>
          <div class="if-design">${html(base.design)}</div>
          <div class="if-detail">${html(`${base.body} / ${base.color}`)}</div>
        </td>
        ${cells.map(cell => {
          const qty = Math.max(0, Number(cell.quantity || 0));
          return `<td class="if-cell ${qty === 0 ? "if-soldout" : ""}">
            <div class="if-sub">現在庫 ${qty}</div>
            <div style="display:grid;grid-template-columns:28px 44px 28px;gap:3px;justify-content:center;align-items:center;margin-top:4px">
              <button type="button" class="if-mini if-fallback-step" data-step="-1" style="min-height:34px;font-size:18px;padding:0">−</button>
              <input class="if-count if-physical" type="number" inputmode="numeric" min="0" step="1" data-variant-id="${html(cell.variantId)}" value="${qty}" style="width:44px;min-height:34px;margin:0">
              <button type="button" class="if-mini if-fallback-step" data-step="1" style="min-height:34px;font-size:18px;padding:0">＋</button>
            </div>
          </td>`;
        }).join("")}
      </tr>
    `).join("");

    tbody.querySelectorAll(".if-fallback-step").forEach(button => {
      button.addEventListener("click", () => {
        const input = button.parentElement?.querySelector("input");
        if (!input) return;
        const current = input.value === "" ? 0 : Math.max(0, Math.trunc(Number(input.value) || 0));
        input.value = String(Math.max(0, current + Number(button.dataset.step || 0)));
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    });
  } catch (error) {
    console.warn("T-shirt fallback inventory could not be displayed.", error);
  } finally {
    card.dataset.fallbackLoading = "0";
  }
}

async function apply() {
  const overlay = document.getElementById(PANEL_ID);
  if (!overlay) {
    currentOverlay = null;
    manualSessionSelection = false;
    return;
  }

  if (overlay !== currentOverlay) {
    currentOverlay = overlay;
    manualSessionSelection = false;
    preferredRun += 1;
  }

  installOperationalStyles();
  await ensurePreferredSession(overlay);

  const select = overlay.querySelector("#ifSession");
  if (select?.value) {
    const sessionId = text(select.value);
    window.setTimeout(() => {
      if (overlay.isConnected && text(overlay.querySelector("#ifSession")?.value) === sessionId) {
        void ensureTshirtFallback(overlay, sessionId);
      }
    }, 350);
  }
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    void apply();
  });
}

schedule();
new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
window.addEventListener("storage", event => {
  if (event.key === ACTIVE_SESSION_KEY) {
    manualSessionSelection = false;
    schedule();
  }
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) schedule();
});
