import { loadUnidentifiedQuickSummary } from "./services/unidentifiedQuickService.js?v=20260915-unidentified-quick-1";
import { provisionallyCloseWithoutCount } from "./services/provisionalWithoutCountService.js?v=20260916-skip-count-1";
import { getOfflineSalesQueueForSession } from "./services/offlineQueueService.js?v=20260911-offline-resilience-1";

const INVENTORY_SESSION_KEY = "icelolly-sales-inventory-session";
const TSHIRT_COUNT_URL = "https://icelollyjp.github.io/T-shirts-Stock/event-count.html";
const ACCESSORY_COUNT_URL = "https://icelollyjp.github.io/Accessories/event-count.html";

function text(value) {
  return String(value ?? "").trim();
}

function currentSessionId() {
  return text(localStorage.getItem(INVENTORY_SESSION_KEY));
}

function statusInfo(value) {
  if (value === "confirmed") return { label: "確定", className: "ok" };
  if (value === "draft") return { label: "途中保存", className: "draft" };
  return { label: "未確認", className: "idle" };
}

function injectStyles() {
  if (document.querySelector("#eventCloseHubStyles")) return;
  const style = document.createElement("style");
  style.id = "eventCloseHubStyles";
  style.textContent = `
    #eventCloseHub{margin:12px 0;padding:14px;border:2px solid #222;border-radius:16px;background:#fff;box-shadow:0 5px 18px rgba(0,0,0,.06)}
    #eventCloseHub .ech-title{font-size:19px;font-weight:900;line-height:1.25}
    #eventCloseHub .ech-note{font-size:12px;line-height:1.55;color:#666;margin-top:4px}
    #eventCloseHub .ech-status-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px}
    #eventCloseHub .ech-status{border:1px solid #deded9;border-radius:12px;padding:10px;background:#fafaf8}
    #eventCloseHub .ech-status-top{display:flex;justify-content:space-between;gap:8px;align-items:center}
    #eventCloseHub .ech-status-name{font-size:12px;font-weight:800}
    #eventCloseHub .ech-badge{display:inline-flex;align-items:center;min-height:24px;padding:0 8px;border-radius:999px;font-size:10px;font-weight:900;background:#eee;color:#666}
    #eventCloseHub .ech-badge.ok{background:#e7f6eb;color:#24723b}.ech-badge.draft{background:#fff4ce;color:#745d00}.ech-badge.idle{background:#eee;color:#777}
    #eventCloseHub .ech-count-link{display:block;margin-top:8px;min-height:40px;padding:9px 10px;border:1px solid #d8d8d2;border-radius:10px;text-align:center;text-decoration:none;color:#222;background:#fff;font-size:12px;font-weight:800;line-height:1.6}
    #eventCloseHub .ech-reconcile{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:10px;padding:11px;border:1px solid #e2d19c;border-radius:12px;background:#fffaf0}
    #eventCloseHub .ech-reconcile strong{font-size:13px}.ech-unresolved{font-size:22px;font-weight:900;white-space:nowrap}
    #eventCloseHubDetails{margin-top:10px;border:1px solid #deded9;border-radius:12px;background:#fafaf8;overflow:hidden}
    #eventCloseHubDetails>summary{cursor:pointer;padding:12px;font-size:13px;font-weight:800;list-style-position:inside}
    #eventCloseHubDetailsBody{padding:0 10px 10px}
    #eventCloseHubAction{width:100%;min-height:54px;margin-top:12px;font-size:16px;font-weight:900}
    #eventCloseHubAction[disabled]{opacity:.45}
    #eventCloseHub .ech-next{font-size:11px;line-height:1.5;color:#666;margin-top:7px;text-align:center}
    #eventCloseHub .ech-closed{margin-top:12px;padding:11px;border-radius:12px;background:#eef8f0;color:#256c37;font-size:13px;font-weight:800;text-align:center}
    @media(max-width:520px){#eventCloseHub{margin-left:0;margin-right:0;padding:12px}#eventCloseHub .ech-status-grid{grid-template-columns:1fr 1fr}#eventCloseHub .ech-count-link{font-size:11px;padding:8px 5px}}
  `;
  document.head.appendChild(style);
}

