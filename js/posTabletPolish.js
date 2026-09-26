const STYLE_ID = "posTabletPolishStyles";

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    #posStripeCheckoutButton {
      background:#635bff !important;
      color:#fff !important;
      border-color:#635bff !important;
    }

    #posStripeCheckoutButton:disabled {
      background:#635bff !important;
      color:#fff !important;
      opacity:.45 !important;
    }

    @media (min-width:760px) and (max-width:1366px) {
      .pos-sku-tshirt-table {
        min-width:100% !important;
      }

      .pos-sku-tshirt-grid {
        grid-template-columns:minmax(170px,1.55fr) repeat(5,minmax(66px,1fr)) !important;
      }

      .pos-sku-tshirt-row .posSkuItem {
        min-height:78px !important;
        padding:7px 4px !important;
      }

      .pos-sku-tshirt-row .posSkuItem > div:nth-child(1) {
        font-size:12px !important;
      }

      .pos-sku-tshirt-row .posSkuItem > div:nth-child(2),
      .pos-sku-tshirt-row .posSkuItem > div:nth-child(3) {
        font-size:11px !important;
      }

      .pos-sku-tshirt-row > div:first-child > div:first-child {
        font-size:16px !important;
      }

      .pos-sku-tshirt-row > div:first-child > .muted {
        font-size:12px !important;
      }

      .posSkuItem.accessory-sku-stud,
      .posSkuItem.accessory-sku-drop {
        min-height:132px !important;
        padding:14px !important;
      }

      .posSkuItem.accessory-sku-stud > div:first-child > div:first-child,
      .posSkuItem.accessory-sku-drop > div:first-child > div:first-child {
        font-size:17px !important;
      }

      .posSkuItem.accessory-sku-stud > div:first-child > div:nth-child(2),
      .posSkuItem.accessory-sku-drop > div:first-child > div:nth-child(2) {
        font-size:13px !important;
      }

      .posSkuItem.accessory-sku-stud > div:last-child > div:first-child,
      .posSkuItem.accessory-sku-drop > div:last-child > div:first-child {
        font-size:16px !important;
      }

      .posSkuItem.accessory-sku-stud > div:last-child > div:nth-child(2),
      .posSkuItem.accessory-sku-drop > div:last-child > div:nth-child(2) {
        font-size:13px !important;
      }
    }
  `;
  document.head.appendChild(style);
}

function markTshirtSkuTable() {
  const firstSkuItem =
    document.querySelector(
      "#view .posSkuItem"
    );

  if (!firstSkuItem) return;

  const label = Array.from(document.querySelectorAll("#view div"))
    .find(element => String(element.textContent || "").trim() === "Design / Body / Color");

  const header = label?.parentElement;
  const table = header?.parentElement;

  if (!header || !table || !table.querySelector(".posSkuItem")) return;

  table.classList.add("pos-sku-tshirt-table");
  header.classList.add("pos-sku-tshirt-grid", "pos-sku-tshirt-header");

  Array.from(table.children).forEach((row, index) => {
    if (index === 0 || !row.querySelector?.(".posSkuItem")) return;
    row.classList.add("pos-sku-tshirt-grid", "pos-sku-tshirt-row");
  });
}

let scheduled = false;
function enhance() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    installStyles();
    markTshirtSkuTable();
  });
}

const view = document.getElementById("view");
if (view) {
  new MutationObserver(enhance).observe(view, {
    childList:true,
    subtree:true
  });
}

window.addEventListener("resize", enhance);
enhance();
