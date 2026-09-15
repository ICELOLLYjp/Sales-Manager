const STAGE_ID = "eventCloseStageIndicator";

function text(value) {
  return String(value ?? "").trim();
}

function ensureStageIndicator(hub) {
  let indicator = document.querySelector(`#${STAGE_ID}`);
  if (indicator) return indicator;

  indicator = document.createElement("div");
  indicator.id = STAGE_ID;
  indicator.style.marginTop = "10px";
  indicator.style.padding = "9px 11px";
  indicator.style.borderRadius = "11px";
  indicator.style.background = "#f4f4f1";
  indicator.style.fontSize = "12px";
  indicator.style.fontWeight = "900";
  indicator.style.lineHeight = "1.4";

  const title = hub.querySelector(".ech-title");
  if (title) title.insertAdjacentElement("afterend", indicator);
  else hub.insertAdjacentElement("afterbegin", indicator);

  return indicator;
}

function applyStageUi() {
  const hub = document.querySelector("#eventCloseHub");
  const action = document.querySelector("#eventCloseHubAction");
  const next = document.querySelector("#eventCloseHubNext");
  if (!hub || !action) return;

  const indicator = ensureStageIndicator(hub);
  const raw = text(action.textContent);

  if (raw === "棚卸せずに仮終了") {
    indicator.textContent = "現在：棚卸待ち";
    action.textContent = "棚卸はあとで";
    if (next) next.textContent = "今は棚卸せず、POSだけ停止して後で続けます。在庫は変更しません。";
    return;
  }

  if (raw.includes("オンラインで仮終了")) {
    indicator.textContent = "現在：棚卸待ち";
    action.textContent = "棚卸はあとで（オンライン接続が必要）";
    return;
  }

  if (raw.includes("未同期会計") && raw.includes("先に同期")) {
    indicator.textContent = "現在：棚卸待ち";
    return;
  }

  if (raw === "仮終了済み・棚卸待ち") {
    indicator.textContent = "現在：POS停止済み・棚卸待ち";
    action.textContent = "棚卸をしてください";
    if (next) next.textContent = "POSは停止済みです。Tシャツ／アクセサリー棚卸を終えると次へ進めます。";
    return;
  }

  if (raw.includes("未特定") && raw.includes("仮終了")) {
    const match = raw.match(/未特定\s*(\d+)\s*点/);
    const count = match ? match[1] : "";
    indicator.textContent = "現在：棚卸済み・未特定あり";
    action.textContent = count
      ? `未特定 ${count} 点のままPOSを停止`
      : "未特定のままPOSを停止";
    if (next) next.textContent = "棚卸は完了しています。分からないSKUは未特定のまま残し、POSだけ停止します。";
    return;
  }

  if (raw.includes("未特定") && raw.includes("正式終了")) {
    const match = raw.match(/未特定\s*(\d+)\s*点/);
    const count = match ? match[1] : "";
    indicator.textContent = "現在：棚卸済み・POS停止済み・未特定あり";
    action.textContent = count
      ? `未特定 ${count} 点を残してイベント終了`
      : "未特定を残してイベント終了";
    if (next) next.textContent = "未特定分はSKUを推測せず記録し、イベントを正式終了します。";
    return;
  }

  if (raw === "イベントを終了して在庫を確定") {
    indicator.textContent = "現在：棚卸済み・終了準備完了";
    if (next && !text(next.textContent)) {
      next.textContent = "確認済みの販売と在庫調整を反映してイベントを終了します。";
    }
    return;
  }

  if (raw === "イベント終了済み") {
    indicator.textContent = "現在：終了済み";
    return;
  }

  if (raw.includes("先に棚卸")) {
    indicator.textContent = "現在：棚卸待ち";
    return;
  }

  if (raw.includes("状態を確認")) {
    indicator.textContent = "現在：状態確認中";
    return;
  }
}

let scheduled = false;
function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    applyStageUi();
  });
}

schedule();
new MutationObserver(schedule).observe(document.body, {
  childList: true,
  subtree: true,
  characterData: true
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) schedule();
});
