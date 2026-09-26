const STYLE_ID = "posUxEnhancementsStyles";
const HISTORY_BUTTON_ID = "posHistoryShortcut";
const BACK_BUTTON_ID = "backToPosFromHistoryButton";

const KNOWN_CATEGORY_LABELS = new Set([
  "Tシャツ",
  "ピアス",
  "イヤリング",
  "ドロップタイプピアス",
  "ドロップタイプイヤリング",
  "ステッカー",
  "ポストカード",
  "アートプリント"
]);

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .pos-ux-history-button {
      min-height:42px;
      padding:0 14px;
      border:1px solid #deded9;
      border-radius:12px;
      background:#f3f3f0;
      color:#222;
      font-weight:800;
      font-size:13px;
      white-space:nowrap;
    }

    #${BACK_BUTTON_ID} {
      min-height:38px;
      padding:0 12px;
      border:1px solid #deded9;
      border-radius:10px;
      background:#f3f3f0;
      color:#222;
      font-weight:700;
      font-size:12px;
      white-space:nowrap;
    }

    @media (max-width: 600px) {
      .pos-ux-cart-row {
        display:grid !important;
        grid-template-columns:minmax(0,1fr) auto !important;
        gap:8px 10px !important;
        align-items:center !important;
      }

      .pos-ux-cart-info {
        grid-column:1 / -1 !important;
        min-width:0 !important;
        width:100% !important;
      }

      .pos-ux-cart-info .muted {
        overflow-wrap:anywhere !important;
        word-break:break-word !important;
      }

      .pos-ux-cart-controls {
        grid-column:1 !important;
        justify-self:start !important;
        min-width:0 !important;
        flex-shrink:0 !important;
      }

      .pos-ux-cart-total {
        grid-column:2 !important;
        justify-self:end !important;
        min-width:0 !important;
        white-space:nowrap !important;
        align-self:center !important;
      }

      .pos-ux-cart-row .posQtyButton {
        flex:0 0 42px !important;
      }
    }
  `;
  document.head.appendChild(style);
}

function cardTitle(text) {
  return Array.from(document.querySelectorAll(".card-title"))
    .find(element => element.textContent?.trim() === text) || null;
}

function enhanceCartLayout() {
  const title = cardTitle("会計");
  const card = title?.closest(".card");
  if (!card) return;

  Array.from(card.querySelectorAll(".list-row"))
    .filter(row => row.querySelector(".posQtyButton"))
    .forEach(row => {
      const children = Array.from(row.children);
      if (children.length < 3) return;

      row.classList.add("pos-ux-cart-row");
      children[0].classList.add("pos-ux-cart-info");
      children[1].classList.add("pos-ux-cart-controls");
      children[2].classList.add("pos-ux-cart-total");
    });
}

function waitFor(find, timeoutMs = 3500) {
  return new Promise(resolve => {
    const started = Date.now();

    function check() {
      const result = find();
      if (result) {
        resolve(result);
        return;
      }

      if (Date.now() - started >= timeoutMs) {
        resolve(null);
        return;
      }

      setTimeout(check, 60);
    }

    check();
  });
}

function scrollToHistoryTitle(historyTitle, behavior = "auto") {
  if (!historyTitle?.isConnected) return;

  const topbar = document.querySelector(".topbar");
  const topbarHeight = Math.ceil(
    topbar?.getBoundingClientRect().height || 0
  );
  const targetTop = Math.max(
    0,
    window.scrollY + historyTitle.getBoundingClientRect().top - topbarHeight - 10
  );

  window.scrollTo({
    top: targetTop,
    behavior
  });
}

function keepHistoryTitleAligned(historyTitle) {
  const detail = document.getElementById("sessionSalesDetail");
  if (!detail || !historyTitle) return;

  let frame = 0;
  let stopped = false;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    mutationObserver.disconnect();
    resizeObserver?.disconnect();
    if (frame) cancelAnimationFrame(frame);
  };

  const align = behavior => {
    if (stopped || !historyTitle.isConnected) {
      stop();
      return;
    }

    scrollToHistoryTitle(historyTitle, behavior);

    if (document.getElementById("normalizedTshirtSalesAggregation")) {
      window.setTimeout(stop, 250);
    }
  };

  const scheduleAlign = () => {
    if (stopped || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      align("auto");
    });
  };

  const mutationObserver = new MutationObserver(scheduleAlign);
  mutationObserver.observe(detail, {
    childList: true,
    subtree: true
  });

  const resizeObserver = typeof ResizeObserver === "function"
    ? new ResizeObserver(scheduleAlign)
    : null;
  resizeObserver?.observe(detail);

  align("smooth");
  window.setTimeout(() => {
    if (!stopped) {
      align("auto");
      stop();
    }
  }, 5000);
}

async function openActiveSessionHistory() {
  const sessionId = localStorage.getItem("icelolly-sales-active-session") || "";
  if (!sessionId) {
    window.alert("販売セッションを選択してください。");
    return;
  }

  const sessionsNav = document.querySelector('.nav-btn[data-route="sessions"]');
  if (!sessionsNav) return;

  sessionsNav.click();

  const detailButton = await waitFor(() =>
    Array.from(document.querySelectorAll(".sessionDetailButton"))
      .find(button => button.dataset.sessionId === sessionId)
  );

  if (!detailButton) {
    window.alert("現在の販売セッションの売上詳細を開けませんでした。");
    return;
  }

  detailButton.click();

  const historyTitle = await waitFor(() => cardTitle("会計履歴"));
  if (!historyTitle) {
    window.alert("会計履歴の位置を開けませんでした。");
    return;
  }

  requestAnimationFrame(() => {
    keepHistoryTitleAligned(historyTitle);
  });
}

function enhancePosHistoryShortcut() {
  const posNav = document.querySelector('.nav-btn[data-route="pos"]');
  if (!posNav?.classList.contains("active")) return;
  if (document.getElementById(HISTORY_BUTTON_ID)) return;

  const view = document.querySelector("#view");
  if (!view) return;

  const bar = document.createElement("div");
  bar.id = `${HISTORY_BUTTON_ID}Bar`;
  bar.style.cssText = [
    "display:flex",
    "justify-content:flex-end",
    "align-items:center",
    "margin:0 0 10px"
  ].join(";");

  const button = document.createElement("button");
  button.id = HISTORY_BUTTON_ID;
  button.type = "button";
  button.className = "pos-ux-history-button";
  button.textContent = "会計履歴";
  button.addEventListener("click", openActiveSessionHistory);

  bar.appendChild(button);
  view.insertBefore(bar, view.firstChild);
}

function enhanceBackToPos() {
  const detail = document.getElementById("sessionSalesDetail");
  const close = document.getElementById("closeSessionDetailButton");
  if (!detail || !close || document.getElementById(BACK_BUTTON_ID)) return;

  const button = document.createElement("button");
  button.id = BACK_BUTTON_ID;
  button.type = "button";
  button.textContent = "POSへ戻る";
  button.addEventListener("click", () => {
    document.querySelector('.nav-btn[data-route="pos"]')?.click();
  });

  close.insertAdjacentElement("beforebegin", button);
}

function directLabelText(labelSpan) {
  if (!labelSpan) return "";

  return Array.from(labelSpan.childNodes)
    .filter(node => node.nodeType === Node.TEXT_NODE)
    .map(node => node.textContent || "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function fixCategorySummaryLabels() {
  const title = cardTitle("カテゴリ別");
  const section = title?.parentElement;
  if (!section) return;

  const unknownRows = Array.from(section.children)
    .filter(element => element.classList?.contains("list-row"))
    .map(row => {
      const labelSpan = row.querySelector(":scope > span");
      return {
        row,
        labelSpan,
        label: directLabelText(labelSpan)
      };
    })
    .filter(item =>
      item.label &&
      !KNOWN_CATEGORY_LABELS.has(item.label)
    );

  /*
   * Current sales categories are fixed to the known POS categories.
   * A T-shirt transaction historically stored its Design name in item.label,
   * so the T-shirt category row could appear as "SALTY" etc.
   * There should be only one such unknown row: the aggregated tshirt row.
   */
  if (unknownRows.length !== 1) return;

  const { labelSpan } = unknownRows[0];
  const textNode = Array.from(labelSpan.childNodes)
    .find(node =>
      node.nodeType === Node.TEXT_NODE &&
      String(node.textContent || "").trim()
    );

  if (textNode) {
    textNode.textContent = "\n                                  Tシャツ\n\n                                  ";
  }
}

function enhanceAll() {
  installStyles();
  enhanceCartLayout();
  enhancePosHistoryShortcut();
  enhanceBackToPos();
  fixCategorySummaryLabels();
}

let scheduled = false;

function scheduleEnhance() {
  if (scheduled) return;
  scheduled = true;

  requestAnimationFrame(() => {
    scheduled = false;
    enhanceAll();
  });
}

const view = document.querySelector("#view");

if (view) {
  new MutationObserver(scheduleEnhance).observe(view, {
    childList: true,
    subtree: true
  });
}

enhanceAll();
