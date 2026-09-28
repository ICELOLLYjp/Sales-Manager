const PANEL_ID = "inventoryFlowOverlay";
const READY = "inventoryTshirtCountReady";

function number(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function installStyles() {
  if (document.querySelector("#inventoryTshirtCountStyles")) return;

  const style = document.createElement("style");
  style.id = "inventoryTshirtCountStyles";
  style.textContent = `
    #${PANEL_ID} .if-cell{min-width:126px}
    #${PANEL_ID} .if-cell .if-expected{font-size:10px!important;font-weight:700!important;color:#777;line-height:1.2;margin-bottom:2px}
    #${PANEL_ID} .if-cell .if-expected.if-negative{color:#b00020}
    #${PANEL_ID} .if-inline-count{display:grid;grid-template-columns:34px 52px 34px;gap:4px;align-items:center;justify-content:center;margin:5px auto 2px}
    #${PANEL_ID} .if-inline-count button{width:34px;height:38px;padding:0;border:1px solid #c9c9c3;border-radius:9px;background:#fff;color:#222;font:800 22px/1 system-ui,sans-serif;touch-action:manipulation;user-select:none;-webkit-user-select:none}
    #${PANEL_ID} .if-inline-count button:active{transform:scale(.96);background:#efefeb}
    #${PANEL_ID} .if-inline-count .if-count{width:52px!important;height:38px!important;box-sizing:border-box;margin:0!important;padding:0 3px!important;border:1.5px solid #aaa;border-radius:9px;background:#fff;text-align:center;font:800 18px/1 system-ui,sans-serif;color:#111}
    #${PANEL_ID} .if-count-diff{min-height:14px;margin-top:1px;font-size:9px;font-weight:800;line-height:1.2;color:#39724a;text-align:center}
    #${PANEL_ID} .if-count-diff.changed{color:#9a6400}
    #${PANEL_ID} .if-cell.if-count-changed{background:#fff9e8}
    #${PANEL_ID} .if-card[data-tshirt-count-help="1"] .if-muted.if-count-help{margin:7px 0 3px;padding:8px 9px;border-radius:9px;background:#f4f7fb;color:#4f5965}
    @media(max-width:600px){
      #${PANEL_ID} .if-matrix{min-width:760px!important}
      #${PANEL_ID} .if-cell{min-width:126px!important}
    }
  `;
  document.head.appendChild(style);
}

function predictedValue(input) {
  const cell = input.closest(".if-cell");
  const expectedText = cell?.querySelector(".if-expected")?.textContent || "";
  const expectedMatch = expectedText.match(/-?\d+/);
  if (expectedMatch) return number(expectedMatch[0]);

  const row = input.closest(".if-row");
  const rowText = row?.textContent || "";
  const rowMatch = rowText.match(/予測\s*(-?\d+)/);
  return rowMatch ? number(rowMatch[1]) : 0;
}

function updateState(input) {
  const expected = number(input.dataset.expectedQty || 0);
  const actual = Math.max(0, number(input.value));
  const diff = actual - expected;
  const host = input.closest(".if-cell") || input.closest(".if-row");
  const status = input.closest(".if-inline-count")?.nextElementSibling;

  if (status?.classList.contains("if-count-diff")) {
    status.textContent = diff === 0 ? "予測と一致" : `差 ${diff > 0 ? "+" : ""}${diff}`;
    status.classList.toggle("changed", diff !== 0);
  }

  host?.classList.toggle("if-count-changed", diff !== 0);
}

function changeValue(input, delta) {
  const current = Math.max(0, number(input.value));
  input.value = String(Math.max(0, current + delta));
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  if (navigator.vibrate) navigator.vibrate(8);
}

function enhanceInput(input) {
  if (!input || input.dataset[READY] === "1") return;
  if (input.closest("#inventoryFlowAccessoryCard")) return;
  if (input.classList.contains("if-tshirt-fallback-input") || input.closest(".if-tshirt-fallback-stepper")) return;
  if (input.classList.contains("if-session-tshirt-input") || input.closest(".if-session-tshirt-stepper")) return;

  const expectedRaw = predictedValue(input);
  const expectedPhysical = Math.max(0, expectedRaw);

  input.dataset[READY] = "1";
  input.dataset.expectedQty = String(expectedRaw);

  if (input.value === "") {
    input.value = String(expectedPhysical);
  }

  const cell = input.closest(".if-cell");
  const expected = cell?.querySelector(".if-expected");
  if (expected && expected.dataset.countLabelReady !== "1") {
    expected.dataset.countLabelReady = "1";
    expected.textContent = `予測 ${expectedRaw}`;
  }

  const wrapper = document.createElement("div");
  wrapper.className = "if-inline-count";

  const minus = document.createElement("button");
  minus.type = "button";
  minus.textContent = "−";
  minus.setAttribute("aria-label", "実数を1減らす");

  const plus = document.createElement("button");
  plus.type = "button";
  plus.textContent = "+";
  plus.setAttribute("aria-label", "実数を1増やす");

  input.parentNode.insertBefore(wrapper, input);
  wrapper.appendChild(minus);
  wrapper.appendChild(input);
  wrapper.appendChild(plus);

  const diff = document.createElement("div");
  diff.className = "if-count-diff";
  wrapper.insertAdjacentElement("afterend", diff);

  minus.addEventListener("click", () => changeValue(input, -1));
  plus.addEventListener("click", () => changeValue(input, 1));
  input.addEventListener("input", () => {
    if (input.value !== "") input.value = String(Math.max(0, number(input.value)));
    updateState(input);
  });
  input.addEventListener("change", () => updateState(input));

  updateState(input);
}

function updateHelp() {
  const overlay = document.querySelector(`#${PANEL_ID}`);
  if (!overlay) return;

  const card = [...overlay.querySelectorAll(":scope .if-card")]
    .find(item => item.querySelector("h3")?.textContent?.trim() === "Tシャツ在庫ボード");
  if (!card || card.dataset.tshirtCountHelp === "1") return;

  card.dataset.tshirtCountHelp = "1";
  const help = [...card.querySelectorAll(":scope > .if-muted")][0];
  if (help) {
    help.classList.add("if-count-help");
    help.textContent = "入力欄には現在の予測残数を入れています。実数と違う時だけ−＋または直接入力で修正し、保存します。保存時は表示中の数値を実数として記録します。";
  }
}

function enhance() {
  installStyles();
  document.querySelectorAll(`#${PANEL_ID} .if-physical`).forEach(enhanceInput);
  updateHelp();
}

let scheduled = false;
function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    enhance();
  });
}

schedule();
new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) schedule();
});