function createHub() {
  const hub = document.createElement("section");
  hub.id = "eventCloseHub";
  hub.innerHTML = `
    <div class="ech-title">イベント終了</div>
    <div class="ech-note">棚卸 → 未特定確認 → 終了をここだけで進めます。</div>
    <div class="ech-status-grid">
      <div class="ech-status">
        <div class="ech-status-top"><span class="ech-status-name">Tシャツ棚卸</span><span id="eventCloseHubTshirtStatus" class="ech-badge idle">確認中</span></div>
        <a id="eventCloseHubTshirtLink" class="ech-count-link" href="#">Tシャツ棚卸を開く</a>
      </div>
      <div class="ech-status">
        <div class="ech-status-top"><span class="ech-status-name">アクセサリー棚卸</span><span id="eventCloseHubAccessoryStatus" class="ech-badge idle">確認中</span></div>
        <a id="eventCloseHubAccessoryLink" class="ech-count-link" href="#">アクセサリー棚卸を開く</a>
      </div>
    </div>
    <div class="ech-reconcile">
      <div><strong>未特定販売</strong><div id="eventCloseHubReconcileNote" class="ech-note" style="margin-top:2px;">確認中…</div></div>
      <div id="eventCloseHubUnresolved" class="ech-unresolved">–</div>
    </div>
    <details id="eventCloseHubDetails">
      <summary id="eventCloseHubDetailsSummary">詳細を見る</summary>
      <div id="eventCloseHubDetailsBody"></div>
    </details>
    <button id="eventCloseHubAction" type="button" class="button" disabled>状態を確認中…</button>
    <div id="eventCloseHubNext" class="ech-next"></div>
  `;
  return hub;
}

function placeHub(hub) {
  const closeButton = document.querySelector("#closeInventoryCountButton");
  if (closeButton?.parentElement?.parentElement) {
    const headerRow = closeButton.parentElement;
    headerRow.insertAdjacentElement("afterend", hub);
    return true;
  }

  const unidentified = document.querySelector("#unidentifiedQuickSummaryPanel");
  if (unidentified) {
    unidentified.insertAdjacentElement("beforebegin", hub);
    return true;
  }
  return false;
}

function quickDetailsElement() {
  return Array.from(document.querySelectorAll("details"))
    .find(details => details.id !== "eventCloseHubDetails" && details.querySelector(".quickAllocationSelect")) || null;
}

function collapseInventoryDetails() {
  document.querySelectorAll("details").forEach(details => {
    if (details.id === "eventCloseHubDetails") return;
    const summary = details.querySelector(":scope > summary");
    const label = text(summary?.textContent);
    if (label.includes("現在のSKU別在庫残数を見る") && details.dataset.eventCloseHubCollapsed !== "1") {
      details.open = false;
      details.dataset.eventCloseHubCollapsed = "1";
    }
  });
}

function moveDetailsIntoHub() {
  const body = document.querySelector("#eventCloseHubDetailsBody");
  if (!body) return;

  const unidentified = document.querySelector("#unidentifiedQuickSummaryPanel");
  if (unidentified && unidentified.parentElement !== body) {
    body.appendChild(unidentified);
  }

  const quickDetails = quickDetailsElement();
  if (quickDetails && quickDetails.parentElement !== body) {
    body.appendChild(quickDetails);
    quickDetails.open = false;
  }
}

function hiddenNativeAction(id) {
  const button = document.querySelector(id);
  if (!button) return null;
  if (!button.closest("#eventCloseHub")) button.style.display = "none";
  else if (button.id !== "eventCloseHubAction") button.style.display = "none";
  return button;
}

function nativeActions() {
  return {
    provisional: hiddenNativeAction("#provisionallyCloseEventSessionButton"),
    finalize: hiddenNativeAction("#finalizeEventSessionButton"),
    unidentifiedFinalize: hiddenNativeAction("#closeWithUnidentifiedButton")
  };
}

