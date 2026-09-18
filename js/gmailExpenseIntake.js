import { initFirebase, getFirebaseState } from "./firebase.js";
import { initAuth, loginWithGoogle } from "./auth.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js";
import { GMAIL_INTAKE_ACCOUNTS, intakeKey, groupIntakeSelection, planIntakeAssignments } from "./gmailExpenseIntakeModel.js";
import { createInlineExpenseReview } from "./gmailExpenseInlineReview.js";

const $ = selector => document.querySelector(selector);
const staff = $("#staff"), login = $("#login"), eventSelect = $("#eventSelect");
const month = $("#month"), keyword = $("#keyword"), accountsBox = $("#accounts");
const accountNotice = $("#accountNotice"), notice = $("#notice"), fetchBoth = $("#fetchBoth");
const summary = $("#resultSummary"), results = $("#results"), selectAll = $("#selectAll");
const clearSelection = $("#clearSelection"), saveArea = $("#saveArea"), saveSelected = $("#saveSelected");
const reviewLink = $("#reviewLink");
const params = new URLSearchParams(window.location.search);
const requestedEvent = params.get("eventId") || "";
const validMonth = value => /^20\d{2}-(0[1-9]|1[0-2])$/.test(value) && Number(value.slice(0, 4)) >= 2025 && Number(value.slice(0, 4)) <= 2030;
const today = new Date();
const defaultMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
month.value = validMonth(params.get("month")) ? params.get("month") : defaultMonth;
let functions = null, signedIn = false, busy = false, version = 0, sessions = [];
let connected = new Map(), previews = [], selected = new Set(), fetchInfo = new Map();

