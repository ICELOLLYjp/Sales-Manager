import {
  saveEventQuickAllocations,
  finalizeEventSession
} from "./services/eventCloseServiceCompat.js?v=20260915-outside-opening-1";
import {
  loadUnidentifiedQuickSummary,
  syncUnidentifiedQuickState,
  provisionallyCloseWithUnidentified
} from "./services/unidentifiedQuickService.js?v=20260915-unidentified-quick-1";

const QUICK_UNRESOLVED_LABEL = "Quickのまま仮終了";
const SEARCH_RESULT_LIMIT = 10;
const INVENTORY_SESSION_KEY = "icelolly-sales-inventory-session";
const CATEGORY_LABELS = {
  tshirt: "Tシャツ",
  pierce: "ピアス",
  earring: "イヤリング",
  drop_pierce: "ドロップピアス",
  drop_earring: "ドロップイヤリング"
};

function normalizeSearchText(value) {
  return String(value || "").normalize("NFKC").toLocaleLowerCase("ja").trim();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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

function quickDetailsElement() {
  return Array.from(document.querySelectorAll("details"))
    .find(details => details.querySelector(".quickAllocationSelect")) || null;
}

function updateSectionHelp() {
  const details = quickDetailsElement();
  if (!details) return;

  const summary = details.querySelector(":scope > summary");
  if (summary && details.dataset.quickAllocationSectionReady !== "1") {
    summary.textContent = "SKUを個別に指定（必要な場合のみ）";
    details.open = false;
    details.dataset.quickAllocationSectionReady = "1";
  }

  const note = Array.from(details.children).find(element => element.classList?.contains("muted"));
  if (note && note.dataset.quickAllocationHelpReady !== "1") {
    note.textContent = "分かる販売だけSKUへ割り当てます。分からない販売は未特定のまま残して仮終了できます。";
    note.dataset.quickAllocationHelpReady = "1";
  }
}

function countStatusLabel(value) {
  if (value === "confirmed") return "確定";
  if (value === "draft") return "途中保存";
  return "未使用";
}

async function renderUnidentifiedSummaryPanel() {
  const details = quickDetailsElement();
  const sessionId = currentInventorySessionId();
  if (!details || !sessionId) return;
  if (details.dataset.unidentifiedQuickLoaded === sessionId) return;

  details.dataset.unidentifiedQuickLoaded = sessionId;

  try {
    const summary = await loadUnidentifiedQuickSummary({ sessionId });
    if (currentInventorySessionId() !== sessionId || !details.isConnected) return;

    document.querySelector("#unidentifiedQuickSummaryPanel")?.remove();

    const panel = document.createElement("section");
    panel.id = "unidentifiedQuickSummaryPanel";
    panel.style.marginTop = "12px";
    panel.style.padding = "12px";
    panel.style.border = summary.unresolvedTotal > 0
      ? "1px solid #e3c976"
      : "1px solid #b9d8c3";
    panel.style.borderRadius = "14px";
    panel.style.background = summary.unresolvedTotal > 0
      ? "#fffaf0"
      : "#f4fbf6";

    const groupsHtml = summary.groups.length
      ? summary.groups.map(group => {
          const category = CATEGORY_LABELS[group.category] || group.category;
          const price = Number(group.unitPrice || 0) > 0
            ? ` / ${escapeHtml(group.unitPrice)} ${escapeHtml(summary.currency)}`
            : "";
          const body = group.tshirtBodyKey
            ? ` / ${escapeHtml(group.tshirtBodyKey)}`
            : "";
          return `
            <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;padding:9px 0;border-top:1px solid rgba(0,0,0,.07);">
              <div style="font-size:13px;font-weight:700;line-height:1.35;">${escapeHtml(category)}${body}${price}</div>
              <div style="font-size:18px;font-weight:900;white-space:nowrap;">${escapeHtml(group.quantity)} 点</div>
            </div>
          `;
        }).join("")
      : `<div style="margin-top:8px;font-size:13px;font-weight:700;">未特定販売はありません。</div>`;

    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
        <div>
          <div style="font-size:12px;font-weight:800;color:#75601a;">未特定販売</div>
          <div style="font-size:12px;line-height:1.5;margin-top:3px;color:#666;">SKUを無理に決めず、カテゴリ・販売単価ごとに残します。</div>
        </div>
        <div style="font-size:24px;font-weight:900;white-space:nowrap;">${escapeHtml(summary.unresolvedTotal)} 点</div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin-top:10px;">
        <div style="padding:8px;border-radius:9px;background:rgba(255,255,255,.72);"><strong style="display:block;font-size:17px;">${escapeHtml(summary.quickTotal)}</strong><span style="font-size:10px;color:#777;">Quick合計</span></div>
        <div style="padding:8px;border-radius:9px;background:rgba(255,255,255,.72);"><strong style="display:block;font-size:17px;">${escapeHtml(summary.manualAllocatedTotal)}</strong><span style="font-size:10px;color:#777;">手動特定</span></div>
        <div style="padding:8px;border-radius:9px;background:rgba(255,255,255,.72);"><strong style="display:block;font-size:17px;">${escapeHtml(summary.autoResolvedTotal)}</strong><span style="font-size:10px;color:#777;">棚卸で自動特定</span></div>
      </div>
      <div style="margin-top:9px;font-size:11px;line-height:1.5;color:#777;">
        Tシャツ棚卸: ${escapeHtml(countStatusLabel(summary.tshirtCountStatus))} / アクセサリー棚卸: ${escapeHtml(countStatusLabel(summary.accessoryCountStatus))}
        ${summary.closingComplete ? " / 終了在庫入力済み" : " / 終了在庫に未入力あり"}
      </div>
      <div style="margin-top:8px;font-size:12px;line-height:1.5;font-weight:700;">
        ${summary.unresolvedTotal > 0
          ? "このまま未特定として仮終了できます。分かるものだけ下の個別指定を使ってください。"
          : "Quick販売は棚卸差または手動指定で説明できます。"}
      </div>
      <div style="margin-top:9px;">${groupsHtml}</div>
    `;

    details.insertAdjacentElement("beforebegin", panel);

    const summaryElement = details.querySelector(":scope > summary");
    if (summaryElement) {
      summaryElement.textContent = `SKUを個別に指定（必要な場合のみ） ${summary.manualAllocatedTotal} / ${summary.quickTotal} 点`;
    }
  } catch (error) {
    details.dataset.unidentifiedQuickLoaded = "";
    console.warn("未特定販売の集計を読み込めませんでした。", error);
  }
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
    const unidentified = await syncUnidentifiedQuickState({
      sessionId,
      savedByEmail: ""
    });
    const extra = result.outsideOpeningCount > 0
      ? ` 開始在庫外 ${result.outsideOpeningCount} 点を追加候補として記録しました。`
      : "";
    window.alert(`Quick配分を ${result.savedCount} / ${result.totalCount} 点保存しました。未特定 ${unidentified.unresolvedTotal} 点です。${extra}`);
    reopenInventorySession(sessionId);
  } catch (error) {
    window.alert(error?.message || String(error));
    button.disabled = false;
    button.textContent = originalText;
  }

  return true;
}

async function handleCustomProvisionalClose(button) {
  const sessionId = currentInventorySessionId();
  if (!sessionId) return false;

  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "仮終了中";

  try {
    const result = await provisionallyCloseWithUnidentified({
      sessionId,
      closedByEmail: ""
    });
    const groupCount = Array.isArray(result?.unidentifiedGroups)
      ? result.unidentifiedGroups.length
      : 0;
    window.alert(
      `イベントを仮終了しました。未特定販売 ${result.quickUnresolvedTotal ?? 0} 点を ${groupCount} グループで保存しました。POS販売は停止済みです。`
    );
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

  const provisionalButton = event.target.closest?.("#provisionallyCloseEventSessionButton");
  if (provisionalButton && currentInventorySessionId()) {
    event.preventDefault();
    event.stopImmediatePropagation();
    void handleCustomProvisionalClose(provisionalButton);
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
  void renderUnidentifiedSummaryPanel();
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
