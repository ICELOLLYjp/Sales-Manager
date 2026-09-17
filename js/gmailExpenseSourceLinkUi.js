import { getApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js";

const BUTTON_CLASS = "gmailExpenseSourceLinkButton";
const pendingButtons = new WeakSet();

function enhance() {
  const detail = document.querySelector("#sessionSalesDetail");
  if (!detail) return;
  for (const voidButton of detail.querySelectorAll(".voidGmailExpenseEntryButton[data-candidate-id]")) {
    const row = voidButton.parentElement;
    if (!row || row.querySelector(`.${BUTTON_CLASS}`)) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `button button-secondary ${BUTTON_CLASS}`;
    button.textContent = "Gmailで元メールを検索";
    button.style.cssText = "display:block;width:100%;min-height:44px;margin:8px 0 6px;";
    button.addEventListener("click", async () => {
      if (pendingButtons.has(button)) return;
      const candidateId = voidButton.dataset.candidateId;
      if (!/^[a-f0-9]{64}$/.test(candidateId || "")) {
        window.alert("経費明細のIDが正しくありません。");
        return;
      }
      // Open a tab synchronously so browsers do not block it after the async request.
      const tab = window.open("about:blank", "_blank");
      if (tab) {
        tab.opener = null;
        tab.document.title = "Gmailを確認しています";
        tab.document.body.textContent = "元メールを検索しています…";
      }
      pendingButtons.add(button);
      button.disabled = true;
      button.textContent = "元メールを確認中…";
      try {
        const fn = httpsCallable(getFunctions(getApp(), "asia-southeast1"), "gmailExpenseSourceUrl");
        const { data } = await fn({ candidateId });
        const url = new URL(data?.url || "");
        if (url.origin !== "https://mail.google.com" || !url.pathname.startsWith("/mail/u/")) {
          throw new Error("Gmailのリンクを確認できませんでした。");
        }
        if (tab && !tab.closed) {
          tab.location.replace(url.href);
        } else {
          const anchor = document.createElement("a");
          anchor.href = url.href;
          anchor.target = "_blank";
          anchor.rel = "noopener noreferrer";
          anchor.textContent = "Gmailの検索結果を開く";
          anchor.style.cssText = "display:inline-block;padding:8px 0;";
          button.insertAdjacentElement("afterend", anchor);
        }
      } catch (error) {
        if (tab && !tab.closed) tab.close();
        window.alert(`元メールを検索できませんでした。${error?.message || error}`);
      } finally {
        pendingButtons.delete(button);
        button.disabled = false;
        button.textContent = "Gmailで元メールを検索";
      }
    });
    voidButton.before(button);
  }
}

enhance();
new MutationObserver(enhance).observe(document.querySelector("#view") || document.body, {
  childList: true,
  subtree: true
});
