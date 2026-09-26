const HISTORY_NAV_TIMEOUT_MS = 30000;

function waitForHistoryTarget(find, timeoutMs = HISTORY_NAV_TIMEOUT_MS) {
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

      window.setTimeout(check, 80);
    }

    check();
  });
}

function historyCardTitle() {
  return Array.from(document.querySelectorAll(".card-title"))
    .find(element => element.textContent?.trim() === "会計履歴") || null;
}

function scrollHistoryIntoView(historyTitle) {
  if (!historyTitle?.isConnected) return;

  const topbarHeight = Math.ceil(
    document.querySelector(".topbar")?.getBoundingClientRect().height || 0
  );

  const targetTop = Math.max(
    0,
    window.scrollY + historyTitle.getBoundingClientRect().top - topbarHeight - 10
  );

  window.scrollTo({
    top: targetTop,
    behavior: "smooth"
  });

  let remaining = 12;
  const keepAligned = () => {
    if (!historyTitle.isConnected || remaining <= 0) return;
    remaining -= 1;

    const nextTop = Math.max(
      0,
      window.scrollY + historyTitle.getBoundingClientRect().top - topbarHeight - 10
    );

    if (Math.abs(nextTop - window.scrollY) > 8) {
      window.scrollTo({
        top: nextTop,
        behavior: "auto"
      });
    }

    window.setTimeout(keepAligned, 250);
  };

  window.setTimeout(keepAligned, 250);
}

async function openHistoryReliably() {
  const sessionId = localStorage.getItem("icelolly-sales-active-session") || "";
  if (!sessionId) {
    window.alert("販売セッションを選択してください。");
    return;
  }

  document.getElementById("fastPosOverlay")?.remove();

  const sessionsNav = document.querySelector('.nav-btn[data-route="sessions"]');
  if (!sessionsNav) return;
  sessionsNav.click();

  const detailButton = await waitForHistoryTarget(() =>
    Array.from(document.querySelectorAll(".sessionDetailButton"))
      .find(button => button.dataset.sessionId === sessionId)
  );

  if (!detailButton) {
    window.alert("販売セッションの読み込みに時間がかかっています。もう一度、会計履歴を押してください。");
    return;
  }

  detailButton.click();

  const historyTitle = await waitForHistoryTarget(historyCardTitle);
  if (!historyTitle) {
    window.alert("会計履歴の読み込みに時間がかかっています。もう一度、会計履歴を押してください。");
    return;
  }

  requestAnimationFrame(() => scrollHistoryIntoView(historyTitle));
}

document.addEventListener(
  "click",
  event => {
    const target = event.target instanceof Element
      ? event.target.closest("#posHistoryShortcut, #fastPosOverlay .fp-history")
      : null;

    if (!target) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    void openHistoryReliably();
  },
  true
);
