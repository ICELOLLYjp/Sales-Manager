const FAST_OVERLAY_ID = "fastPosOverlay";
const STYLE_ID = "fastPosModeEnhancementStyles";

function currentMode() {
  if (document.querySelector(`#${FAST_OVERLAY_ID}`)) return "fast";
  return localStorage.getItem("icelolly-sales-pos-mode") === "sku" ? "sku" : "quick";
}

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .fp-mode-switch{
      display:grid!important;
      grid-template-columns:repeat(3,minmax(0,1fr))!important;
      gap:8px!important;
      width:calc(100% - 20px)!important;
      max-width:480px!important;
      margin:10px auto 0!important;
      padding:0!important;
      align-items:stretch!important;
      box-sizing:border-box!important;
    }
    .fp-mode-switch-top{
      margin-top:0!important;
    }
    .fp-mode-row>#posModeQuick,
    .fp-mode-row>#posModeSku,
    .fp-mode-row>#fastPosOpenButton,
    #${FAST_OVERLAY_ID} .fp-mode-choice{
      width:100%!important;
      min-width:0!important;
      height:46px!important;
      min-height:46px!important;
      padding:0 10px!important;
      border-radius:23px!important;
      font:800 14px system-ui,sans-serif!important;
      transition:background .15s ease,color .15s ease,box-shadow .15s ease,transform .08s ease!important;
      box-sizing:border-box!important;
    }

    #posModeQuick,
    #${FAST_OVERLAY_ID} .fp-mode-choice[data-mode="quick"]{
      border:1px solid #1677d2!important;
      background:#e9f4ff!important;
      color:#1264b2!important;
    }
    #posModeSku,
    #${FAST_OVERLAY_ID} .fp-mode-choice[data-mode="sku"]{
      border:1px solid #198754!important;
      background:#eaf8f0!important;
      color:#146c43!important;
    }
    #fastPosOpenButton,
    #${FAST_OVERLAY_ID} .fp-mode-choice[data-mode="fast"]{
      border:1px solid #635bff!important;
      background:#efeeff!important;
      color:#5148e5!important;
    }

    #posModeQuick.fp-mode-active,
    #${FAST_OVERLAY_ID} .fp-mode-choice[data-mode="quick"].active{
      background:#1677d2!important;
      color:#fff!important;
      box-shadow:0 3px 10px rgba(22,119,210,.24)!important;
    }
    #posModeSku.fp-mode-active,
    #${FAST_OVERLAY_ID} .fp-mode-choice[data-mode="sku"].active{
      background:#198754!important;
      color:#fff!important;
      box-shadow:0 3px 10px rgba(25,135,84,.24)!important;
    }
    #fastPosOpenButton.fp-mode-active,
    #${FAST_OVERLAY_ID} .fp-mode-choice[data-mode="fast"].active{
      background:#635bff!important;
      color:#fff!important;
      box-shadow:0 3px 10px rgba(99,91,255,.28)!important;
    }

    #posModeQuick:active,
    #posModeSku:active,
    #fastPosOpenButton:active,
    #${FAST_OVERLAY_ID} .fp-mode-choice:active{transform:scale(.97)!important}

    #${FAST_OVERLAY_ID} .fp-mode-choice{
      width:100%;
      min-width:0;
    }
    .fp-mode-caption{
      max-width:480px;
      margin:5px auto 0;
      padding:0 12px;
      box-sizing:border-box;
      font:600 10px/1.4 system-ui,sans-serif;
      color:#777;
      text-align:center;
    }
    .fp-mode-caption-top{
      margin-bottom:14px!important;
    }
  `;
  document.head.appendChild(style);
}

function normalizeTopModeRow() {
  const quick = document.getElementById("posModeQuick");
  const sku = document.getElementById("posModeSku");
  const fast = document.getElementById("fastPosOpenButton");
  if (!quick || !sku || !fast) return;

  const parent = quick.parentElement;
  if (!parent || sku.parentElement !== parent || fast.parentElement !== parent) return;
  parent.classList.add("fp-mode-row", "fp-mode-switch", "fp-mode-switch-top");

  const heading = Array.from(document.querySelectorAll(".page-title"))
    .find(element => element.textContent?.trim() === "EVENT POS");
  const headingColumn = heading?.parentElement;
  const headingRow = headingColumn?.parentElement;

  if (headingColumn?.contains(parent) && headingRow) {
    headingRow.insertAdjacentElement("afterend", parent);
  }

  let caption = parent.nextElementSibling;
  if (!caption?.classList.contains("fp-mode-caption-top")) {
    caption = document.createElement("div");
    caption.className = "fp-mode-caption fp-mode-caption-top";
    caption.textContent = "Quick・SKU・金額だけの最速POSをいつでも切り替えられます";
    parent.insertAdjacentElement("afterend", caption);
  }
}

function syncTopButtons() {
  normalizeTopModeRow();
  const mode = currentMode();
  const buttons = {
    quick: document.getElementById("posModeQuick"),
    sku: document.getElementById("posModeSku"),
    fast: document.getElementById("fastPosOpenButton")
  };

  Object.entries(buttons).forEach(([key, button]) => {
    if (!button) return;
    button.classList.toggle("fp-mode-active", key === mode);
    button.setAttribute("aria-pressed", key === mode ? "true" : "false");
  });
}

function switchFromFastOverlay(mode) {
  if (mode === "fast") return;
  const overlay = document.getElementById(FAST_OVERLAY_ID);
  overlay?.querySelector(".fp-close")?.click();

  window.setTimeout(() => {
    const target = document.getElementById(mode === "sku" ? "posModeSku" : "posModeQuick");
    if (target) target.click();
    else {
      localStorage.setItem("icelolly-sales-pos-mode", mode);
      document.querySelector('[data-route="pos"]')?.click();
    }
    syncTopButtons();
  }, 0);
}

function ensureFastOverlaySwitcher() {
  const overlay = document.getElementById(FAST_OVERLAY_ID);
  if (!overlay || overlay.querySelector(".fp-mode-switch")) return;

  const switcher = document.createElement("div");
  switcher.className = "fp-mode-switch";
  switcher.setAttribute("aria-label", "POS入力方法を切り替え");
  switcher.innerHTML = `
    <button type="button" class="fp-mode-choice" data-mode="quick">Quick</button>
    <button type="button" class="fp-mode-choice" data-mode="sku">SKU</button>
    <button type="button" class="fp-mode-choice active" data-mode="fast" aria-pressed="true">最速</button>
  `;

  const caption = document.createElement("div");
  caption.className = "fp-mode-caption";
  caption.textContent = "Quick・SKU・金額だけの最速POSをいつでも切り替えられます";

  const wrap = overlay.querySelector(".fp-wrap");
  if (wrap) {
    wrap.insertAdjacentElement("beforebegin", caption);
    caption.insertAdjacentElement("beforebegin", switcher);
  } else {
    overlay.querySelector(".fp-head")?.insertAdjacentElement("afterend", switcher);
    switcher.insertAdjacentElement("afterend", caption);
  }

  switcher.querySelectorAll(".fp-mode-choice").forEach(button => {
    const mode = button.dataset.mode;
    button.setAttribute("aria-pressed", mode === "fast" ? "true" : "false");
    button.addEventListener("click", () => switchFromFastOverlay(mode));
  });

  syncTopButtons();
}

function sync() {
  installStyles();
  syncTopButtons();
  ensureFastOverlaySwitcher();
}

let scheduled = false;
function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    sync();
  });
}

new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
document.addEventListener("click", event => {
  if (event.target?.closest?.("#posModeQuick,#posModeSku,#fastPosOpenButton,.fp-close")) {
    window.setTimeout(sync, 0);
  }
}, true);
window.addEventListener("focus", sync);
document.addEventListener("visibilitychange", () => { if (!document.hidden) sync(); });
sync();
