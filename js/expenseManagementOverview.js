import { initFirebase, getFirebaseState } from "./firebase.js";
import { initAuth, loginWithGoogle } from "./auth.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js";
import { summarizeExpenseCandidates } from "./expenseOverviewModel.js";

const month = document.querySelector("#overviewMonth");
const load = document.querySelector("#overviewLoad");
const login = document.querySelector("#overviewLogin");
const staff = document.querySelector("#overviewStaff");
const notice = document.querySelector("#overviewNotice");
const summary = document.querySelector("#overviewSummary");
const reviewLink = document.querySelector("#overviewReviewLink");
const now = new Date();
month.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
let functions = null;
let signedIn = false;
let busy = false;
let requestVersion = 0;

function validMonth(value) {
  return /^20\d{2}-(0[1-9]|1[0-2])$/.test(value) && Number(value.slice(0, 4)) >= 2025 && Number(value.slice(0, 4)) <= 2030;
}

function update() {
  load.disabled = busy || !signedIn;
  month.disabled = busy;
  login.disabled = busy;
  reviewLink.href = validMonth(month.value)
    ? `./gmail-expense-review.html?month=${encodeURIComponent(month.value)}`
    : "./gmail-expense-review.html";
}

function setNotice(text, error = false) {
  notice.textContent = text;
  if (error) notice.setAttribute("role", "alert");
  else notice.removeAttribute("role");
}

function clearSummary() {
  summary.replaceChildren();
  summary.textContent = "まだ取得していません。";
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
    total.textContent = `${selected}に取得した保存済み候補 ${counts.total}件を集計しました。Gmailへの再検索や経費登録は行っていません。`;
    summary.append(total);
    if (counts.truncated) {
      const warning = document.createElement("p");
      warning.className = "overview-warning";
      warning.style.gridColumn = "1 / -1";
      warning.textContent = `表示上限の${counts.maxResults}件に達しています。全件数ではない可能性があります。`;
      summary.append(warning);
    }
    setNotice("件数を更新しました。詳細の確認は保存済み候補の画面から行えます。");
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

month.addEventListener("change", () => {
  ++requestVersion;
  clearSummary();
  setNotice("対象月を変更しました。件数を確認してください。");
  update();
});
load.addEventListener("click", loadOverview);
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
    signedIn = Boolean(user);
    busy = false;
    staff.textContent = user ? `ログイン中: ${user.email}` : "Sales Managerへのログインが必要です。";
    login.hidden = signedIn;
    if (!signedIn) clearSummary();
    if (error) setNotice(error.message || String(error), true);
    else setNotice(signedIn ? "対象月を選んで件数を確認できます。" : "ログイン後に保存済み候補を確認できます。");
    update();
  });
} catch (error) {
  setNotice(error?.message || String(error), true);
}
