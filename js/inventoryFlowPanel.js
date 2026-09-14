import { getFirebaseState } from "./firebase.js";
import {
  listOpenEventSessions,
  loadEventInventoryFlow,
  addEventInventoryAdjustment,
  deleteEventInventoryAdjustment,
  saveEventInventoryCheckpoint,
  deleteEventInventoryCheckpoint
} from "./services/inventoryFlowService.js?v=20260913-inventory-flow-1";

const PANEL_ID = "inventoryFlowOverlay";
const BUTTON_ID = "inventoryFlowOpenButton";

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function userEmail() {
  return String(getFirebaseState()?.auth?.currentUser?.email || "");
}

function sessionName(session) {
  const name = session?.eventName || session?.name || "Event";
  const city = session?.city ? ` / ${session.city}` : "";
  const date = session?.startDate ? ` / ${session.startDate}` : "";
  return `${name}${city}${date}`;
}

function formatTime(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function installStyles() {
  if (document.querySelector("#inventoryFlowStyles")) return;
  const style = document.createElement("style");
  style.id = "inventoryFlowStyles";
  style.textContent = `
    #${BUTTON_ID}{border:1px solid #d9d9d9;background:#fff;border-radius:10px;padding:7px 10px;font:inherit;font-size:12px;white-space:nowrap;margin-left:auto;margin-right:8px}
    #${PANEL_ID}{position:fixed;inset:0;z-index:9999;background:#f7f7f7;overflow:auto;-webkit-overflow-scrolling:touch;color:#222}
    .if-head{position:sticky;top:0;z-index:4;background:#fff;border-bottom:1px solid #ddd;padding:calc(10px + env(safe-area-inset-top)) 12px 10px;display:flex;gap:8px;align-items:center}
    .if-head h2{font-size:16px;margin:0;flex:1}.if-close{border:0;background:#eee;border-radius:9px;padding:8px 12px;font-size:14px}
    .if-wrap{max-width:980px;margin:0 auto;padding:12px 12px calc(90px + env(safe-area-inset-bottom))}
    .if-card{background:#fff;border:1px solid #e5e5e5;border-radius:14px;padding:12px;margin-bottom:12px;box-shadow:0 1px 2px rgba(0,0,0,.03)}
    .if-card h3{font-size:15px;margin:0 0 10px}.if-muted{font-size:12px;color:#666;line-height:1.5}.if-warning{background:#fff7df;border:1px solid #eed38a;border-radius:10px;padding:9px;font-size:12px;margin:8px 0}.if-good{background:#eef9f0;border:1px solid #b9ddbf;border-radius:10px;padding:9px;font-size:12px;margin:8px 0}
    .if-select,.if-input{box-sizing:border-box;width:100%;font:inherit;border:1px solid #ccc;border-radius:9px;background:#fff;padding:10px}.if-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.if-btn{border:1px solid #ccc;background:#fff;border-radius:9px;padding:9px 11px;font:inherit;font-size:13px}.if-btn.primary{background:#111;color:#fff;border-color:#111}.if-btn.danger{color:#a00;border-color:#d9aaaa}.if-btn:disabled{opacity:.45}
    .if-table-wrap{overflow:auto;border:1px solid #e5e5e5;border-radius:10px}.if-table{border-collapse:collapse;width:100%;min-width:760px;font-size:12px}.if-table th,.if-table td{border-bottom:1px solid #eee;padding:8px 7px;text-align:right;vertical-align:middle}.if-table th{position:sticky;top:0;background:#fafafa;z-index:1;font-weight:600;white-space:nowrap}.if-table th:first-child,.if-table td:first-child{text-align:left;position:sticky;left:0;background:#fff;z-index:2;min-width:180px}.if-table th:first-child{background:#fafafa;z-index:3}.if-name{font-weight:600;font-size:12px}.if-detail{font-size:10px;color:#777;margin-top:2px;max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.if-number{width:64px;border:1px solid #ccc;border-radius:7px;padding:7px;text-align:right;font:inherit}.if-plus{font-weight:700}.if-negative{color:#b00020}.if-zero{color:#999}.if-mini{border:1px solid #ccc;background:#fff;border-radius:7px;padding:6px 8px;font:inherit;font-size:11px;white-space:nowrap}.if-history{display:grid;gap:6px}.if-history-row{display:grid;grid-template-columns:1fr auto;gap:8px;border-top:1px solid #eee;padding-top:7px;font-size:12px}.if-history-row:first-child{border-top:0;padding-top:0}.if-empty{text-align:center;padding:25px 10px;color:#777;font-size:13px}
    @media(max-width:600px){#${BUTTON_ID}{font-size:11px;padding:6px 8px;margin-right:5px}.if-wrap{padding-left:8px;padding-right:8px}.if-card{padding:10px}.if-table{min-width:720px}.if-table th:first-child,.if-table td:first-child{min-width:145px}.if-detail{max-width:155px}}
  `;
  document.head.appendChild(style);
}

function ensureButton() {
  const topbar = document.querySelector(".topbar");
  if (!topbar || document.querySelector(`#${BUTTON_ID}`)) return;
  const button = document.createElement("button");
  button.id = BUTTON_ID;
  button.type = "button";
  button.textContent = "在庫運用";
  button.addEventListener("click", openPanel);
  const sync = document.querySelector("#syncStatus");
  if (sync) topbar.insertBefore(button, sync);
  else topbar.appendChild(button);
}

let selectedSessionId = "";
let loaded = null;

async function openPanel() {
  if (document.querySelector(`#${PANEL_ID}`)) return;
  const overlay = document.createElement("div");
  overlay.id = PANEL_ID;
  overlay.innerHTML = `
    <div class="if-head"><h2>イベント在庫運用</h2><button class="if-close" type="button">閉じる</button></div>
    <div class="if-wrap"><div class="if-card"><div class="if-muted">読み込み中…</div></div></div>`;
  document.body.appendChild(overlay);
  overlay.querySelector(".if-close").addEventListener("click", () => overlay.remove());
  await renderPanel();
}

async function renderPanel(message = "") {
  const overlay = document.querySelector(`#${PANEL_ID}`);
  if (!overlay) return;
  const wrap = overlay.querySelector(".if-wrap");

  try {
    const sessions = await listOpenEventSessions();
    if (!selectedSessionId && sessions.length) selectedSessionId = sessions[0].id;
    if (selectedSessionId && !sessions.some(s => s.id === selectedSessionId)) {
      selectedSessionId = sessions[0]?.id || "";
    }

    if (!sessions.length) {
      wrap.innerHTML = `<div class="if-card"><div class="if-empty">OpenのイベントSessionがありません。</div></div>`;
      return;
    }

    loaded = selectedSessionId ? await loadEventInventoryFlow(selectedSessionId) : null;
    const session = loaded?.session;
    const state = loaded?.state;
    const openingExists = Boolean(session?.inventoryCount?.opening);
    const latest = state?.latestCheckpoint;

    wrap.innerHTML = `
      <div class="if-card">
        <h3>Session</h3>
        <select id="ifSession" class="if-select">
          ${sessions.map(s => `<option value="${esc(s.id)}" ${s.id === selectedSessionId ? "selected" : ""}>${esc(sessionName(s))}</option>`).join("")}
        </select>
        ${message ? `<div class="if-good">${esc(message)}</div>` : ""}
        ${!openingExists ? `<div class="if-warning">このSessionには開始在庫がありません。まず通常のSessions画面で開始在庫を保存してください。</div>` : ""}
        <div class="if-muted" style="margin-top:8px">Restockと開始在庫修正は、会社の実在庫そのものを直接増減しません。イベント内の持込数の履歴として記録します。</div>
      </div>
      ${openingExists ? inventoryCard(session, state) : ""}
      ${openingExists ? historyCard(state) : ""}
    `;

    overlay.querySelector("#ifSession")?.addEventListener("change", async event => {
      selectedSessionId = event.target.value;
      await renderPanel();
    });

    bindInventoryActions();
  } catch (error) {
    wrap.innerHTML = `<div class="if-card"><div class="if-warning">${esc(error?.message || error)}</div><button class="if-btn" id="ifRetry">再読み込み</button></div>`;
    overlay.querySelector("#ifRetry")?.addEventListener("click", () => renderPanel());
  }
}

function inventoryCard(session, state) {
  const rows = state?.rows || [];
  const latest = state?.latestCheckpoint;
  const reuse = latest && state.checkpointStillCurrent;
  const statusHtml = !latest
    ? `<div class="if-warning">まだ途中在庫カウントがありません。</div>`
    : reuse
      ? `<div class="if-good">前回カウント後にSKU販売・Restock・開始在庫修正の変化はありません。前回実数を再利用できます。</div>`
      : `<div class="if-warning">前回カウント後に在庫変動があります。変動したSKUは再確認してください。</div>`;

  return `
    <div class="if-card">
      <h3>在庫ボード</h3>
      ${statusHtml}
      <div class="if-muted">開始 + Restock ± 修正 − SKU販売 = 予測残。実数は棚卸し時に入力します。予測がマイナスでも表示します。</div>
      <div class="if-table-wrap" style="margin-top:10px">
        <table class="if-table">
          <thead><tr><th>商品</th><th>開始</th><th>Restock</th><th>修正</th><th>SKU販売</th><th>予測残</th><th>実数</th><th>操作</th></tr></thead>
          <tbody>
            ${rows.map(row => `
              <tr data-variant-id="${esc(row.variantId)}">
                <td><div class="if-name">${esc(row.label || row.sku || row.variantId)}</div><div class="if-detail">${esc(row.detail || row.sku || row.variantId)}</div></td>
                <td>${row.openingQty}</td>
                <td class="if-plus">${row.restockQty ? `+${row.restockQty}` : "0"}</td>
                <td class="${row.openingCorrection < 0 ? "if-negative" : ""}">${row.openingCorrection > 0 ? "+" : ""}${row.openingCorrection}</td>
                <td>${row.skuSales}</td>
                <td class="${row.expectedQty < 0 ? "if-negative" : row.expectedQty === 0 ? "if-zero" : ""}">${row.expectedQty}</td>
                <td><input class="if-number if-physical" type="number" inputmode="numeric" min="0" step="1" data-variant-id="${esc(row.variantId)}" value=""></td>
                <td><button class="if-mini if-restock" type="button" data-variant-id="${esc(row.variantId)}">+Restock</button> <button class="if-mini if-correct" type="button" data-variant-id="${esc(row.variantId)}">±修正</button></td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>
      <div class="if-actions">
        ${reuse ? `<button class="if-btn" id="ifReuseCount" type="button">前回実数を再利用</button>` : ""}
        <button class="if-btn primary" id="ifSaveCheckpoint" type="button">途中カウントを保存</button>
        <button class="if-btn" id="ifSaveDaily" type="button">日次カウントとして保存</button>
        <button class="if-btn" id="ifSaveFinalCount" type="button">最終実数として保存</button>
      </div>
      <div class="if-muted" style="margin-top:8px">「最終実数として保存」はカウント記録だけです。現行のイベント終了処理はまだ実行しません。</div>
    </div>`;
}

function historyCard(state) {
  const flow = [...(state?.flowEntries || [])].reverse().slice(0, 15);
  const checkpoints = [...(state?.checkpoints || [])].reverse().slice(0, 8);
  return `
    <div class="if-card">
      <h3>変更履歴</h3>
      <div class="if-history">
        ${flow.length ? flow.map(entry => {
          const row = state.rows.find(r => r.variantId === entry.variantId);
          const typeLabel = entry.type === "restock" ? "Restock" : "開始在庫修正";
          const qty = entry.quantity > 0 ? `+${entry.quantity}` : String(entry.quantity);
          return `<div class="if-history-row"><div><strong>${esc(typeLabel)} ${esc(qty)}</strong> / ${esc(row?.label || entry.variantId)}<div class="if-muted">${esc(formatTime(entry.recordedAtIso))}${entry.note ? ` / ${esc(entry.note)}` : ""}</div></div><button class="if-mini if-delete-flow" data-entry-id="${esc(entry.id)}" type="button">取消</button></div>`;
        }).join("") : `<div class="if-muted">変更履歴はありません。</div>`}
      </div>
    </div>
    <div class="if-card">
      <h3>在庫カウント履歴</h3>
      <div class="if-history">
        ${checkpoints.length ? checkpoints.map(cp => `<div class="if-history-row"><div><strong>${esc(cp.type === "daily_close" ? "日次" : cp.type === "final_count" ? "最終実数" : "途中")}</strong> / ${esc(formatTime(cp.capturedAtIso))}<div class="if-muted">${cp.items.length} SKU${cp.label ? ` / ${esc(cp.label)}` : ""}</div></div><button class="if-mini if-delete-checkpoint" data-checkpoint-id="${esc(cp.id)}" type="button">取消</button></div>`).join("") : `<div class="if-muted">カウント履歴はありません。</div>`}
      </div>
    </div>`;
}

function findRow(variantId) {
  return loaded?.state?.rows?.find(row => row.variantId === variantId) || null;
}

async function adjustment(variantId, type) {
  const row = findRow(variantId);
  if (!row) return;
  const isRestock = type === "restock";
  const raw = window.prompt(
    isRestock ? `${row.label || "商品"}\n追加した数量を入力` : `${row.label || "商品"}\n開始在庫の修正値を入力（例 +2 / -1）`,
    isRestock ? "1" : "0"
  );
  if (raw === null) return;
  const quantity = Number(raw);
  if (!Number.isInteger(quantity) || (isRestock ? quantity <= 0 : quantity === 0)) {
    window.alert("整数で数量を入力してください。");
    return;
  }
  const note = window.prompt("メモ（任意）", "") ?? "";
  await addEventInventoryAdjustment({
    sessionId: selectedSessionId,
    type,
    variantId,
    quantity,
    note,
    recordedByEmail: userEmail(),
    item: row
  });
  await renderPanel(isRestock ? `Restock ${quantity}点を記録しました。` : `開始在庫修正 ${quantity > 0 ? "+" : ""}${quantity}点を記録しました。`);
}

function collectPhysicalInputs() {
  return [...document.querySelectorAll(`#${PANEL_ID} .if-physical`)]
    .map(input => ({
      variantId: input.dataset.variantId,
      physicalQty: input.value === "" ? null : Number(input.value)
    }))
    .filter(row => row.variantId && Number.isInteger(row.physicalQty) && row.physicalQty >= 0);
}

async function saveCheckpoint(type) {
  const items = collectPhysicalInputs();
  if (!items.length) {
    window.alert("実際に数えたSKUの実数を入力してください。");
    return;
  }
  const label = type === "daily_close"
    ? (window.prompt("日次メモ（任意。例: Day 1）", "") ?? "")
    : "";
  await saveEventInventoryCheckpoint({
    sessionId: selectedSessionId,
    items,
    type,
    label,
    capturedByEmail: userEmail()
  });
  await renderPanel(`${items.length} SKUの実数を保存しました。`);
}

function bindInventoryActions() {
  const overlay = document.querySelector(`#${PANEL_ID}`);
  if (!overlay) return;

  overlay.querySelectorAll(".if-restock").forEach(button => {
    button.addEventListener("click", () => adjustment(button.dataset.variantId, "restock").catch(error => window.alert(error?.message || error)));
  });
  overlay.querySelectorAll(".if-correct").forEach(button => {
    button.addEventListener("click", () => adjustment(button.dataset.variantId, "opening_correction").catch(error => window.alert(error?.message || error)));
  });
  overlay.querySelector("#ifReuseCount")?.addEventListener("click", () => {
    const latest = loaded?.state?.latestCheckpoint;
    if (!latest || !loaded?.state?.checkpointStillCurrent) return;
    const map = new Map(latest.items.map(row => [row.variantId, row.physicalQty]));
    overlay.querySelectorAll(".if-physical").forEach(input => {
      if (map.has(input.dataset.variantId)) input.value = String(map.get(input.dataset.variantId));
    });
  });
  overlay.querySelector("#ifSaveCheckpoint")?.addEventListener("click", () => saveCheckpoint("checkpoint").catch(error => window.alert(error?.message || error)));
  overlay.querySelector("#ifSaveDaily")?.addEventListener("click", () => saveCheckpoint("daily_close").catch(error => window.alert(error?.message || error)));
  overlay.querySelector("#ifSaveFinalCount")?.addEventListener("click", () => saveCheckpoint("final_count").catch(error => window.alert(error?.message || error)));
  overlay.querySelectorAll(".if-delete-flow").forEach(button => {
    button.addEventListener("click", async () => {
      if (!window.confirm("この在庫変更履歴を取り消しますか？")) return;
      try {
        await deleteEventInventoryAdjustment({ sessionId: selectedSessionId, entryId: button.dataset.entryId });
        await renderPanel("変更履歴を取り消しました。");
      } catch (error) { window.alert(error?.message || error); }
    });
  });
  overlay.querySelectorAll(".if-delete-checkpoint").forEach(button => {
    button.addEventListener("click", async () => {
      if (!window.confirm("この在庫カウントを取り消しますか？")) return;
      try {
        await deleteEventInventoryCheckpoint({ sessionId: selectedSessionId, checkpointId: button.dataset.checkpointId });
        await renderPanel("在庫カウントを取り消しました。");
      } catch (error) { window.alert(error?.message || error); }
    });
  });
}

installStyles();
ensureButton();
new MutationObserver(ensureButton).observe(document.body, { childList: true, subtree: true });
