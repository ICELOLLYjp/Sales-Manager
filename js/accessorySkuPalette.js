const STYLE_ID = "accessorySkuPaletteStyles";

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .posSkuItem.accessory-sku-stud {
      background:#fbfdff !important;
      border-color:#e4eef2 !important;
    }

    .posSkuItem.accessory-sku-drop {
      background:#fffdfb !important;
      border-color:#f1e5de !important;
    }
  `;
  document.head.appendChild(style);
}

function applyAccessoryPalette() {
  document.querySelectorAll(".posSkuItem").forEach(button => {
    const label = String(button.textContent || "");
    const isDrop = label.includes("ドロップ");
    const isStud = label.includes("スタッド");

    button.classList.toggle("accessory-sku-drop", isDrop);
    button.classList.toggle("accessory-sku-stud", !isDrop && isStud);
  });
}

let scheduled = false;
function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    installStyles();
    applyAccessoryPalette();
  });
}

const view = document.querySelector("#view");
if (view) {
  new MutationObserver(schedule).observe(view, {
    childList: true,
    subtree: true
  });
}

schedule();
