import { tshirtAdapter } from "./inventoryAdapters/tshirtAdapter.js?v=20260915-empty-size-cells-1";

const PANEL_ID = "inventoryFlowOverlay";
const ACCESSORY_CARD_ID = "inventoryFlowAccessoryCard";
const TSHIRT_FALLBACK_MARKER = "inventoryTshirtFallbackReady";
const SIZES = ["S", "M", "L", "XL", "XXL"];

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

function installStyles() {
  if (document.getElementById("inventoryFlowDisplayPolishStyles")) return;
  const style = document.createElement("style");
  style.id = "inventoryFlowDisplayPolishStyles";
  style.textContent = `
    #${ACCESSORY_CARD_ID} .ifa-chips{
      display:grid!important;
      grid-template-columns:repeat(2,minmax(0,1fr));
      gap:6px!important;
      overflow:visible!important;
    }
    #${ACCESSORY_CARD_ID} .ifa-chip{
      width:100%;
      min-height:40px!important;
      border-radius:10px!important;
      padding:6px 8px!important;
      font-size:11px!important;
    }
    #${ACCESSORY_CARD_ID} .ifa-chip[data-cat="all"]{grid-column:1/-1}
    #${ACCESSORY_CARD_ID} .ifa-chip[data-cat="drop_pierce"],
    #${ACCESSORY_CARD_ID} .ifa-chip[data-cat="drop_earring"]{display:none!important}
    #${ACCESSORY_CARD_ID} .ifa-list{
      display:grid!important;
      grid-template-columns:repeat(2,minmax(0,1fr));
      gap:7px!important;
      align-items:start;
    }
    #${ACCESSORY_CARD_ID} .ifa-row{
      display:block!important;
      min-width:0;
      padding:8px!important;
      border-radius:11px!important;
    }
    #${ACCESSORY_CARD_ID} .ifa-row[hidden]{display:none!important}
    #${ACCESSORY_CARD_ID} .ifa-row[data-category="pierce"],
    #${ACCESSORY_CARD_ID} .ifa-row[data-category="earring"]{
      background:#edf7fc!important;
      border-color:#bfd9e6!important;
    }
    #${ACCESSORY_CARD_ID} .ifa-row[data-category="drop_pierce"],
    #${ACCESSORY_CARD_ID} .ifa-row[data-category="drop_earring"]{
      background:#fff3eb!important;
      border-color:#eac8b7!important;
    }
    #${ACCESSORY_CARD_ID} .ifa-name{
      font-size:11px!important;
      min-height:30px;
    }
    #${ACCESSORY_CARD_ID} .ifa-meta{
      font-size:9px!important;
      line-height:1.35!important;
      min-height:34px;
    }
    #${ACCESSORY_CARD_ID} .ifa-expected{
      margin-top:6px;
      font-size:16px!important;
    }
    #${ACCESSORY_CARD_ID} .ifa-step{
      grid-template-columns:36px minmax(0,1fr) 36px!important;
      gap:4px!important;
    }
    #${ACCESSORY_CARD_ID} .ifa-step button,
    #${ACCESSORY_CARD_ID} .ifa-step input{
      height:38px!important;
      min-width:0;
    }
    #${ACCESSORY_CARD_ID} .ifa-step button{font-size:20px!important}
    #${ACCESSORY_CARD_ID} .ifa-step input{font-size:15px!important}
    #${ACCESSORY_CARD_ID} .ifa-actions{gap:4px!important}
    #${ACCESSORY_CARD_ID} .ifa-actions .if-mini{
      min-width:0;
      padding:5px 3px!important;
      font-size:9px!important;
    }
    #${ACCESSORY_CARD_ID} .ifa-state{font-size:8px!important}
    .if-tshirt-fallback-note{margin:8px 0}
    .if-tshirt-fallback-cell .if-expected{font-size:16px}
    @media(max-width:370px){
      #${ACCESSORY_CARD_ID} .ifa-list{gap:5px!important}
      #${ACCESSORY_CARD_ID} .ifa-row{padding:6px!important}
      #${ACCESSORY_CARD_ID} .ifa-step{grid-template-columns:32px minmax(0,1fr) 32px!important}
    }
  `;
  document.head.appendChild(style);
}

function groupedCategory(category) {
  if (category === "pierce" || category === "drop_pierce") return "pierce";
  if (category === "earring" || category === "drop_earring") return "earring";
  return category;
}

function applyAccessoryFilter(card) {
  const filter = text(card.dataset.compactCategoryFilter || "all");
  const query = text(card.querySelector(".ifa-search")?.value).toLocaleLowerCase("ja");

  card.querySelectorAll(".ifa-row").forEach(row => {
    const category = groupedCategory(text(row.dataset.category));
    const categoryMatch = filter === "all" || category === filter;
    const queryMatch = !query || text(row.dataset.search).includes(query);
    row.hidden = !(categoryMatch && queryMatch);
  });
}

