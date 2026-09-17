import { sessionExpenseDetailHref } from "./expenseSourceNavigationModel.js";

const sessionId = new URLSearchParams(window.location.search).get("expenseSessionId");

if (sessionExpenseDetailHref(sessionId)) {
  const view = document.querySelector("#view");
  const nav = document.querySelector('.nav-btn[data-route="sessions"]');
  const status = document.querySelector("#syncStatus");
  let finished = false;
  let observer;
  let timeout;

  function finish() {
    finished = true;
    observer?.disconnect();
    window.clearTimeout(timeout);
  }

  function openDetail() {
    if (finished || !view || !nav) return;
    if (!["Firebase", "Local", "Offline"].includes(status?.textContent?.trim())) return;
    if (!nav.classList.contains("active")) {
      nav.click();
      return;
    }

    const button = [...view.querySelectorAll(".sessionDetailButton[data-session-id]")]
      .find(item => item.dataset.sessionId === sessionId);
    if (!button) return;

    const archive = button.closest("details");
    if (archive) archive.open = true;
    finish();
    button.click();
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete("expenseSessionId");
    window.history.replaceState(window.history.state, "", `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
    window.setTimeout(() => view.querySelector("#sessionSalesDetail")?.scrollIntoView({ block: "start" }), 300);
  }

  observer = new MutationObserver(openDetail);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class"] });
  timeout = window.setTimeout(() => {
    if (finished) return;
    finish();
    if (nav?.classList.contains("active")) {
      const notice = document.createElement("p");
      notice.className = "warning";
      notice.textContent = "指定された売上詳細を開けませんでした。Sessionsから対象イベントを確認してください。";
      view?.prepend(notice);
    }
  }, 30000);
  openDetail();
}
