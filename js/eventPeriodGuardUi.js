function text(value) {
  return String(value ?? "").trim();
}

function localDateKey() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function normalizeDate(value) {
  const raw = text(value).replaceAll("/", "-");
  const match = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
}

function enforceSessionPeriodLabels() {
  const title = text(document.querySelector("h1.page-title")?.textContent);
  if (title !== "Sessions") return;

  const upcoming = document.querySelector('[data-session-period="upcoming"]');
  if (upcoming) {
    upcoming.querySelectorAll(".session-status-line").forEach(line => {
      const badge = line.querySelector(".session-status-badge");
      const note = line.querySelector(".session-status-note");
      if (badge) {
        badge.className = "session-status-badge scheduled";
        badge.textContent = "開催予定";
      }
      if (note) note.textContent = "開催前";
    });
  }

  const ended = document.querySelector('[data-session-period="ended"]');
  if (ended) {
    ended.querySelectorAll(".session-status-line").forEach(line => {
      const badge = line.querySelector(".session-status-badge");
      const note = line.querySelector(".session-status-note");
      if (!badge || text(badge.textContent) !== "販売中") return;
      badge.className = "session-status-badge review";
      badge.textContent = "開催終了";
      if (note) note.textContent = "終了処理待ち";
    });
  }
}

function dashboardEventDateRange() {
  if (!document.querySelector('.nav-btn[data-route="dashboard"].active')) return null;
  const cards = Array.from(document.querySelectorAll("#view > .card"));
  if (!cards.length) return null;

  const eventCard = cards.find(card => {
    const value = text(card.textContent);
    return /\d{4}[/-]\d{2}[/-]\d{2}/.test(value) && !value.includes("経費差引き収支");
  });
  if (!eventCard) return null;

  const value = text(eventCard.textContent);
  const matches = Array.from(value.matchAll(/\d{4}[/-]\d{2}[/-]\d{2}/g)).map(match => normalizeDate(match[0]));
  if (!matches.length) return null;

  return {
    card: eventCard,
    start: matches[0],
    end: matches[1] || matches[0]
  };
}

function actionButton(label, route, primary = false) {
  return `<button type="button" data-period-guard-route="${route}" style="min-height:52px;border:${primary ? "0" : "1px solid #deded9"};border-radius:14px;background:${primary ? "#1f1f1f" : "#fff"};color:${primary ? "#fff" : "#222"};font-size:14px;font-weight:800;touch-action:manipulation;">${label}</button>`;
}

function enforceDashboardCurrentEvent() {
  const range = dashboardEventDateRange();
  if (!range) return;

  const today = localDateKey();
  if (!range.start || !range.end || (range.start <= today && today <= range.end)) return;

  const view = document.getElementById("view");
  if (!view || view.dataset.periodGuard === `${range.start}:${range.end}`) return;

  const eventName = text(range.card.querySelector("div[style*='font-size:20px']")?.textContent) || "次回イベント";
  const phase = today < range.start ? "開催予定" : "開催終了";
  const message = today < range.start
    ? `${eventName} は ${range.start.replaceAll("-", "/")} から開催予定です。`
    : `${eventName} の開催期間は終了しています。`;

  view.dataset.periodGuard = `${range.start}:${range.end}`;
  view.dataset.liveDashboard = "ready";
  view.innerHTML = `
    <h1 class="page-title">Dashboard</h1>
    <p class="page-note">イベントホーム</p>
    <section class="card">
      <div class="card-title">現在開催中のイベントはありません</div>
      <div class="muted" style="margin-top:8px;line-height:1.6;">${message}</div>
      <div style="margin-top:10px;font-size:12px;font-weight:800;">${phase}</div>
    </section>
    <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;">
      ${actionButton("Sessionsを開く", "sessions", true)}
      ${actionButton("Inventory", "inventory")}
    </div>
  `;

  view.querySelectorAll("[data-period-guard-route]").forEach(button => {
    button.addEventListener("click", () => {
      const route = button.dataset.periodGuardRoute;
      document.querySelector(`.nav-btn[data-route="${route}"]`)?.click();
    });
  });
}

let scheduled = false;
function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    enforceSessionPeriodLabels();
    enforceDashboardCurrentEvent();
  });
}

schedule();
new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) schedule();
});
