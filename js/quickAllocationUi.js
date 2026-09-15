import {
  saveEventQuickAllocations,
  finalizeEventSession
} from "./services/eventCloseServiceCompat.js?v=20260915-outside-opening-1";

const QUICK_UNRESOLVED_LABEL = "Quickのまま仮終了";
const SEARCH_RESULT_LIMIT = 10;
const INVENTORY_SESSION_KEY = "icelolly-sales-inventory-session";

function normalizeSearchText(value) {
  return String(value || "").normalize("NFKC").toLocaleLowerCase("ja").trim();
}

function optionText(option) {
  return String(option?.textContent || "")
    .replace(/^\s*候補：\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function optionSnapshot(option) {
  return {
    value: String(option.value || ""),
    text: optionText(option),
    candidate: String(option.textContent || "").includes("候補："),
    selected: Boolean(option.selected)
  };
}

function currentInventorySessionId() {
  return String(localStorage.getItem(INVENTORY_SESSION_KEY) || "").trim();
}

function reopenInventorySession(sessionId) {
  const escaped = window.CSS?.escape
    ? CSS.escape(sessionId)
    : sessionId.replace(/"/g, "\\\"");
  const button = document.querySelector(
    `.sessionInventoryCountButton[data-session-id="${escaped}"]`
  );
  if (button) button.click();
}

function updateFinalizeAvailability() {
  const selects = Array.from(document.querySelectorAll(".quickAllocationSelect"));
  if (!selects.length) return;

  const allAssigned = selects.every(select => Boolean(String(select.value || "").trim()));
  const button = document.querySelector("#finalizeEventSessionButton");
  if (!button || !allAssigned || !button.disabled) return;

  button.disabled = false;
  button.style.opacity = "";
  button.dataset.quickCompatEnabled = "1";

  if (!document.querySelector("#quickCompatFinalizeNote")) {
    const note = document.createElement("div");
    note.id = "quickCompatFinalizeNote";
    note.className = "muted";
    note.style.marginTop = "8px";
    note.style.fontSize = "12px";
    note.style.lineHeight = "1.5";
    note.textContent = "QuickをすべてSKUへ割り当てた場合、開始在庫外の商品はイベント途中追加として記録して正式確定できます。ほかの差異が残っている場合は確定時に止まります。";
    button.insertAdjacentElement("afterend", note);
  }
}

function createSearchPanel(select, allOptions) {
  const wrapper = document.createElement("div");
  wrapper.style.display = "grid";
  wrapper.style.gap = "7px";
  wrapper.style.marginTop = "2px";

  const searchButton = document.createElement("button");
  searchButton.type = "button";
  searchButton.className = "button button-secondary";
  searchButton.textContent = "候補以外のSKUを検索";
  searchButton.style.minHeight = "40px";
  searchButton.style.width = "100%";
  searchButton.style.fontSize = "13px";

  const panel = document.createElement("div");
  panel.hidden = true;
  panel.style.display = "grid";
  panel.style.gap = "7px";
  panel.style.padding = "9px";
  panel.style.border = "1px solid #deded9";
  panel.style.borderRadius = "10px";
  panel.style.background = "#f8f8f5";

  const input = document.createElement("input");
  input.type = "search";
  input.placeholder = "商品名、SKU、色、サイズで検索";
  input.autocomplete = "off";
  input.style.width = "100%";
  input.style.minHeight = "44px";
  input.style.boxSizing = "border-box";
  input.style.padding = "0 12px";
  input.style.border = "1px solid #d8d8d2";
  input.style.borderRadius = "10px";
  input.style.background = "#fff";
  input.style.fontSize = "16px";

  const note = document.createElement("div");
  note.className = "muted";
  note.style.fontSize = "11px";
  note.style.lineHeight = "1.45";
  note.textContent = "検索した時だけ登録済みSKUを表示します。開始在庫に入っていなかったSKUも選べます。";

  const results = document.createElement("div");
  results.style.display = "grid";
  results.style.gap = "6px";

  function choose(item) {
    let option = Array.from(select.options).find(row => row.value === item.value);
    if (!option) {
      option = document.createElement("option");
      option.value = item.value;
      option.textContent = item.text;
      select.appendChild(option);
    }
    select.value = item.value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    panel.hidden = true;
    input.value = "";
    results.innerHTML = "";
    searchButton.textContent = "別のSKUを検索";
    updateFinalizeAvailability();
  }

  function renderResults() {
    const query = normalizeSearchText(input.value);
    results.innerHTML = "";
    if (!query) return;

    const matches = allOptions
      .filter(item => item.value)
      .filter(item => normalizeSearchText(`${item.text} ${item.value}`).includes(query))
      .slice(0, SEARCH_RESULT_LIMIT);

    if (!matches.length) {
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.style.fontSize = "12px";
      empty.textContent = "該当するSKUがありません";
      results.appendChild(empty);
      return;
    }

    matches.forEach(item => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "button button-secondary";
      button.style.width = "100%";
      button.style.minHeight = "44px";
      button.style.textAlign = "left";
      button.style.whiteSpace = "normal";
      button.style.lineHeight = "1.35";
      button.textContent = item.text;
      button.addEventListener("click", () => choose(item));
      results.appendChild(button);
    });
  }

  searchButton.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) input.focus();
  });

  input.addEventListener("input", renderResults);
  panel.appendChild(input);
  panel.appendChild(note);
  panel.appendChild(results);
  wrapper.appendChild(searchButton);
  wrapper.appendChild(panel);
  select.insertAdjacentElement("afterend", wrapper);
}

