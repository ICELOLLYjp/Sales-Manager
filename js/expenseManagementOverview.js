import { initFirebase, getFirebaseState } from "./firebase.js";
import { initAuth, loginWithGoogle } from "./auth.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js";
import { summarizeExpenseCandidates } from "./expenseOverviewModel.js";
import { summarizeEventExpenseEntries } from "./expenseEventOverviewModel.js";

const month = document.querySelector("#overviewMonth");
const load = document.querySelector("#overviewLoad");
const login = document.querySelector("#overviewLogin");
const staff = document.querySelector("#overviewStaff");
const notice = document.querySelector("#overviewNotice");
const summary = document.querySelector("#overviewSummary");
const reviewLink = document.querySelector("#overviewReviewLink");
const eventSelect = document.querySelector("#eventOverviewSelect");
const eventLoad = document.querySelector("#eventOverviewLoad");
const eventNotice = document.querySelector("#eventNotice");
const eventSummary = document.querySelector("#eventSummary");
const now = new Date();
month.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
let functions = null;
let signedIn = false;
let busy = false;
let requestVersion = 0;
let eventRequestVersion = 0;
let sessions = [];

function validMonth(value) {
  return /^20\d{2}-(0[1-9]|1[0-2])$/.test(value) && Number(value.slice(0, 4)) >= 2025 && Number(value.slice(0, 4)) <= 2030;
}

function update() {
  load.disabled = busy || !signedIn;
  month.disabled = busy;
  login.disabled = busy;
  eventSelect.disabled = busy || !signedIn || !sessions.length;
  eventLoad.disabled = busy || !signedIn || !sessions.some(item => item.id === eventSelect.value);
  reviewLink.href = validMonth(month.value)
    ? `./gmail-expense-review.html?month=${encodeURIComponent(month.value)}`
    : "./gmail-expense-review.html";
}

function setNotice(text, error = false) {
  notice.textContent = text;
  if (error) notice.setAttribute("role", "alert");
  else notice.removeAttribute("role");
}

function setEventNotice(text, error = false) {
  eventNotice.textContent = text;
  if (error) eventNotice.setAttribute("role", "alert");
  else eventNotice.removeAttribute("role");
}

function clearSummary() {
  summary.replaceChildren();
  summary.textContent = "まだ取得していません。";
}

function clearEventSummary() {
  eventSummary.replaceChildren();
  eventSummary.textContent = "まだ取得していません。";
}

function stat(label, count) {
  const item = document.createElement("div");
  item.className = "overview-stat";
  const number = document.createElement("strong");
  number.textContent = String(count);
  const caption = document.createElement("span");
  caption.textContent = label;
  item.append(number, caption);
  return item;
}

function eventLabel(item) {
  const place = [item.city, item.country].filter(Boolean).join(", ");
  const date = [item.startDate, item.endDate && item.endDate !== item.startDate ? item.endDate : ""].filter(Boolean).join("〜");
  return [item.eventName || "名称未設定", place, date].filter(Boolean).join(" ／ ");
}

function populateEvents(rows) {
  if (!Array.isArray(rows)) {
    throw new Error("イベント一覧の応答を確認できませんでした。");
  }
  const previouslySelected = eventSelect.value;
  sessions = rows.filter(item => item && typeof item.id === "string" && item.id);
  eventSelect.replaceChildren(new Option("イベントを選択してください", ""));
  for (const item of sessions) eventSelect.add(new Option(eventLabel(item), item.id));
  eventSelect.value = sessions.some(item => item.id === previouslySelected) ? previouslySelected : "";
  if (!eventSelect.value) {
    ++eventRequestVersion;
    clearEventSummary();
  }
  setEventNotice(sessions.length
    ? "イベントを選んで経費を確認してください。上の月を変えても、イベントの登録済み経費は絞り込まれません。"
    : "登録済みイベントが見つかりませんでした。");
  if (sessions.length >= 200) {
    setEventNotice("イベント一覧の表示上限に達しています。対象イベントが見つからない場合はSessionsから確認してください。");
  }
  update();
}

async function loadOverview() {
  if (busy || !signedIn) return;
  const selected = month.value;
  if (!validMonth(selected)) {
    setNotice("2025年から2030年の対象月を選んでください。", true);
    return;
  }
  const active = ++requestVersion;
  busy = true;
  update();
  setNotice("保存済み候補の件数を確認しています…");
  try {
    const response = await httpsCallable(functions, "gmailExpenseCandidateList")({ month: selected });
    if (active !== requestVersion || !signedIn) return;
    const counts = summarizeExpenseCandidates(response.data);
    summary.replaceChildren(
      stat("未確認", counts.unreviewed),
      stat("候補に残す", counts.kept),
      stat("経費登録済み", counts.posted),
      stat("除外", counts.excluded)
    );
    const total = document.createElement("p");
    total.className = "muted";
    total.style.gridColumn = "1 / -1";
    total.textContent = `${selected}を検索対象として保存した候補 ${counts.total}件です。イベント開催月や経費登録月別の集計ではありません。`;
    summary.append(total);
    if (counts.truncated) {
      const warning = document.createElement("p");
      warning.className = "overview-warning";
      warning.style.gridColumn = "1 / -1";
      warning.textContent = `表示上限の${counts.maxResults}件に達しています。全件数ではない可能性があります。`;
      summary.append(warning);
    }
    populateEvents(response.data.sessions);
    setNotice("件数を更新しました。保存済み候補の確認画面でも詳細を見られます。");
  } catch (error) {
    if (active !== requestVersion) return;
    clearSummary();
    setNotice(`件数を取得できませんでした: ${error?.message || error}`, true);
  } finally {
    if (active === requestVersion) {
      busy = false;
      update();
    }
  }
}

