import { planEventTshirtSkuRegistration, diagnoseVisibleMissingTshirtSkus } from "./services/eventTshirtSkuRegistration.mjs";
import { listAllProductVariants, registerTshirtVariant } from "./services/productAdminService.js";
import { tshirtAdapter } from "./inventoryAdapters/tshirtAdapter.js";
import { loadEventInventoryCount } from "./services/inventoryCountService.js";
import { listSalesSessions } from "./services/sessionService.js";

const BUTTON_ID = "posRegisterCarriedTshirtSkus";
let busy = false;

function selectedSessionId() {
  return String(document.querySelector("#posSessionSelect")?.value || "").trim();
}
function showMessage(message, error = false) {
  const target = document.getElementById("posRegisterCarriedTshirtStatus");
  if (target) {
    target.textContent = message;
    target.style.color = error ? "#a32d43" : "#313131";
  }
}

function visibleMissingSkuIds() {
  return [...new Set(Array.from(document.querySelectorAll("button.posSkuItem"))
    .filter(button => button.textContent.includes("SKU未登録"))
    .map(button => String(button.dataset.variantId || "").trim())
    .filter(Boolean))];
}

function diagnosisMessage(plan) {
  const d = plan.diagnosis;
  if (!d.visible) {
    return "現在表示中のPOSには未登録SKUが見つかりません。SKU画面を開き直してから確認してください。";
  }
  const parts = [
    "POS上の未登録 " + d.visible + " SKU",
    "Firestoreに登録済み " + d.registeredInDb,
    "イベント開始在庫のIDに一致しない " + d.missingFromOpening,
    "登録条件を満たさない " + (d.excluded + d.unexplained)
  ];
  if (d.registeredInDb === d.visible) {
    return parts.join("、") + "。商品データは登録済みです。POSのQuickからSKUへ切り替えて再取得してください。";
  }
  if (d.missingFromOpening) {
    return parts.join("、") + "。POSとイベント在庫のSKU IDが不一致です。自動登録せず照合が必要です。";
  }
  if (d.excluded || d.unexplained) {
    const first = d.statuses.filter(x => ["excluded","unexplained"].includes(x.status)).slice(0, 3);
    return parts.join("、") + "。照合理由：" +
      first.map(x => x.variantId + "（" + (x.reason || "追加判定不一致") + "）").join("、") +
      "。実在庫を変更せず停止しました。";
  }
  return parts.join("、") + "。登録候補がゼロです。POSの表示を再読込してください。";
}

async function readPlan(sessionId, visibleIds = []) {
  const [count, registeredVariants, masterOptions, sessions] = await Promise.all([
    loadEventInventoryCount(sessionId),
    listAllProductVariants(),
    tshirtAdapter.getMasterOptions(),
    listSalesSessions()
  ]);
  if (!sessions.some(s => s.sessionId === sessionId &&
      ["open", "pending_allocation"].includes(s.status))) {
    throw new Error("開催中の販売イベントを確認できません。");
  }
  if (!Array.isArray(count?.opening?.items)) {
    throw new Error("イベント開始在庫が未登録です。");
  }
  const plan = planEventTshirtSkuRegistration({
    openingItems: count.opening.items,
    flowEntries: count.flowEntries || [],
    soldByVariant: count.soldByVariant || {},
    registeredVariants,
    masterOptions
  });
  return {
    ...plan,
    diagnosis: diagnoseVisibleMissingTshirtSkus({
      visibleMissingIds: visibleIds,
      openingItems: count.opening.items,
      flowEntries: count.flowEntries || [],
      registeredVariants,
      plan
    })
  };
}

async function registerMissingSku() {
  if (busy) return;
  const button = document.getElementById(BUTTON_ID);
  const sessionId = selectedSessionId();
  if (!button || !sessionId || !navigator.onLine) {
    showMessage("販売イベントを選択し、オンラインで確認してください。", true);
    return;
  }
  busy = true;
  button.disabled = true;
  button.textContent = "在庫と登録情報を確認中";
  try {
    const missingIds = visibleMissingSkuIds();
    const initial = await readPlan(sessionId, missingIds);
    if (selectedSessionId() !== sessionId) throw new Error("イベントが切り替わりました。");
    if (!initial.rows.length) {
      showMessage(diagnosisMessage(initial), Boolean(initial.diagnosis.missingFromOpening ||
        initial.diagnosis.excluded || initial.diagnosis.unexplained));
      return;
    }
    const message = initial.rows.length + " SKUの商品情報を登録しますか？\n" +
      "商品情報だけを追加し、実在庫やイベント開始在庫、売上は変更しません。\n" +
      (initial.excluded.length ? "照合できない " + initial.excluded.length + " 件は登録しません。" : "");
    if (!window.confirm(message)) {
      showMessage("SKU登録はキャンセルしました。");
      return;
    }
    const current = await readPlan(sessionId, missingIds);
    const expected = initial.rows.map(r => r.variantId).sort().join("|");
    const actual = current.rows.map(r => r.variantId).sort().join("|");
    if (selectedSessionId() !== sessionId || expected !== actual) {
      throw new Error("確認中に在庫または商品登録が変わりました。再度確認してください。");
    }
    let completed = 0;
    for (const row of current.rows) {
      if (selectedSessionId() !== sessionId) {
        throw new Error("イベントが切り替わりました。処理を中断しました。");
      }
      showMessage((completed + 1) + " / " + current.rows.length + " SKUを登録中");
      await registerTshirtVariant(row);
      completed += 1;
    }
    showMessage(completed + " SKUを登録しました。QuickからSKUに戻して表示を更新してください。" +
      (current.excluded.length ? " 要確認 " + current.excluded.length + " SKU。" : ""));
  } catch (error) {
    showMessage("登録できませんでした。商品情報を再読込して確認してください。" +
      " 詳細: " + (error?.message || String(error)), true);
  } finally {
    busy = false;
    if (button.isConnected) {
      button.disabled = false;
      button.textContent = "未登録TシャツSKUを確認・登録";
    }
  }
}

function renderRepairControl() {
  if (busy || document.getElementById(BUTTON_ID)) return;
  const search = document.querySelector("#posSkuSearch");
  if (!search || !selectedSessionId()) return;
  const missingVisible = Array.from(document.querySelectorAll(".posSkuItem"))
    .some(button => button.textContent.includes("SKU未登録"));
  if (!missingVisible) return;
  const wrapper = document.createElement("div");
  wrapper.id = "posRegisterCarriedTshirtControl";
  wrapper.style.cssText = "margin-bottom:12px;padding:10px;border:1px solid #d9dce2;border-radius:12px;background:#f7f7f4;";
  const button = document.createElement("button");
  button.type = "button";
  button.id = BUTTON_ID;
  button.className = "button button-secondary";
  button.style.cssText = "width:100%;min-height:46px;";
  button.textContent = "未登録TシャツSKUを確認・登録";
  const status = document.createElement("div");
  status.id = "posRegisterCarriedTshirtStatus";
  status.style.cssText = "margin-top:8px;font-size:12px;line-height:1.5;";
  status.textContent = "イベント持参在庫と商品マスターを照合します。数量は変更しません。";
  button.addEventListener("click", registerMissingSku);
  wrapper.append(button, status);
  search.before(wrapper);
}

renderRepairControl();
new MutationObserver(renderRepairControl).observe(document.body, { childList: true, subtree: true });
