const HUB_URL = "./expense-management.html";
const REVIEW_URL = "./gmail-expense-review.html";
const SESSION_KEY = "icelolly-expense-management-session";

function expenseButton(label, href) {
  const link = document.createElement("a");
  link.href = href;
  link.className = "button button-secondary";
  link.textContent = label;
  link.style.display = "inline-flex";
  link.style.alignItems = "center";
  link.style.textDecoration = "none";
  return link;
}

function enhanceMore() {
  const title = [...document.querySelectorAll("h1.page-title")]
    .find(item => item.textContent.trim() === "More");
  if (!title || document.querySelector("#expenseManagementCard")) return;
  const card = document.createElement("section");
  card.id = "expenseManagementCard";
  card.className = "card";
  const heading = document.createElement("div");
  heading.className = "card-title";
  heading.textContent = "経費管理";
  const note = document.createElement("div");
  note.className = "muted";
  note.textContent = "Gmail経費候補の取得、確認、イベントへの登録、Gmail接続をまとめて管理します。";
  note.style.marginBottom = "12px";
  note.style.lineHeight = "1.55";
  card.append(heading, note, expenseButton("経費管理を開く", HUB_URL));
  const pageNote = title.nextElementSibling;
  (pageNote?.parentElement || title.parentElement)?.insertBefore(card, pageNote?.nextSibling || title.nextSibling);
}

function sessionContext(button) {
  const id = button?.dataset?.sessionId || "";
  if (!id) return null;
  const row = button.parentElement?.parentElement?.parentElement;
  const match = String(row?.textContent || "").match(/(20\d{2})[\/-](\d{1,2})/);
  const month = match ? `${match[1]}-${String(match[2]).padStart(2, "0")}` : "";
  return { id, month };
}

function storeSessionContext(button) {
  const context = sessionContext(button);
  if (!context) return;
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(context));
}

function loadSessionContext() {
  try {
    const value = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
    return value?.id ? value : null;
  } catch {
    return null;
  }
}

function enhanceSessionDetail() {
  const detail = document.querySelector("#sessionSalesDetail");
  if (!detail || detail.querySelector("#eventExpenseManagementLink")) return;
  const context = loadSessionContext();
  if (!context) return;
  const heading = [...detail.querySelectorAll(".card-title")]
    .find(item => item.textContent.trim() === "Gmailから登録した経費明細");
  if (!heading) return;
  const params = new URLSearchParams({ eventId: context.id });
  if (context.month) params.set("month", context.month);
  const link = expenseButton("このイベントの経費を管理", `${REVIEW_URL}?${params}`);
  link.id = "eventExpenseManagementLink";
  link.style.margin = "4px 0 10px";
  heading.insertAdjacentElement("afterend", link);
}

document.addEventListener("click", event => {
  const button = event.target.closest(".sessionDetailButton[data-session-id]");
  if (button) storeSessionContext(button);
});

function enhance() {
  enhanceMore();
  enhanceSessionDetail();
}

enhance();
new MutationObserver(enhance).observe(document.body, { childList: true, subtree: true });