const categoryLabels = { boothFee: "出店料", flight: "航空券", hotel: "宿泊", shipping: "発送", transport: "現地交通", interpreter: "通訳", other: "その他" };
function formatMoney(amount, currency) {
  return `${Number(amount).toLocaleString("ja-JP", { maximumFractionDigits: 2 })} ${currency}`;
}

async function loadEventExpenses() {
  if (busy || !signedIn) return;
  const sessionId = eventSelect.value;
  if (!sessions.some(item => item.id === sessionId)) {
    setEventNotice("イベントを選択してください。", true);
    return;
  }
  const active = ++eventRequestVersion;
  busy = true;
  update();
  clearEventSummary();
  setEventNotice("選択したイベントの登録済みGmail経費を確認しています…");
  try {
    const response = await httpsCallable(functions, "gmailExpenseListEventEntries")({ sessionId });
    if (active !== eventRequestVersion || !signedIn || eventSelect.value !== sessionId) return;
    const result = summarizeEventExpenseEntries(response.data, sessionId);
    const total = document.createElement("p");
    const sumText = result.totals.map(item => formatMoney(item.amount, item.currency)).join(" ／ ");
    total.textContent = `登録済みGmail経費 ${result.count}件${sumText ? ` ／ ${sumText}` : ""}`;
    eventSummary.replaceChildren(total);
    if (!result.count) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "このイベントに登録されたGmail経費はありません。手入力した経費はSessionsの売上詳細で確認してください。";
      eventSummary.append(empty);
    }
    for (const entry of result.entries) {
      const row = document.createElement("div");
      row.className = "expense-row";
      const title = document.createElement("strong");
      title.textContent = entry.description || entry.subject || "内容未設定";
      const detail = document.createElement("div");
      detail.textContent = `${entry.date || "日付不明"} ／ ${categoryLabels[entry.category] || "その他"} ／ ${formatMoney(entry.amount, entry.currency)}`;
      row.append(title, detail);
      eventSummary.append(row);
    }
    setEventNotice("表示したのは登録済みGmail経費のみです。金額や登録内容は変更していません。");
  } catch (error) {
    if (active !== eventRequestVersion) return;
    clearEventSummary();
    setEventNotice(`イベント経費を確認できませんでした: ${error?.message || error}`, true);
  } finally {
    if (active === eventRequestVersion) {
      busy = false;
      update();
    }
  }
}

month.addEventListener("change", () => {
  ++requestVersion;
  clearSummary();
  setNotice("対象月を変更しました。候補の件数を確認してください。イベント経費の表示は月に連動しません。");
  update();
});
eventSelect.addEventListener("change", () => {
  ++eventRequestVersion;
  clearEventSummary();
  setEventNotice("イベントを選択しました。経費を確認してください。");
  update();
});
load.addEventListener("click", loadOverview);
eventLoad.addEventListener("click", loadEventExpenses);
login.addEventListener("click", async () => {
  try { await loginWithGoogle(); }
  catch (error) { setNotice(`ログインできませんでした: ${error?.message || error}`, true); }
});
update();
try {
  await initFirebase();
  const { app, enabled } = getFirebaseState();
  if (!enabled || !app) throw new Error("Firebaseを初期化できませんでした。");
  functions = getFunctions(app, "asia-southeast1");
  await initAuth((user, error) => {
    ++requestVersion;
    ++eventRequestVersion;
    signedIn = Boolean(user);
    busy = false;
    staff.textContent = user ? `ログイン中: ${user.email}` : "Sales Managerへのログインが必要です。";
    login.hidden = signedIn;
    if (!signedIn) {
      sessions = [];
      eventSelect.replaceChildren(new Option("上で候補件数を確認すると選べます", ""));
      clearSummary();
      clearEventSummary();
      setEventNotice("");
    }
    if (error) setNotice(error.message || String(error), true);
    else setNotice(signedIn ? "対象月を選んで件数を確認できます。" : "ログイン後に保存済み候補を確認できます。");
    update();
  });
} catch (error) {
  setNotice(error?.message || String(error), true);
}