function actionState(summary, actions, sessionId) {
  if (summary.sessionStatus === "closed") {
    return { label: "イベント終了済み", disabled: true, target: null, mode: "none", note: "このイベントは終了済みです。" };
  }

  if (!summary.closingComplete) {
    if (summary.sessionStatus === "open") {
      const pendingOffline = getOfflineSalesQueueForSession(sessionId).length;

      if (!navigator.onLine) {
        return {
          label: "オンラインで仮終了してください",
          disabled: true,
          target: null,
          mode: "none",
          note: "棚卸せずに仮終了する時は、POS停止をFirebaseへ保存するためオンライン接続が必要です。"
        };
      }

      if (pendingOffline > 0) {
        return {
          label: `未同期会計 ${pendingOffline} 件を先に同期`,
          disabled: true,
          target: null,
          mode: "none",
          note: "未同期の会計を残したままPOSを停止すると売上が欠けるため、先に同期してください。"
        };
      }

      return {
        label: "棚卸せずに仮終了",
        disabled: false,
        target: null,
        mode: "skip_count",
        note: "POSだけ停止します。在庫・終了実数・Quick配分は変更せず、あとで棚卸から再開できます。"
      };
    }

    if (summary.sessionStatus === "pending_allocation") {
      return {
        label: "仮終了済み・棚卸待ち",
        disabled: true,
        target: null,
        mode: "none",
        note: "POSは停止済みです。Tシャツ／アクセサリー棚卸を行うと、その後の終了処理へ進めます。"
      };
    }

    return {
      label: "先に棚卸を完了してください",
      disabled: true,
      target: null,
      mode: "none",
      note: "Tシャツ・アクセサリーの終了実数を確認してから終了できます。"
    };
  }

  if (summary.sessionStatus === "open" && summary.unresolvedTotal > 0) {
    return {
      label: `未特定 ${summary.unresolvedTotal} 点を残して仮終了`,
      disabled: !actions.provisional || actions.provisional.disabled,
      target: actions.provisional,
      mode: "native",
      note: "まずPOSを停止して仮終了します。あとでそのまま正式終了できます。"
    };
  }

  if (summary.sessionStatus === "pending_allocation" && summary.unresolvedTotal > 0) {
    return {
      label: `未特定 ${summary.unresolvedTotal} 点を残して正式終了`,
      disabled: !actions.unidentifiedFinalize || actions.unidentifiedFinalize.disabled,
      target: actions.unidentifiedFinalize,
      mode: "native",
      note: "未特定分はSKUを推測せず、そのまま記録してイベントを終了します。"
    };
  }

  return {
    label: "イベントを終了して在庫を確定",
    disabled: !actions.finalize || actions.finalize.disabled,
    target: actions.finalize,
    mode: "native",
    note: actions.finalize?.disabled
      ? "在庫差異など、まだ確認が必要な項目があります。詳細を確認してください。"
      : "SKUまで確定した販売と調整を正式在庫へ反映して終了します。"
  };
}

let lastSummary = null;
let actionTarget = null;
let actionMode = "none";
let loadingSessionId = "";

async function handleSkipCountClose(button) {
  const sessionId = currentSessionId();
  if (!sessionId || !lastSummary || lastSummary.sessionStatus !== "open" || lastSummary.closingComplete) return;

  const pendingOffline = getOfflineSalesQueueForSession(sessionId).length;
  if (pendingOffline > 0) {
    window.alert(`未同期会計が ${pendingOffline} 件あります。先に同期してから仮終了してください。`);
    return;
  }

  if (!navigator.onLine) {
    window.alert("棚卸せずに仮終了する時はオンライン接続が必要です。");
    return;
  }

  const ok = window.confirm(
    "棚卸をせずにイベントを仮終了します。\n\n" +
    "・POS販売を停止します\n" +
    "・正式在庫は変更しません\n" +
    "・終了在庫やQuick配分も変更しません\n" +
    "・あとでTシャツ／アクセサリー棚卸から再開できます\n\n" +
    "この内容で仮終了しますか？"
  );
  if (!ok) return;

  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "仮終了中…";

  try {
    await provisionallyCloseWithoutCount({
      sessionId,
      closedByEmail: ""
    });

    window.alert("棚卸せずに仮終了しました。POS販売は停止済みです。在庫は変更していません。あとで棚卸から再開できます。");
    lastSummary = null;
    actionTarget = null;
    actionMode = "none";
    loadingSessionId = "";
    await updateHub();
  } catch (error) {
    window.alert(error?.message || String(error));
    button.disabled = false;
    button.textContent = originalText;
  }
}