function showMessage(element, value, error = false) {
  element.textContent = value;
  if (error) element.setAttribute("role", "alert");
  else element.removeAttribute("role");
}
function reviewHref(scoped = true) {
  const query = new URLSearchParams({ month: month.value });
  if (scoped && eventSelect.value) query.set("eventId", eventSelect.value);
  return `./gmail-expense-review.html?${query}`;
}
function update() {
  login.disabled = busy;
  eventSelect.disabled = busy || !signedIn || !sessions.length;
  month.disabled = busy;
  keyword.disabled = busy;
  fetchBoth.disabled = busy || !signedIn || !eventSelect.value || !validMonth(month.value) || ![...connected.values()].some(Boolean);
  selectAll.disabled = busy || !previews.length;
  clearSelection.disabled = busy || !selected.size;
  saveSelected.disabled = busy || !selected.size || !eventSelect.value;
  saveSelected.textContent = `選んだ${selected.size}件を保存してイベントに割り当てる`;
  reviewLink.href = reviewHref();
  for (const checkbox of results.querySelectorAll('input[type="checkbox"]')) checkbox.disabled = busy;
}
async function callable(name, data = {}) {
  if (!signedIn || !functions) throw new Error("Sales Managerにログインしてください。");
  return (await httpsCallable(functions, name)(data)).data;
}
const inlineReview = createInlineExpenseReview({
  call: callable,
  getContext: () => ({ eventId: signedIn ? eventSelect.value : "", month: month.value }),
  setIntakeBusy: value => { busy = value; update(); }
});
function sessionName(item) {
  const location = [item.city, item.country].filter(Boolean).join(", ");
  return [item.eventName || "名称未設定", location, item.startDate].filter(Boolean).join(" ／ ");
}
function populateSessions(items) {
  sessions = (Array.isArray(items) ? items : []).filter(item => item && /^[A-Za-z0-9_-]{1,160}$/.test(item.id || ""));
  const previous = eventSelect.value;
  eventSelect.replaceChildren(new Option("イベントを選択してください", ""));
  for (const item of sessions) eventSelect.add(new Option(sessionName(item), item.id));
  const intended = sessions.some(item => item.id === previous) ? previous : requestedEvent;
  eventSelect.value = sessions.some(item => item.id === intended) ? intended : "";
  if (requestedEvent && !eventSelect.value) showMessage(notice, "指定したイベントが一覧にありません。登録先を選択してください。", true);
  update();
}
function renderAccounts() {
  accountsBox.replaceChildren();
  for (const account of GMAIL_INTAKE_ACCOUNTS) {
    const item = document.createElement("div"); item.className = "account";
    const name = document.createElement("strong"); name.textContent = account;
    const status = document.createElement("span");
    status.textContent = connected.get(account) === true ? "接続済み" : connected.has(account) ? "未接続" : "確認中";
    item.append(name, status); accountsBox.append(item);
  }
}
function clearPreviews() {
  previews = []; selected = new Set(); fetchInfo = new Map();
  results.replaceChildren(); summary.textContent = "まだ検索していません。"; saveArea.hidden = true;
  update();
}
function renderResults() {
  results.replaceChildren();
  for (const item of previews) {
    const card = document.createElement("label"); card.className = "message";
    const checkbox = document.createElement("input"); checkbox.type = "checkbox";
    checkbox.checked = selected.has(intakeKey(item));
    const text = document.createElement("span"); text.className = "text";
    const title = document.createElement("strong"); title.textContent = item.subject || "（件名なし）";
    const meta = document.createElement("small"); meta.textContent = `${item.date || "日付不明"} ／ ${item.sender || "差出人不明"} ／ ${item.account}`;
    text.append(title, meta); card.append(checkbox, text);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) selected.add(intakeKey(item));
      else selected.delete(intakeKey(item));
      update();
    });
    results.append(card);
  }
  const partial = [...fetchInfo.values()].some(item => item.hasMore);
  summary.textContent = `検索結果 ${previews.length}件。各アカウント最大25件${partial ? "。続きがあるため、この月の全メールではありません。" : "。"}`;
  saveArea.hidden = !previews.length;
  update();
}
async function initialize() {
  if (!signedIn || busy) return;
  const active = ++version;
  busy = true; update(); showMessage(notice, "イベントとGmailの接続を確認しています…");
  try {
    const [status, listing] = await Promise.all([
      callable("gmailOAuthStatus"), callable("gmailExpenseCandidateList", { month: month.value })
    ]);
    if (active !== version || !signedIn) return;
    connected = new Map((status.accounts || []).map(row => [row.account, row.connected === true]));
    populateSessions(listing.sessions);
    renderAccounts();
    showMessage(accountNotice, "未接続のアカウントは検索できません。必要ならGmail接続画面で確認してください。", false);
    if (!requestedEvent || eventSelect.value) showMessage(notice, "イベントを選び、2つのGmailをまとめて検索できます。");
  } catch (error) {
    showMessage(notice, `初期化できませんでした: ${error?.message || error}`, true);
  } finally {
    if (active === version) {
      busy = false; update();
      if (signedIn && eventSelect.value) inlineReview.load();
    }
  }
}
async function fetchBothAccounts() {
  if (busy || !signedIn || !eventSelect.value || !validMonth(month.value)) return;
  const active = ++version;
  busy = true; clearPreviews(); update(); showMessage(notice, "接続済みのGmailを検索しています。まだ候補には保存していません…");
  const activeAccounts = GMAIL_INTAKE_ACCOUNTS.filter(account => connected.get(account) === true);
  const searchKeyword = keyword.value.replace(/\s+/g, " ").trim();
  const chosenMonth = month.value;
  try {
    const settled = await Promise.allSettled(activeAccounts.map(account => callable("gmailExpensePreview", { account, month: chosenMonth, keyword: searchKeyword })));
    if (active !== version || !signedIn) return;
    const failures = [];
    settled.forEach((outcome, index) => {
      const account = activeAccounts[index];
      if (outcome.status === "rejected") { failures.push(`${account}: ${outcome.reason?.message || "取得に失敗"}`); return; }
      const response = outcome.value;
      if (!Array.isArray(response?.messages)) { failures.push(`${account}: 応答が不正です`); return; }
      fetchInfo.set(account, { hasMore: response.hasMore === true, skipped: Number(response.skipped || 0) });
      previews.push(...response.messages.filter(item => item.account === account && /^[A-Za-z0-9_-]+$/.test(item.messageId || "")));
    });
    renderResults();
    const missing = GMAIL_INTAKE_ACCOUNTS.filter(account => connected.get(account) !== true);
    const notes = [missing.length ? `未接続: ${missing.join("、")}` : "", ...failures];
    showMessage(notice, failures.length ? `取得できたメールだけ表示しています。${notes.filter(Boolean).join("\n")}` :
      `取得した${previews.length}件を確認し、経費に関係するメールを選択してください。${notes.filter(Boolean).join("\n")}`, failures.length > 0);
  } catch (error) {
    showMessage(notice, `検索できませんでした: ${error?.message || error}`, true);
  } finally {
    if (active === version) { busy = false; update(); }
  }
}
async function saveAndAssign() {
  if (busy || !signedIn || !eventSelect.value || !selected.size) return;
  const eventId = eventSelect.value, chosenMonth = month.value;
  const selectedMessages = previews.filter(item => selected.has(intakeKey(item)));
  const grouped = groupIntakeSelection(selectedMessages, selected);
  if (!grouped.length) return;
  busy = true; update(); showMessage(notice, "選択した候補を保存しています。売上や経費台帳は変更しません…");
  const successfullySaved = [], failures = [];
  try {
    for (const group of grouped) {
      try {
        const response = await callable("gmailExpenseSaveCandidates", { account: group.account, month: chosenMonth, messages: group.messages });
        if (Number(response.saved) !== group.messages.length) throw new Error("保存件数が一致しません。確認してください。");
        successfullySaved.push(...group.messages);
      } catch (error) { failures.push(`${group.account}: ${error?.message || "保存失敗"}`); }
    }
    if (!successfullySaved.length) {
      showMessage(notice, `保存できませんでした。${failures.join("\n")}`, true); return;
    }
    let listing;
    try { listing = await callable("gmailExpenseCandidateList", { month: chosenMonth }); }
    catch (error) {
      reviewLink.href = reviewHref(false);
      showMessage(notice, `候補は保存されましたが、一覧の再取得に失敗したためイベント割り当ては行っていません。保存済み候補を確認してください。${error?.message || error}`, true);
      saveArea.hidden = false; return;
    }
    const plan = planIntakeAssignments(successfullySaved, listing.candidates, eventId);
    let assigned = 0;
    for (const item of plan.assign) {
      try {
        await callable("gmailExpenseCandidateAssignEvent", { candidateId: item.id, expenseScope: "event", eventId });
        assigned++;
      } catch (error) { failures.push(`${item.subject || "候補"}: イベント割り当て失敗 ${error?.message || error}`); }
    }
    const unresolved = plan.conflicts.length + plan.missing.length;
    const notes = [
      `${successfullySaved.length}件を候補に保存。新規割り当て${assigned}件、割り当て済み${plan.alreadyAssigned.length}件。`,
      plan.conflicts.length ? `別イベント・一般経費・除外などの${plan.conflicts.length}件は変更していません。` : "",
      plan.missing.length ? `一覧の表示上限などで確認できない${plan.missing.length}件は割り当てずに保留しました。` : "",
      ...failures
    ].filter(Boolean);
    const complete = failures.length === 0 && unresolved === 0 && assigned === plan.assign.length;
    showMessage(notice, notes.join("\n") + (complete ? "\nこの画面の下部で本文と金額を確認できます。" : "\n未処理の候補は従来の確認画面でも確認できます。"), !complete);
    if (assigned + plan.alreadyAssigned.length > 0) {
      busy = false; update();
      await inlineReview.load();
      if (complete) $("#inlineReview").scrollIntoView({ behavior: "smooth", block: "start" });
    }
    if (!complete) { reviewLink.href = reviewHref(false); saveArea.hidden = false; }
  } finally { busy = false; update(); }
}