function enhanceQuickAllocationSelect(select) {
  if (!select || select.dataset.quickAllocationUiReady === "1") return;

  const allOptions = Array.from(select.options).map(optionSnapshot);
  const selectedValue = String(select.value || "");
  const candidateCount = allOptions.filter(item => item.candidate).length;

  Array.from(select.options).forEach(option => {
    const value = String(option.value || "");
    const isCandidate = String(option.textContent || "").includes("候補：");
    const keep = !value || isCandidate || value === selectedValue;
    if (!keep) {
      option.remove();
      return;
    }
    if (!value) {
      option.textContent = QUICK_UNRESOLVED_LABEL;
      return;
    }
    option.textContent = optionText(option);
  });

  if (!selectedValue) select.value = "";

  const meta = document.createElement("div");
  meta.className = "muted";
  meta.style.fontSize = "11px";
  meta.style.lineHeight = "1.4";
  meta.textContent = candidateCount
    ? `終了在庫からの候補 ${candidateCount} 件を表示しています。`
    : "自動候補はありません。Quickのまま仮終了できます。";
  select.insertAdjacentElement("afterend", meta);

  createSearchPanel(select, allOptions);
  select.addEventListener("change", updateFinalizeAvailability);
  select.dataset.quickAllocationUiReady = "1";
}

function updateSectionHelp() {
  document.querySelectorAll("details").forEach(details => {
    const summary = details.querySelector(":scope > summary");
    if (!summary || !summary.textContent.includes("Quick未解決を処理")) return;

    const note = Array.from(details.children).find(element => element.classList?.contains("muted"));
    if (note && note.dataset.quickAllocationHelpReady !== "1") {
      note.textContent = "終了在庫から絞った候補だけを表示します。候補にない商品だけ検索してください。割り当てない販売はQuickのまま残して仮終了できます。";
      note.dataset.quickAllocationHelpReady = "1";
    }
  });
}

async function handleCustomSave(button) {
  const sessionId = currentInventorySessionId();
  if (!sessionId) return false;

  const allocations = Array.from(document.querySelectorAll(".quickAllocationSelect"))
    .map(select => ({
      allocationKey: String(select.dataset.allocationKey || ""),
      variantId: String(select.value || "")
    }))
    .filter(item => item.allocationKey && item.variantId);

  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "保存中";

  try {
    const result = await saveEventQuickAllocations({
      sessionId,
      allocations,
      savedByEmail: ""
    });
    const extra = result.outsideOpeningCount > 0
      ? ` 開始在庫外 ${result.outsideOpeningCount} 点を追加候補として記録しました。`
      : "";
    window.alert(`Quick配分を ${result.savedCount} / ${result.totalCount} 点保存しました。${extra}`);
    reopenInventorySession(sessionId);
  } catch (error) {
    window.alert(error?.message || String(error));
    button.disabled = false;
    button.textContent = originalText;
  }

  return true;
}

async function handleCustomFinalize(button) {
  const sessionId = currentInventorySessionId();
  if (!sessionId) return false;

  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "在庫を確定中";

  try {
    const result = await finalizeEventSession({
      sessionId,
      closedByEmail: ""
    });
    const extra = Number(result?.eventAddedTotal || 0) > 0
      ? ` 開始在庫外からの追加 ${result.eventAddedTotal} 点もイベント追加履歴として保存しました。`
      : "";
    window.alert(`イベントを終了し、正式在庫を確定しました。${extra}`);
    reopenInventorySession(sessionId);
  } catch (error) {
    window.alert(error?.message || String(error));
    button.disabled = false;
    button.textContent = originalText;
  }

  return true;
}

function captureApplicationActions(event) {
  const sessionButton = event.target.closest?.(".sessionInventoryCountButton");
  if (sessionButton?.dataset?.sessionId) {
    localStorage.setItem(INVENTORY_SESSION_KEY, sessionButton.dataset.sessionId);
    return;
  }

  if (event.target.closest?.("#closeInventoryCountButton")) {
    localStorage.removeItem(INVENTORY_SESSION_KEY);
    return;
  }

  const saveButton = event.target.closest?.("#saveQuickAllocationsButton");
  if (saveButton && currentInventorySessionId()) {
    event.preventDefault();
    event.stopImmediatePropagation();
    void handleCustomSave(saveButton);
    return;
  }

  const finalizeButton = event.target.closest?.("#finalizeEventSessionButton");
  if (finalizeButton && currentInventorySessionId()) {
    event.preventDefault();
    event.stopImmediatePropagation();
    void handleCustomFinalize(finalizeButton);
  }
}

document.addEventListener("click", captureApplicationActions, true);

let scheduled = false;

function enhanceQuickAllocationUi() {
  scheduled = false;
  updateSectionHelp();
  document.querySelectorAll(".quickAllocationSelect").forEach(enhanceQuickAllocationSelect);
  updateFinalizeAvailability();
}

function scheduleEnhance() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(enhanceQuickAllocationUi);
}

scheduleEnhance();
new MutationObserver(scheduleEnhance).observe(document.body, { childList: true, subtree: true });
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) scheduleEnhance();
});
