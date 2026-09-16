import { getFirebaseState } from "./firebase.js";
import {
  loadDailyCloseSummary,
  closeCurrentDayAndStartNext
} from "./services/eventDailyCloseService.js?v=20260916-daily-close-1";

const PANEL_ID = "inventoryFlowOverlay";
const CARD_ID = "eventDailyCloseCard";
let loading = false;
let lastSessionId = "";
let lastRequestAt = 0;

function text(value) {
  return String(value ?? "").trim();
}

function esc(value) {
  return text(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function email() {
  return text(getFirebaseState()?.auth?.currentUser?.email);
}

function countModeLabel(summary) {
  if (!summary.newPhysicalCount) {
    return summary.unknownCount > 0
      ? "新しい実数カウントなし・不明あり"
      : "新しい実数カウントなし・前回値を引継";
  }
  if (summary.countMode === "full") return "全SKU確認済み";
  if (summary.countMode === "partial") return "一部確認・一部不明";
  return "不明を残して締める";
}

function formatDate(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return text(value);
  return d.toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function installStyles() {
  if (document.querySelector("#eventDailyCloseStyles")) return;
  const style = document.createElement("style");
  style.id = "eventDailyCloseStyles";
  style.textContent = `
    #${CARD_ID}{border-color:#cfdbe8;background:#fbfdff}
    #${CARD_ID} .edc-head{display:flex;gap:8px;align-items:flex-start}
    #${CARD_ID} .edc-head>div:first-child{flex:1}
    #${CARD_ID} .edc-day{font-size:20px;font-weight:900;line-height:1}
    #${CARD_ID} .edc-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin-top:9px}
    #${CARD_ID} .edc-stat{background:#fff;border:1px solid #e5e9ed;border-radius:9px;padding:7px}
    #${CARD_ID} .edc-stat strong{display:block;font-size:17px}
    #${CARD_ID} .edc-stat span{font-size:9px;color:#6c7175}
    #${CARD_ID} .edc-unknown{background:#fff8df;border-color:#ead796}
    #${CARD_ID} .edc-note{font-size:10px;line-height:1.5;color:#60666b;margin-top:8px}
    #${CARD_ID} .edc-history{margin-top:9px;border-top:1px solid #e5e9ed;padding-top:7px}
    #${CARD_ID} .edc-history-row{font-size:10px;line-height:1.45;padding:4px 0;border-bottom:1px solid #f0f1f2}
    #${CARD_ID} .edc-action{width:100%;min-height:48px;margin-top:9px;border:1px solid #222;border-radius:10px;background:#222;color:#fff;font:800 13px system-ui,sans-serif}
    #${CARD_ID} .edc-action:disabled{opacity:.45}
    @media(max-width:430px){#${CARD_ID} .edc-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
  `;
  document.head.appendChild(style);
}

function historyHtml(history) {
  const rows = (Array.isArray(history) ? history : []).slice(-4).reverse();
  if (!rows.length) return "";
  return `<div class="edc-history"><strong style="font-size:11px">日次履歴</strong>${rows.map(row => `
    <div class="edc-history-row">
      <strong>Day ${Number(row?.dayNumber || 0)}</strong> ${esc(formatDate(row?.closedAtIso))}<br>
      確認 ${Number(row?.confirmedCount || 0)} / 引継 ${Number(row?.inheritedCount || 0)} / 不明 ${Number(row?.unknownCount || 0)}
      ・販売 SKU ${Number(row?.exactSalesToday || 0)} / Quick ${Number(row?.quickSalesToday || 0)}
    </div>`).join("")}</div>`;
}

function buildCard(summary) {
  const card = document.createElement("section");
  card.id = CARD_ID;
  card.className = "if-card";
  const hasUnknown = Number(summary.unknownCount || 0) > 0;
  const buttonLabel = `Day ${summary.dayNumber} を締めて Day ${summary.dayNumber + 1} へ`;
  card.innerHTML = `
    <div class="edc-head">
      <div><h3 style="margin-bottom:3px">日次締め</h3><div class="if-muted">イベントSessionは終了しません。今日の状態を記録して、そのまま翌日の販売へ進みます。</div></div>
      <div class="edc-day">Day ${summary.dayNumber}</div>
    </div>
    <div class="edc-grid">
      <div class="edc-stat"><strong>${summary.confirmedCount}</strong><span>今回のカウントで確認</span></div>
      <div class="edc-stat"><strong>${summary.inheritedCount}</strong><span>変動なしで引継</span></div>
      <div class="edc-stat ${hasUnknown ? "edc-unknown" : ""}"><strong>${summary.unknownCount}</strong><span>不明のまま</span></div>
      <div class="edc-stat"><strong>${summary.exactSalesToday}</strong><span>本日のSKU販売</span></div>
      <div class="edc-stat"><strong>${summary.quickSalesToday}</strong><span>本日のQuick</span></div>
      <div class="edc-stat"><strong>${summary.restockToday}</strong><span>本日のRestock</span></div>
    </div>
    <div class="edc-note">
      状態：<strong>${esc(countModeLabel(summary))}</strong><br>
      何も数えず締めても構いません。分かるSKUは引き継ぎ、不明なSKUは0にせず不明のまま翌日へ進みます。Restockや販売があったSKUは、前回カウントを自動で確定値にしません。
    </div>
    <button type="button" class="edc-action" id="eventDailyCloseAction">${esc(buttonLabel)}</button>
    <div class="edc-note">最終日はこのボタンではなく、イベント終了フローで正式終了します。</div>
    ${historyHtml(summary.history)}
  `;
  return card;
}

function selectedSessionId() {
  return text(document.querySelector(`#${PANEL_ID} #ifSession`)?.value);
}

async function render(force = false) {
  const overlay = document.querySelector(`#${PANEL_ID}`);
  const wrap = overlay?.querySelector(".if-wrap");
  const sessionId = selectedSessionId();
  if (!overlay || !wrap || !sessionId || loading) return;

  const now = Date.now();
  if (!force && sessionId === lastSessionId && now - lastRequestAt < 1500 && document.querySelector(`#${CARD_ID}`)) return;
  lastSessionId = sessionId;
  lastRequestAt = now;
  loading = true;

  try {
    const summary = await loadDailyCloseSummary({ sessionId });
    if (selectedSessionId() !== sessionId) return;
    document.querySelector(`#${CARD_ID}`)?.remove();
    if (summary.sessionStatus !== "open") return;

    installStyles();
    const card = buildCard(summary);
    const sessionCard = wrap.querySelector(".if-card");
    if (sessionCard) sessionCard.insertAdjacentElement("afterend", card);
    else wrap.prepend(card);

    card.querySelector("#eventDailyCloseAction")?.addEventListener("click", async event => {
      const button = event.currentTarget;
      const message =
        `Day ${summary.dayNumber} を締めて Day ${summary.dayNumber + 1} を開始します。\n\n` +
        `今回確認 ${summary.confirmedCount} SKU\n` +
        `変動なしで引継 ${summary.inheritedCount} SKU\n` +
        `不明のまま ${summary.unknownCount} SKU\n` +
        `本日のSKU販売 ${summary.exactSalesToday} 点 / Quick ${summary.quickSalesToday} 点\n\n` +
        "不明は0に変換しません。会社の正式在庫も日次締めだけでは変更しません。\n\n進めますか？";
      if (!window.confirm(message)) return;

      const original = button.textContent;
      button.disabled = true;
      button.textContent = "日次締め中…";
      try {
        const result = await closeCurrentDayAndStartNext({
          sessionId,
          closedByEmail: email()
        });
        window.alert(
          `Day ${result.closedDayNumber} を締めました。\n` +
          `Day ${result.nextDayNumber} を開始しています。\n\n` +
          `確認 ${result.confirmedCount} / 引継 ${result.inheritedCount} / 不明 ${result.unknownCount}`
        );
        lastRequestAt = 0;
        await render(true);
      } catch (error) {
        window.alert(error?.message || String(error));
        button.disabled = false;
        button.textContent = original;
      }
    });
  } catch (error) {
    console.warn("Daily close card could not be prepared.", error);
  } finally {
    loading = false;
  }
}

let scheduled = false;
function schedule(force = false) {
  if (scheduled && !force) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    void render(force);
  });
}

new MutationObserver(() => schedule()).observe(document.body, { childList: true, subtree: true });
document.addEventListener("change", event => {
  if (event.target?.id === "ifSession") {
    lastRequestAt = 0;
    lastSessionId = "";
    schedule(true);
  }
}, true);
window.addEventListener("focus", () => { lastRequestAt = 0; schedule(true); });
document.addEventListener("visibilitychange", () => { if (!document.hidden) { lastRequestAt = 0; schedule(true); } });
schedule();