fetchBoth.addEventListener("click", fetchBothAccounts);
selectAll.addEventListener("click", () => { selected = new Set(previews.map(intakeKey)); renderResults(); });
clearSelection.addEventListener("click", () => { selected.clear(); renderResults(); });
month.addEventListener("change", () => {
  ++version; clearPreviews(); inlineReview.reset();
  showMessage(notice, "月を変更しました。候補を読み込み直してください。");
  if (signedIn && eventSelect.value) inlineReview.load();
});
keyword.addEventListener("change", () => {
  ++version; clearPreviews(); showMessage(notice, "検索語句が変わりました。もう一度検索してください。");
});
eventSelect.addEventListener("change", () => {
  inlineReview.reset();
  showMessage(notice, "取り込み先イベントを確認してください。候補の保存だけでは経費台帳へ登録しません。"); update();
  if (signedIn && eventSelect.value) inlineReview.load();
});
login.addEventListener("click", async () => {
  try { await loginWithGoogle(); }
  catch (error) { showMessage(notice, `ログインできませんでした: ${error?.message || error}`, true); }
});
renderAccounts(); update();
try {
  await initFirebase();
  const { app, enabled } = getFirebaseState();
  if (!enabled || !app) throw new Error("Firebaseを初期化できませんでした。");
  functions = getFunctions(app, "asia-southeast1");
  await initAuth((user, error) => {
    signedIn = Boolean(user); ++version;
    staff.textContent = user ? `ログイン中: ${user.email}` : "Sales Managerへのログインが必要です。";
    login.hidden = signedIn;
    if (!signedIn) { connected.clear(); sessions = []; clearPreviews(); renderAccounts(); inlineReview.reset(); }
    if (error) showMessage(notice, error.message || String(error), true);
    update();
    if (signedIn) initialize();
  });
} catch (error) { showMessage(notice, error?.message || String(error), true); }
