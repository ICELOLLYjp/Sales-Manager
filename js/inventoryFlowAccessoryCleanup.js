const PANEL_ID = "inventoryFlowOverlay";

function text(value) {
  return String(value ?? "").trim();
}

function cleanup() {
  const overlay = document.querySelector(`#${PANEL_ID}`);
  if (!overlay) return;

  overlay.querySelectorAll(".if-row").forEach(row => {
    const id = text(row.querySelector(".if-physical")?.dataset?.variantId);
    if (id.startsWith("accessory__")) row.remove();
  });

  overlay.querySelectorAll(".if-rowlist").forEach(list => {
    if (list.querySelector(":scope > .if-row")) return;
    const heading = list.previousElementSibling;
    if (heading?.tagName === "H3" && text(heading.textContent) === "その他") heading.remove();
    list.remove();
  });
}

let scheduled = false;
function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    cleanup();
  });
}

schedule();
new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
