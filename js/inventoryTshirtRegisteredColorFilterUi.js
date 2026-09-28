import { loadTshirtProductVariants } from "./services/catalogService.js";

const SECTION_ID = "inventoryTshirtSection";
const STYLE_ID = "inventoryTshirtRegisteredColorFilterStyles";
const FILTER_VERSION = "1";

let scheduled = false;
let requestId = 0;

function text(value) {
  return String(value ?? "").trim();
}

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    #${SECTION_ID} .inventoryStockRow[data-unregistered-color-group="1"]{
      display:none!important;
    }
  `;
  document.head.appendChild(style);
}

function registeredVariantIds(variants) {
  return new Set(
    (Array.isArray(variants) ? variants : [])
      .map(item => text(item?.variantId || item?.id).toLocaleLowerCase())
      .filter(Boolean)
  );
}

function rowHasRegisteredVariant(row, ids) {
  const tokens = text(row?.dataset?.search)
    .split(/\s+/u)
    .map(token => token.toLocaleLowerCase())
    .filter(Boolean);

  return tokens.some(token => ids.has(token));
}

async function filterTshirtColorGroups() {
  const section = document.getElementById(SECTION_ID);
  if (!section) return;
  if (section.dataset.registeredColorFilterVersion === FILTER_VERSION) return;
  if (section.dataset.registeredColorFilterLoading === "1") return;

  const rows = Array.from(
    section.querySelectorAll('.inventoryStockRow[data-inventory-type="tshirt"]')
  );
  if (!rows.length) return;

  section.dataset.registeredColorFilterLoading = "1";
  const currentRequest = ++requestId;

  try {
    const variants = await loadTshirtProductVariants();
    const ids = registeredVariantIds(variants);

    if (
      currentRequest !== requestId ||
      !section.isConnected ||
      section !== document.getElementById(SECTION_ID)
    ) {
      return;
    }

    if (!ids.size) {
      return;
    }

    Array.from(
      section.querySelectorAll('.inventoryStockRow[data-inventory-type="tshirt"]')
    ).forEach(row => {
      row.dataset.unregisteredColorGroup = rowHasRegisteredVariant(row, ids)
        ? "0"
        : "1";
    });

    section.dataset.registeredColorFilterVersion = FILTER_VERSION;
  } catch (error) {
    console.warn("Registered T-shirt color filter could not be applied.", error);
  } finally {
    if (section.isConnected) {
      section.dataset.registeredColorFilterLoading = "0";
    }
  }
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    void filterTshirtColorGroups();
  });
}

installStyles();
schedule();
new MutationObserver(schedule).observe(document.body, {
  childList: true,
  subtree: true
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) schedule();
});
