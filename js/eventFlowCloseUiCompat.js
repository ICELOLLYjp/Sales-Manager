import { getFirebaseState } from "./firebase.js";
import { loadUnidentifiedQuickSummary } from "./services/unidentifiedQuickService.js?v=20260916-flow-accounting-1";
import { finalizeEventSession } from "./services/eventCloseFlowCompatService.js?v=20260916-flow-close-1";
import { closeEventWithUnidentified } from "./services/closeWithUnidentifiedFlowCompatService.js?v=20260916-flow-close-1";

const INVENTORY_SESSION_KEY = "icelolly-sales-inventory-session";
const FLOW_TYPES = new Set(["restock", "opening_correction"]);

function text(value) {
  return String(value ?? "").trim();
}

function currentSessionId() {
  return text(localStorage.getItem(INVENTORY_SESSION_KEY));
}

function currentEmail() {
  return text(getFirebaseState()?.auth?.currentUser?.email);
}

async function firestoreModule() {
  return await import("https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js");
}

async function loadSession(sessionId) {
  const { db, enabled } = getFirebaseState();
  if (!enabled || !db || !sessionId) return null;
  const { doc, getDocFromServer } = await firestoreModule();
  const snapshot = await getDocFromServer(doc(db, "salesSessions", sessionId));
  return snapshot.exists() ? { sessionId: snapshot.id, ...snapshot.data() } : null;
}

function hasEventFlow(session) {
  return (Array.isArray(session?.inventoryCount?.flowEntries)
    ? session.inventoryCount.flowEntries
    : [])
    .some(entry => FLOW_TYPES.has(text(entry?.type)) && Number(entry?.quantity || 0) !== 0);
}

function closeInventoryPanel() {
  const button = document.querySelector("#closeInventoryCountButton");
  if (button) {
    button.click();
    return;
  }
  location.reload();
}

let patching = false;
let patchedSessionId = "";
let flowPresent = false;
let currentSummary = null;
let actionMode = "";

async function refreshFlowCloseState() {
  if (patching) return;
  const sessionId = currentSessionId();
  const hubAction = document.querySelector("#eventCloseHubAction");
  if (!sessionId || !hubAction) return;

  patching = true;
  try {
    const session = await loadSession(sessionId);
    if (!session || currentSessionId() !== sessionId) return;

    flowPresent = hasEventFlow(session);
    patchedSessionId = sessionId;
    currentSummary = null;
    actionMode = "";

    if (!flowPresent || session.status === "closed") {
      delete hubAction.dataset.eventFlowCloseMode;
      return;
    }

    const summary = await loadUnidentifiedQuickSummary({ sessionId });
    if (currentSessionId() !== sessionId || !hubAction.isConnected) return;
    currentSummary = summary;

    if (!summary.closingComplete) return;

    if (summary.sessionStatus === "pending_allocation" && summary.unresolvedTotal > 0) {
      actionMode = "unidentified";
      hubAction.dataset.eventFlowCloseMode = actionMode;
      hubAction.disabled = false;
      hubAction.textContent = `未特定 ${summary.unresolvedTotal} 点を残して正式終了`;
      const next = document.querySelector("#eventCloseHubNext");
      if (next) next.textContent = "Restock / 開始在庫修正を含めて照合し、未特定分はSKUを推測せずに終了します。";
      return;
    }

    if (summary.unresolvedTotal === 0) {
      actionMode = "finalize";
      hubAction.dataset.eventFlowCloseMode = actionMode;
      hubAction.disabled = false;
      hubAction.textContent = "イベントを終了して在庫を確定";
      const next = document.querySelector("#eventCloseHubNext");
      if (next) next.textContent = "Restock / 開始在庫修正をイベント内数量として含めて最終照合します。";
    }
  } catch (error) {
    console.warn("Event flow close UI could not be prepared.", error);
  } finally {
    patching = false;
  }
}

async function runFlowClose(button, mode) {
  const sessionId = currentSessionId();
  if (!sessionId || !flowPresent || patchedSessionId !== sessionId) return false;

  const summary = currentSummary || await loadUnidentifiedQuickSummary({ sessionId });
  if (!summary.closingComplete) return false;

  const isUnidentified = mode === "unidentified";
  const message = isUnidentified
    ? `未特定販売 ${summary.unresolvedTotal} 点を残したままイベントを正式終了します。\n\nRestock / 開始在庫修正はイベント内数量として照合します。\n未特定分はSKUを推測して在庫を減らしません。\n\nこの内容で終了しますか？`
    : "イベントを正式終了します。\n\nRestock / 開始在庫修正を含めて終了在庫と照合します。\nこれらは会社実在庫を直接増減しません。\n\nこの内容で終了しますか？";

  if (!window.confirm(message)) return true;

  const original = button.textContent;
  button.disabled = true;
  button.textContent = "正式終了中…";

  try {
    const result = isUnidentified
      ? await closeEventWithUnidentified({
          sessionId,
          closedByEmail: currentEmail()
        })
      : await finalizeEventSession({
          sessionId,
          closedByEmail: currentEmail()
        });

    const flowText = [
      Number(result?.restockTotal || 0) ? `Restock +${Number(result.restockTotal)}` : "",
      Number(result?.openingCorrectionTotal || 0)
        ? `開始修正 ${Number(result.openingCorrectionTotal) > 0 ? "+" : ""}${Number(result.openingCorrectionTotal)}`
        : ""
    ].filter(Boolean).join(" / ");

    window.alert(
      isUnidentified
        ? `イベントを正式終了しました。\n未特定 ${result?.unresolvedTotal ?? summary.unresolvedTotal} 点は未特定のまま保存しました。${flowText ? `\n${flowText} をイベント在庫に反映して照合しました。` : ""}`
        : `イベントを正式終了しました。${flowText ? `\n${flowText} をイベント在庫に反映して照合しました。` : ""}`
    );

    localStorage.removeItem(INVENTORY_SESSION_KEY);
    closeInventoryPanel();
  } catch (error) {
    window.alert(error?.message || String(error));
    button.disabled = false;
    button.textContent = original;
    void refreshFlowCloseState();
  }

  return true;
}

document.addEventListener("click", event => {
  const button = event.target?.closest?.("#eventCloseHubAction");
  if (!button) return;
  const mode = text(button.dataset.eventFlowCloseMode || actionMode);
  if (!flowPresent || !["finalize", "unidentified"].includes(mode)) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  void runFlowClose(button, mode);
}, true);

let scheduled = false;
function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    void refreshFlowCloseState();
  });
}

schedule();
new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) schedule();
});
