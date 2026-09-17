import { initFirebase, getFirebaseState } from "./firebase.js";
import { initAuth, loginWithGoogle } from "./auth.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js";
import { MAX_BULK_CANDIDATES, candidatesForFilter, duplicateCandidateIds, planBulkAction } from "./gmailExpenseBulkModel.js";

const $ = id => document.getElementById(id);
const month = $("month"), load = $("load"), login = $("login"), staff = $("staff");
const notice = $("notice"), summary = $("summary"), results = $("results");
const statusFilter = $("statusFilter"), accountFilter = $("accountFilter"), duplicateFilter = $("duplicateFilter");
const targetEvent = $("targetEvent"), keep = $("keep"), exclude = $("exclude"), assign = $("assign");
const selectionSummary = $("selectionSummary"), selectVisible = $("selectVisible"), clearSelection = $("clearSelection");
const detailLink = $("detailLink");
const now = new Date();
const params = new URLSearchParams(location.search);
const requestedMonth = params.get("month");
month.value = /^20\d{2}-(0[1-9]|1[0-2])$/.test(requestedMonth || "")
  ? requestedMonth : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
let signedIn = false, busy = false, functions = null, state = null, requestVersion = 0;
const selected = new Set();

function say(text, error = false) {
  notice.textContent = text;
  if (error) notice.setAttribute("role", "alert");
  else notice.removeAttribute("role");
}
function validMonth(value) {
  return /^20\d{2}-(0[1-9]|1[0-2])$/.test(value) && Number(value.slice(0, 4)) >= 2025 && Number(value.slice(0, 4)) <= 2030;
}
function update() {
  const active = signedIn && !busy && Boolean(state);
  login.disabled = busy;
  load.disabled = !signedIn || busy;
  month.disabled = busy;
  for (const control of [statusFilter, accountFilter, duplicateFilter, targetEvent]) control.disabled = !active;
  selectVisible.disabled = !active;
  clearSelection.disabled = !active || !selected.size;
  for (const box of results.querySelectorAll('input[type="checkbox"]')) box.disabled = !active;
  selectionSummary.textContent = `${selected.size}件を選択中（1回につき最大${MAX_BULK_CANDIDATES}件）`;
  let validKeep = false, validAssign = false;
  if (active && selected.size) {
    try { planBulkAction(state, [...selected], "kept"); validKeep = true; } catch (_) {}
    try { planBulkAction(state, [...selected], "assign", targetEvent.value); validAssign = true; } catch (_) {}
  }
  keep.disabled = exclude.disabled = !validKeep;
  assign.disabled = !validAssign;
  detailLink.href = validMonth(month.value) ? `./gmail-expense-review.html?month=${encodeURIComponent(month.value)}` : "./gmail-expense-review.html";
}
async function call(name, data) {
  if (!signedIn || !functions) throw new Error("Sales Managerにログインしてください。");
  return (await httpsCallable(functions, name)(data)).data;
}
function populate() {
  const account = accountFilter.value;
  accountFilter.replaceChildren(new Option("すべて", "all"));
  for (const value of new Set((state?.candidates || []).map(item => item.account).filter(Boolean))) {
    accountFilter.add(new Option(value, value));
  }
  accountFilter.value = [...accountFilter.options].some(item => item.value === account) ? account : "all";
  const event = targetEvent.value;
  targetEvent.replaceChildren(new Option("イベントを選択してください", ""));
  for (const session of state?.sessions || []) {
    if (!session?.id) continue;
    const name = [session.eventName, session.startDate, session.city].filter(Boolean).join(" ／ ");
    targetEvent.add(new Option(name || session.id, session.id));
  }
  targetEvent.value = [...targetEvent.options].some(item => item.value === event) ? event : "";
}
function render() {
  results.replaceChildren();
  if (!state) { summary.textContent = "まだ取得していません。"; update(); return; }
  const rows = candidatesForFilter(state, { status: statusFilter.value, account: accountFilter.value, duplicates: duplicateFilter.value });
  const duplicates = duplicateCandidateIds(state);
  summary.textContent = `保存済み${state.candidates.length}件 ／ 表示${rows.length}件 ／ 重複の可能性${duplicates.size}件${state.truncated ? " ／ 取得上限に達したため一部のみ表示しています" : ""}`;
  if (!rows.length) results.textContent = "表示条件に一致する候補はありません。";
  for (const item of rows) {
    const article = document.createElement("article"); article.className = "item";
    const box = document.createElement("input"); box.type = "checkbox"; box.value = item.id;
    box.setAttribute("aria-label", `${item.subject || "件名なし"} を選択`);
    box.checked = selected.has(item.id);
    box.disabled = busy || item.expensePosted || item.reviewStatus === "excluded";
    const body = document.createElement("div");
    const title = document.createElement("strong"); title.textContent = item.subject || "（件名なし）";
    const meta = document.createElement("p"); meta.className = "muted";
    meta.textContent = `${item.date || "日付不明"} ／ ${item.sender || "差出人不明"} ／ ${item.account || ""}`;
    body.append(title, meta);
    const status = document.createElement("span"); status.className = "tag";
    status.textContent = item.expensePosted ? "経費登録済み" : item.reviewStatus === "kept" ? "候補に残す" : item.reviewStatus === "excluded" ? "除外" : "未確認";
    body.append(status);
    if (item.eventId) {
      const event = document.createElement("span"); event.className = "tag"; event.textContent = item.eventName || "イベント指定あり"; body.append(event);
    }
    if (duplicates.has(item.id)) {
      const duplicate = document.createElement("span"); duplicate.className = "tag warning";
      duplicate.textContent = "重複の可能性あり。元メールを個別に確認"; body.append(duplicate);
    }
    if (item.expensePosted) {
      const hint = document.createElement("p"); hint.className = "muted"; hint.textContent = "登録済みのため一括変更できません。"; body.append(hint);
    }
    article.append(box, body); results.append(article);
  }
  update();
}
async function refresh({ clear = false } = {}) {
  if (busy || !signedIn) return;
  if (!validMonth(month.value)) { say("2025年から2030年の対象月を指定してください。", true); return; }
  const request = ++requestVersion;
  busy = true; update(); say("保存済みの候補を読み込んでいます…");
  try {
    const data = await call("gmailExpenseCandidateList", { month: month.value });
    if (request !== requestVersion || !signedIn) return;
    if (!Array.isArray(data?.candidates) || !Array.isArray(data?.sessions)) throw new Error("取得結果を確認できませんでした。");
    state = data;
    if (clear) selected.clear();
    for (const id of [...selected]) {
      const item = state.candidates.find(row => row.id === id);
      if (!item || item.expensePosted || item.reviewStatus === "excluded") selected.delete(id);
    }
    populate(); render(); say("候補を表示しました。表示だけでは経費台帳を変更しません。");
  } catch (error) { say(`候補を取得できませんでした: ${error?.message || error}`, true); }
  finally { if (request === requestVersion) { busy = false; update(); } }
}
async function execute(action) {
  if (busy || !signedIn || !state) return;
  const eventId = targetEvent.value;
  let plan;
  try { plan = planBulkAction(state, [...selected], action, eventId); }
  catch (error) { say(error.message, true); return; }
  const label = action === "kept" ? "候補に残す" : action === "excluded" ? "除外" : "イベントへの割り当て";
  const destination = state.sessions.find(session => session.id === eventId)?.eventName || "";
  const lines = [
    `${plan.rows.length}件の候補に「${label}」を実行します。`,
    action === "assign" ? `割り当て先: ${destination}` : "対象は未確認の候補のみです。",
    plan.duplicateCount ? `重複の可能性がある候補: ${plan.duplicateCount}件。自動除外はしません。` : "",
    "", ...plan.rows.map(row => `・${row.subject || "件名なし"}`), "",
    "経費台帳への登録、金額変更、在庫変更は行いません。続けますか？"
  ];
  if (!window.confirm(lines.filter(line => line !== null).join("\n"))) return;
  busy = true; update();
  let done = 0, failure = null;
  const intendedMonth = state.month;
  try {
    // Re-read immediately before writing so stale selections are not silently applied.
    const current = await call("gmailExpenseCandidateList", { month: intendedMonth });
    const refreshed = planBulkAction(current, plan.rows.map(row => row.id), action, eventId);
    for (let i = 0; i < refreshed.rows.length; i++) {
      if (!signedIn) { failure = "ログイン状態が変更されました。"; break; }
      const item = refreshed.rows[i];
      say(`${i + 1}/${refreshed.rows.length}件を処理しています…`);
      try {
        if (action === "assign") {
          await call("gmailExpenseCandidateAssignEvent", { candidateId: item.id, expenseScope: "event", eventId });
        } else {
          await call("gmailExpenseCandidateReview", { candidateId: item.id, status: action });
        }
        done++; selected.delete(item.id);
      } catch (error) { failure = error?.message || String(error); break; }
    }
  } catch (error) { failure = error?.message || String(error); }
  busy = false;
  // Reload authoritative data after partial success. Never report an all-or-nothing transaction.
  const resultMessage = failure
    ? `${done}件の処理が完了しました。途中で停止しました: ${failure}。未処理の候補を確認してください。`
    : `${done}件の「${label}」を保存しました。経費台帳には登録していません。`;
  await refresh();
  say(resultMessage, Boolean(failure));
}
results.addEventListener("change", event => {
  const box = event.target.closest('input[type="checkbox"]');
  if (!box || !state || busy) return;
  if (box.checked) {
    if (selected.size >= MAX_BULK_CANDIDATES) { box.checked = false; say(`一度に選べるのは最大${MAX_BULK_CANDIDATES}件です。`, true); return; }
    selected.add(box.value);
  } else selected.delete(box.value);
  update();
});
for (const filter of [statusFilter, accountFilter, duplicateFilter]) filter.addEventListener("change", render);
month.addEventListener("change", () => {
  ++requestVersion; state = null; selected.clear(); render(); say("月を変更しました。候補を読み込み直してください。");
});
targetEvent.addEventListener("change", update);
selectVisible.addEventListener("click", () => {
  for (const row of candidatesForFilter(state, { status: statusFilter.value, account: accountFilter.value, duplicates: duplicateFilter.value })) {
    if (selected.size >= MAX_BULK_CANDIDATES) break;
    if (!row.expensePosted && row.reviewStatus !== "excluded") selected.add(row.id);
  }
  render();
  if (selected.size >= MAX_BULK_CANDIDATES) say(`最大${MAX_BULK_CANDIDATES}件を選びました。対象を確認してください。`);
});
clearSelection.addEventListener("click", () => { selected.clear(); render(); });
keep.addEventListener("click", () => execute("kept"));
exclude.addEventListener("click", () => execute("excluded"));
assign.addEventListener("click", () => execute("assign"));
load.addEventListener("click", () => refresh({ clear: true }));
login.addEventListener("click", async () => { try { await loginWithGoogle(); } catch (error) { say(`ログインできませんでした: ${error?.message || error}`, true); } });
update();
try {
  await initFirebase();
  const { app, enabled } = getFirebaseState();
  if (!enabled || !app) throw new Error("Firebaseを初期化できませんでした。");
  functions = getFunctions(app, "asia-southeast1");
  await initAuth((user, error) => {
    const previous = signedIn;
    signedIn = Boolean(user);
    staff.textContent = user ? `ログイン中: ${user.email}` : "Sales Managerへのログインが必要です。";
    login.hidden = signedIn;
    if (!signedIn || (!previous && signedIn)) { state = null; selected.clear(); render(); }
    if (error) say(error.message || String(error), true);
    else if (signedIn) say("対象月を選んで候補を表示してください。");
    else say("ログイン後に候補を確認できます。");
    update();
  });
} catch (error) { say(error?.message || String(error), true); }