function polishAccessoryCard() {
  const card = document.getElementById(ACCESSORY_CARD_ID);
  if (!card) return;

  installStyles();

  const rows = Array.from(card.querySelectorAll(".ifa-row"));
  const counts = {
    all: rows.length,
    pierce: rows.filter(row => groupedCategory(text(row.dataset.category)) === "pierce").length,
    earring: rows.filter(row => groupedCategory(text(row.dataset.category)) === "earring").length
  };

  const allButton = card.querySelector('.ifa-chip[data-cat="all"]');
  const pierceButton = card.querySelector('.ifa-chip[data-cat="pierce"]');
  const earringButton = card.querySelector('.ifa-chip[data-cat="earring"]');
  if (allButton) allButton.textContent = `すべて ${counts.all}`;
  if (pierceButton) pierceButton.textContent = `ピアス ${counts.pierce}`;
  if (earringButton) earringButton.textContent = `イヤリング ${counts.earring}`;

  if (card.dataset.compactInventoryBound !== "1") {
    card.dataset.compactInventoryBound = "1";
    card.dataset.compactCategoryFilter = "all";

    card.querySelector(".ifa-chips")?.addEventListener("click", event => {
      const button = event.target.closest(".ifa-chip");
      if (!button) return;
      const raw = text(button.dataset.cat);
      if (!["all", "pierce", "earring"].includes(raw)) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      card.dataset.compactCategoryFilter = raw;
      card.dataset.categoryFilter = "all";
      card.querySelectorAll(".ifa-chip").forEach(item => {
        item.classList.toggle("active", item === button);
      });
      applyAccessoryFilter(card);
    }, true);

    card.querySelector(".ifa-search")?.addEventListener("input", () => {
      window.setTimeout(() => applyAccessoryFilter(card), 0);
    });
  }

  applyAccessoryFilter(card);
}

function tshirtCard(overlay) {
  return Array.from(overlay.querySelectorAll(":scope .if-card"))
    .find(card => text(card.querySelector("h3")?.textContent) === "Tシャツ在庫ボード") || null;
}

function hasTshirtRows(card) {
  return Boolean(card?.querySelector(".if-matrix tbody tr"));
}

function openingMissing(overlay) {
  return Array.from(overlay.querySelectorAll(".if-warning"))
    .some(item => text(item.textContent).includes("開始在庫がありません"));
}

function createFallbackCard(overlay) {
  const wrap = overlay.querySelector(".if-wrap");
  if (!wrap) return null;
  const card = document.createElement("section");
  card.className = "if-card if-tshirt-fallback-card";
  card.innerHTML = `
    <h3>Tシャツ在庫ボード</h3>
    <div class="if-warning if-tshirt-fallback-note">イベント開始在庫にTシャツSKUがないため、現在の実在庫を表示しています。イベント開始在庫には自動登録していません。</div>
    <div class="if-matrix-wrap">
      <table class="if-matrix">
        <thead><tr><th>Design / Body / Color</th>${SIZES.map(size => `<th>${size}</th>`).join("")}</tr></thead>
        <tbody></tbody>
      </table>
    </div>
  `;
  const accessory = document.getElementById(ACCESSORY_CARD_ID);
  if (accessory?.parentElement === wrap) {
    accessory.insertAdjacentElement("beforebegin", card);
    return card;
  }
  const sessionCard = wrap.querySelector(":scope > .if-card");
  if (sessionCard) {
    sessionCard.insertAdjacentElement("afterend", card);
    return card;
  }
  wrap.prepend(card);
  return card;
}

async function fillMissingTshirtRows() {
  const overlay = document.getElementById(PANEL_ID);
  if (!overlay) return;

  let card = tshirtCard(overlay);
  if (card && hasTshirtRows(card)) return;
  if (!card) card = createFallbackCard(overlay);
  if (!card) return;
  if (card.dataset[TSHIRT_FALLBACK_MARKER] === "1") return;
  card.dataset[TSHIRT_FALLBACK_MARKER] = "1";

  try {
    const snapshot = await tshirtAdapter.getInventorySnapshot();
    if (!overlay.isConnected || hasTshirtRows(card)) return;
    const rows = Array.isArray(snapshot?.rows) ? snapshot.rows : [];
    if (!rows.length) return;

    const groups = new Map();
    rows.forEach(row => {
      const key = `${text(row.bodyId)}|${text(row.designId)}|${text(row.colorId)}`;
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

    const tbody = card.querySelector(".if-matrix tbody");
    if (!tbody) return;

    tbody.innerHTML = Array.from(groups.values()).map(group => `
      <tr class="if-tshirt-fallback-row">
        <td>
          <div class="if-design">${esc(group.design)}</div>
          <div class="if-detail">${esc(`${group.body} / ${group.color}`)}</div>
        </td>
        ${SIZES.map(size => {
          const row = group.rows.find(item => text(item.size) === size);
          return row
            ? `<td class="if-cell if-tshirt-fallback-cell"><div class="if-expected">${Number(row.quantity || 0)}</div><div class="if-sub">現在実在庫</div></td>`
            : `<td class="if-cell"></td>`;
        }).join("")}
      </tr>
    `).join("");

    if (!card.querySelector(".if-tshirt-fallback-note")) {
      const matrix = card.querySelector(".if-matrix-wrap");
      const note = document.createElement("div");
      note.className = "if-warning if-tshirt-fallback-note";
      note.textContent = openingMissing(overlay)
        ? "このイベントは開始在庫が未登録です。Tシャツは現在の実在庫を参照表示しています。"
        : "このイベントの開始在庫にTシャツSKUがないため、現在の実在庫を表示しています。イベント開始在庫には自動登録していません。";
      matrix?.insertAdjacentElement("beforebegin", note);
    }
  } catch (error) {
    console.warn("T-shirt inventory fallback could not be displayed.", error);
    card.dataset[TSHIRT_FALLBACK_MARKER] = "0";
  }
}

let scheduled = false;
function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    polishAccessoryCard();
  });
}

installStyles();
new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
document.addEventListener("input", event => {
  if (event.target?.classList?.contains("ifa-search")) schedule();
});
document.addEventListener("inventory:tshirt-missing", () => {
  void fillMissingTshirtRows();
});
document.addEventListener("change", event => {
  if (event.target?.id === "ifSession") {
    window.setTimeout(() => void fillMissingTshirtRows(), 1900);
  }
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    schedule();
    window.setTimeout(() => void fillMissingTshirtRows(), 700);
  }
});
window.setTimeout(() => void fillMissingTshirtRows(), 2200);
schedule();