async function updateHub() {
  injectStyles();
  collapseInventoryDetails();

  const sessionId = currentSessionId();
  if (!sessionId) return;

  let hub = document.querySelector("#eventCloseHub");
  if (!hub) {
    hub = createHub();
    if (!placeHub(hub)) return;
  }

  const tshirtLink = document.querySelector("#eventCloseHubTshirtLink");
  const accessoryLink = document.querySelector("#eventCloseHubAccessoryLink");
  if (tshirtLink) tshirtLink.href = `${TSHIRT_COUNT_URL}?session=${encodeURIComponent(sessionId)}`;
  if (accessoryLink) accessoryLink.href = `${ACCESSORY_COUNT_URL}?session=${encodeURIComponent(sessionId)}`;

  moveDetailsIntoHub();

  if (loadingSessionId === sessionId) return;
  loadingSessionId = sessionId;

  try {
    const summary = await loadUnidentifiedQuickSummary({ sessionId });
    if (currentSessionId() !== sessionId || !document.querySelector("#eventCloseHub")) return;
    lastSummary = summary;

    const tshirtStatus = statusInfo(summary.tshirtCountStatus);
    const accessoryStatus = statusInfo(summary.accessoryCountStatus);
    const tshirtBadge = document.querySelector("#eventCloseHubTshirtStatus");
    const accessoryBadge = document.querySelector("#eventCloseHubAccessoryStatus");
    if (tshirtBadge) {
      tshirtBadge.textContent = tshirtStatus.label;
      tshirtBadge.className = `ech-badge ${tshirtStatus.className}`;
    }
    if (accessoryBadge) {
      accessoryBadge.textContent = accessoryStatus.label;
      accessoryBadge.className = `ech-badge ${accessoryStatus.className}`;
    }

    const unresolved = document.querySelector("#eventCloseHubUnresolved");
    const reconcileNote = document.querySelector("#eventCloseHubReconcileNote");
    if (unresolved) unresolved.textContent = `${summary.unresolvedTotal} 点`;
    if (reconcileNote) {
      reconcileNote.textContent = summary.unresolvedTotal > 0
        ? `Quick ${summary.quickTotal} 点中、${summary.identifiedTotal} 点特定済み`
        : `Quick ${summary.quickTotal} 点は説明済み`;
    }

    const detailsSummary = document.querySelector("#eventCloseHubDetailsSummary");
    if (detailsSummary) {
      detailsSummary.textContent = summary.unresolvedTotal > 0
        ? `詳細・SKU個別指定を見る（未特定 ${summary.unresolvedTotal} 点）`
        : "詳細を見る";
    }

    moveDetailsIntoHub();
    const actions = nativeActions();
    const state = actionState(summary, actions, sessionId);
    actionTarget = state.target;
    actionMode = state.mode;

    const action = document.querySelector("#eventCloseHubAction");
    const next = document.querySelector("#eventCloseHubNext");
    if (action) {
      action.textContent = state.label;
      action.disabled = state.disabled;
    }
    if (next) next.textContent = state.note;
  } catch (error) {
    const next = document.querySelector("#eventCloseHubNext");
    const action = document.querySelector("#eventCloseHubAction");
    actionTarget = null;
    actionMode = "none";
    if (next) next.textContent = error?.message || String(error);
    if (action) {
      action.textContent = "状態を再確認してください";
      action.disabled = true;
    }
  } finally {
    loadingSessionId = "";
  }
}

document.addEventListener("click", event => {
  const button = event.target.closest?.("#eventCloseHubAction");
  if (!button) return;
  event.preventDefault();

  if (actionMode === "skip_count") {
    void handleSkipCountClose(button);
    return;
  }

  if (!actionTarget || actionTarget.disabled) return;
  actionTarget.click();
});

let scheduled = false;
function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    void updateHub();
  });
}

schedule();
new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) schedule();
});
