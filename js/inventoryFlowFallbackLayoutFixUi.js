const PANEL_ID = "inventoryFlowOverlay";
const STYLE_ID = "inventoryFlowFallbackLayoutFixStyles";
const READY = "inventoryTshirtCountReady";

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    #${PANEL_ID} .if-tshirt-fallback-cell{
      min-width:118px!important;
      padding:8px 5px!important;
      background:#fff!important;
    }
    #${PANEL_ID} .if-tshirt-fallback-cell.if-count-changed{
      background:#fff!important;
    }
    #${PANEL_ID} .if-tshirt-fallback-cell .if-sub{
      margin:0 0 6px!important;
      font-size:9px!important;
      color:#777!important;
      text-align:center;
    }
    #${PANEL_ID} .if-tshirt-fallback-stepper{
      display:grid!important;
      grid-template-columns:32px 48px 32px!important;
      gap:4px!important;
      align-items:center!important;
      justify-content:center!important;
      width:max-content;
      margin:0 auto;
    }
    #${PANEL_ID} .if-tshirt-fallback-stepper > .if-tshirt-fallback-step{
      width:32px!important;
      height:38px!important;
      min-width:32px!important;
      padding:0!important;
      border:1px solid #c9c9c4!important;
      border-radius:9px!important;
      background:#fff!important;
      color:#222!important;
      font:800 21px/1 system-ui,sans-serif!important;
    }
    #${PANEL_ID} .if-tshirt-fallback-stepper > .if-tshirt-fallback-input{
      box-sizing:border-box!important;
      width:48px!important;
      min-width:48px!important;
      height:38px!important;
      margin:0!important;
      padding:0 3px!important;
      border:1.5px solid #aaa!important;
      border-radius:9px!important;
      background:#fff!important;
      color:#111!important;
      text-align:center!important;
      font:800 18px/1 system-ui,sans-serif!important;
    }
    #${PANEL_ID} .if-tshirt-fallback-stepper > .if-inline-count{
      display:contents!important;
    }
    #${PANEL_ID} .if-tshirt-fallback-stepper > .if-inline-count > button,
    #${PANEL_ID} .if-tshirt-fallback-stepper > .if-count-diff,
    #${PANEL_ID} .if-tshirt-fallback-stepper > .if-inline-count + .if-count-diff{
      display:none!important;
    }
  `;
  document.head.appendChild(style);
}

function cleanEnhancedFallback(input) {
  if (!input?.classList?.contains("if-tshirt-fallback-input")) return;
  const wrapper = input.closest(".if-inline-count");
  if (!wrapper) {
    input.dataset[READY] = "1";
    input.removeAttribute("data-expected-qty");
    input.closest(".if-tshirt-fallback-cell")?.classList.remove("if-count-changed");
    return;
  }

  const clone = input.cloneNode(true);
  clone.dataset[READY] = "1";
  clone.removeAttribute("data-expected-qty");
  const diff = wrapper.nextElementSibling?.classList?.contains("if-count-diff")
    ? wrapper.nextElementSibling
    : null;
  wrapper.replaceWith(clone);
  diff?.remove();
  clone.closest(".if-tshirt-fallback-cell")?.classList.remove("if-count-changed");
}

function clean() {
  installStyles();
  document.querySelectorAll(`#${PANEL_ID} .if-tshirt-fallback-input`).forEach(cleanEnhancedFallback);
}

let scheduled = false;
function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    clean();
  });
}

schedule();
new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) schedule();
});
