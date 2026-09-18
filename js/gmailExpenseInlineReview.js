// The intake screen reuses the existing authenticated callables. No ledger write occurs on load.
const CATEGORY_NAMES = {
  boothFee: "出店料", flight: "航空券", hotel: "宿泊", shipping: "発送",
  transport: "現地交通", interpreter: "通訳", advertising: "広告費", other: "その他"
};
const CURRENCIES = ["JPY", "SGD", "TWD", "HKD", "THB", "USD"];
const el = (tag, className, content) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content != null) node.textContent = content;
  return node;
};

export function createInlineExpenseReview({ call, getContext, setIntakeBusy }) {
  const section = document.getElementById("inlineReview");
  const list = document.getElementById("inlineReviewList");
  const status = document.getElementById("inlineReviewStatus");
  const reload = document.getElementById("inlineReviewLoad");
  const evidence = new Map();
  let state = null;
  let context = null;
  let busy = false;

  function say(text, error = false) {
    status.textContent = text;
    if (error) status.setAttribute("role", "alert");
    else status.removeAttribute("role");
  }
  function sameContext() {
    const live = getContext();
    return context && live.eventId === context.eventId && live.month === context.month;
  }
  function setBusy(value) {
    busy = value;
    setIntakeBusy(value);
    reload.disabled = value;
    for (const node of list.querySelectorAll("button,input,select")) node.disabled = value;
  }
  function reset() {
    if (busy) return;
    state = null; context = null; evidence.clear(); section.hidden = true;
    list.replaceChildren(); say("");
  }
  async function load() {
    if (busy) return;
    const chosen = getContext();
    if (!chosen.eventId || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(chosen.month)) {
      say("イベントと対象月を選んでください。", true); return;
    }
    section.hidden = false;
    context = chosen;
    setBusy(true);
    say("このイベントの保存済み候補を確認しています…");
    try {
      const result = await call("gmailExpenseCandidateList", { month: chosen.month });
      if (!sameContext()) { say("条件が変わりました。もう一度読み込んでください。", true); return; }
      if (!Array.isArray(result?.candidates) || !Array.isArray(result?.sessions)) throw new Error("候補一覧を取得できませんでした。");
      state = result;
      render();
      say(result.truncated ? "候補一覧が100件の上限に達しています。表示されていない候補は登録しないでください。" : "元メールを確認し、1件ずつ登録できます。");
    } catch (error) { say(`候補を表示できませんでした: ${error?.message || error}`, true); }
    finally { setBusy(false); }
  }
  function candidate(id) { return state?.candidates.find(item => item.id === id); }
  function event() { return state?.sessions.find(item => item.id === context?.eventId); }
  function formField(form, name, label, control) {
    const wrapper = el("label", "inline-field", label);
    control.dataset.field = name;
    wrapper.append(control); form.append(wrapper);
    return control;
  }
  function optionSelect(options, value) {
    const select = document.createElement("select");
    for (const [code, label] of options) select.add(new Option(label, code));
    select.value = value ?? "";
    return select;
  }
  function renderEvidence(article, item) {
    const data = evidence.get(item.id);
    if (!data) return;
    const panel = el("div", "inline-evidence");
    panel.append(el("p", "inline-hint", "本文とPDFから確認した金額を入力してください。候補の数字を自動確定しません。"));
    if (data.excerpt) {
      const details = el("details", "inline-proof");
      details.append(el("summary", "", "メール本文を表示"), el("pre", "", data.excerpt));
      panel.append(details);
    }
    if (Array.isArray(data.moneyHints) && data.moneyHints.length) {
      panel.append(el("p", "inline-hint", `本文の金額候補: ${data.moneyHints.join(" ／ ")}`));
    }
    for (const pdf of data.pdfResults || []) {
      const details = el("details", "inline-proof");
      details.append(el("summary", "", `${pdf.filename || "PDF"} ／ ${pdf.status || "未解析"}`));
      if (pdf.excerpt) details.append(el("pre", "", pdf.excerpt));
      if (pdf.moneyHints?.length) details.append(el("p", "", `金額候補: ${pdf.moneyHints.join(" ／ ")}`));
      panel.append(details);
    }
    for (const attachment of data.attachments || []) {
      if (!(data.pdfResults || []).some(pdf => pdf.filename === attachment.filename)) {
        panel.append(el("p", "inline-hint", `添付: ${attachment.filename || "ファイル名なし"}（${attachment.mimeType || "形式不明"}）`));
      }
    }
    const draft = item.evidenceReview || {};
    const form = el("div", "inline-review-form");
    const amount = document.createElement("input"); amount.type = "number"; amount.min = "0"; amount.step = "0.01"; amount.inputMode = "decimal"; amount.value = draft.amount ?? "";
    formField(form, "amount", "確認した金額", amount);
    formField(form, "currency", "通貨", optionSelect([["", "選択してください"], ...CURRENCIES.map(code => [code, code])], draft.currency || ""));
    formField(form, "category", "経費分類", optionSelect(Object.entries(CATEGORY_NAMES), draft.category || "other"));
    formField(form, "paymentStatus", "支払証拠", optionSelect([
      ["unverified", "未確認"], ["invoiced", "請求書のみ（未払い）"], ["paid_evidence", "支払済みの証拠を確認した"]
    ], draft.paymentStatus || "unverified"));
    const description = document.createElement("input"); description.type = "text"; description.maxLength = 500; description.value = draft.description || item.subject || "";
    formField(form, "description", "内容", description).parentElement.classList.add("full");
    const save = el("button", "secondary", "下書き保存"); save.type = "button"; save.dataset.action = "draft"; save.dataset.id = item.id;
    const post = el("button", "post", "内容を確認して経費登録"); post.type = "button"; post.dataset.action = "post"; post.dataset.id = item.id;
    const actions = el("div", "inline-actions"); actions.append(save, post); form.append(actions);
    panel.append(form); article.append(panel);
  }
  function render() {
    list.replaceChildren();
    if (!state || !context) return;
    const rows = state.candidates.filter(item => item.expenseScope === "event" && item.eventId === context.eventId);
    if (!rows.length) { list.append(el("p", "inline-hint", "この月の保存済み候補はありません。")); return; }
    const duplicateIds = new Set((state.duplicateGroups || []).flat());
    for (const item of rows) {
      const article = el("article", "inline-item"); article.dataset.id = item.id;
      article.append(el("strong", "", item.subject || "（件名なし）"));
      article.append(el("p", "inline-hint", `${item.date || "日付不明"} ／ ${item.account} ／ ${item.sender || "差出人不明"}`));
      if (duplicateIds.has(item.id)) article.append(el("p", "inline-warning", "重複の可能性があります。同じ請求書やカード通知を別の経費として登録しないでください。"));
      if (item.expensePosted) {
        article.append(el("p", "inline-done", `登録済み: ${item.expensePost?.amount ?? ""} ${item.expensePost?.currency || ""}`));
      } else if (item.reviewStatus === "excluded") {
        article.append(el("p", "inline-hint", "除外済みの候補です。確認画面で状態を変更してください。"));
      } else {
        const button = el("button", "secondary", item.reviewStatus === "kept" ? "本文・PDFを確認する" : "経費候補として残して本文・PDFを確認");
        button.type = "button"; button.dataset.action = "inspect"; button.dataset.id = item.id;
        article.append(button);
        renderEvidence(article, item);
      }
      list.append(article);
    }
    for (const button of list.querySelectorAll("button")) button.disabled = busy;
  }
  async function inspect(id) {
    const item = candidate(id);
    if (!item || item.expensePosted || item.reviewStatus === "excluded") return;
    setBusy(true); say("本文とPDFを確認しています。まだ経費登録は行いません…");
    try {
      if (item.reviewStatus !== "kept") await call("gmailExpenseCandidateReview", { candidateId: id, status: "kept" });
      if (!sameContext()) throw new Error("イベントまたは月が変更されました。読み込み直してください。");
      const data = await call("gmailExpenseInspectEvidence", { candidateId: id });
      if (!sameContext()) throw new Error("イベントまたは月が変更されました。読み込み直してください。");
      evidence.set(id, data);
      item.reviewStatus = "kept";
      render(); say("本文と証拠を確認し、金額と支払状態を入力してください。");
    } catch (error) { say(`本文を確認できませんでした: ${error?.message || error}`, true); await refreshAfterFailure(); }
    finally { setBusy(false); }
  }
  async function refreshAfterFailure() {
    if (!sameContext()) return;
    try { state = await call("gmailExpenseCandidateList", { month: context.month }); render(); }
    catch { say("状態を確認できません。画面を再読み込みしてください。", true); }
  }
  async function save(id, article, posting) {
    if (!sameContext()) { say("イベントまたは月が変わりました。候補を読み込み直してください。", true); return; }
    const item = candidate(id);
    if (!item || item.expensePosted || item.reviewStatus !== "kept" || !evidence.has(id)) return;
    const value = name => article.querySelector(`[data-field="${name}"]`)?.value ?? "";
    const review = { amount: value("amount"), currency: value("currency"), category: value("category"),
      paymentStatus: value("paymentStatus"), description: value("description") };
    if (posting && (review.paymentStatus !== "paid_evidence" || !(Number(review.amount) > 0) || !review.currency)) {
      say("経費登録には確認した金額、通貨、支払済みの証拠が必要です。未払いの場合は下書き保存してください。", true); return;
    }
    setBusy(true); say(posting ? "下書きを保存して、登録前の金額を確認しています…" : "下書きを保存しています…");
    try {
      await call("gmailExpenseSaveEvidenceReview", { candidateId: id, review });
      // Always re-read the authoritative totals and candidate status before posting.
      state = await call("gmailExpenseCandidateList", { month: context.month });
      if (!sameContext()) throw new Error("イベントまたは月が変更されました。候補を読み込み直してください。");
      const current = candidate(id);
      const session = event();
      if (!posting) { render(); say("下書きを保存しました。経費台帳は変更していません。"); return; }
      if (!current || !session || state.expensePostingAvailable !== true || current.expensePosted ||
          current.reviewStatus !== "kept" || current.eventId !== context.eventId ||
          current.evidenceReview?.paymentStatus !== "paid_evidence") {
        throw new Error("登録条件が変わりました。候補の状態を確認してください。");
      }
      const draft = current.evidenceReview;
      const rawCurrent = session.expenses?.[draft.category];
      const previous = typeof rawCurrent === "object" ? Number(rawCurrent.amount || 0) : Number(rawCurrent || 0);
      if (!Number.isFinite(previous) || previous < 0) throw new Error("現在の経費合計を確認できません。");
      const duplicates = (state.duplicateGroups || []).find(group => group.includes(id)) || [];
      if (duplicates.length > 1 && !window.confirm("重複候補があります。同じ支出が登録されていないことを元メールで確認しましたか？")) {
        render(); say("登録を中止しました。下書きは保存されています。"); return;
      }
      const total = previous + Number(draft.amount);
      const text = ["この1件だけを経費台帳へ登録します。", "", `イベント: ${session.eventName}`,
        `分類: ${CATEGORY_NAMES[draft.category] || draft.category}`,
        `今回: ${Number(draft.amount).toLocaleString("ja-JP")} ${draft.currency}`,
        `現在: ${previous.toLocaleString("ja-JP")} ${rawCurrent?.currency || session.currency || "JPY"}`,
        `登録後の同分類合計: ${total.toLocaleString("ja-JP")} ${draft.currency}`, "",
        "元メール、金額、支払証拠、重複を確認しましたか？"];
      if (!window.confirm(text.join("\n"))) { render(); say("登録を中止しました。下書きは保存されています。"); return; }
      const posted = await call("gmailExpensePostReviewedCandidate", {
        candidateId: id, confirmation: "post_reviewed_expense", expectedCurrentAmount: previous
      });
      state = await call("gmailExpenseCandidateList", { month: context.month });
      render();
      say(posted.duplicate ? "この候補はすでに登録されています。二重計上していません。" :
        `${Number(draft.amount).toLocaleString("ja-JP")} ${draft.currency} を経費台帳に登録しました。`);
    } catch (error) {
      await refreshAfterFailure();
      say(`処理を完了できませんでした: ${error?.message || error}。下書きや経費登録が済んでいる可能性があるため、一覧を確認してください。`, true);
    } finally { setBusy(false); }
  }
  list.addEventListener("click", evt => {
    const button = evt.target.closest("button[data-action][data-id]");
    if (!button || busy) return;
    const article = button.closest(".inline-item");
    if (button.dataset.action === "inspect") inspect(button.dataset.id);
    else save(button.dataset.id, article, button.dataset.action === "post");
  });
  reload.addEventListener("click", load);
  return { load, reset };
}
