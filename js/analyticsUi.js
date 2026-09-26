import { listSalesSessions } from "./services/sessionService.js";

const ENTRY_ID = "analyticsEntryCard";

function text(value) {
  return String(value ?? "").trim();
}

function esc(value) {
  return text(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function number(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function formatJPY(value) {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0
  }).format(number(value));
}

function formatLocal(value, currency) {
  try {
    return new Intl.NumberFormat("ja-JP", {
      style: "currency",
      currency: text(currency || "JPY"),
      maximumFractionDigits: currency === "JPY" ? 0 : 2
    }).format(number(value));
  } catch {
    return `${text(currency)} ${number(value).toLocaleString("ja-JP")}`.trim();
  }
}

function sessionSalesJPY(session) {
  const netSales = number(session?.salesSummary?.netSales);
  if (text(session?.currency) === "JPY") return netSales;

  const stored = number(session?.salesSummary?.netSalesJPY);
  if (stored > 0) return stored;

  const rate = number(session?.fxRateToJPY);
  return rate > 0 ? netSales * rate : null;
}

function dayCount(session) {
  const start = text(session?.startDate);
  if (!start) return 1;
  const end = text(session?.endDate) || start;
  const startMs = new Date(`${start}T00:00:00`).getTime();
  const endMs = new Date(`${end}T00:00:00`).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 1;
  return Math.max(1, Math.floor((endMs - startMs) / 86400000) + 1);
}

function dateText(session) {
  const start = text(session?.startDate).replaceAll("-", "/");
  const end = text(session?.endDate).replaceAll("-", "/");
  if (!start) return "";
  if (!end || start === end) return start;
  return `${start} 〜 ${end}`;
}

function usableSession(session) {
  if (!session || text(session.status) === "archived") return false;
  const summary = session.salesSummary || {};
  return number(summary.netSales) !== 0 ||
    number(summary.transactionCount) > 0 ||
    number(summary.itemCount) > 0;
}

function regionKey(session) {
  const country = text(session?.country) || "国未設定";
  const city = text(session?.city) || "地域未設定";
  return `${country} / ${city}`;
}

function aggregateBy(sessions, keyFor) {
  const map = new Map();

  sessions.forEach(session => {
    const key = keyFor(session);
    const salesJPY = sessionSalesJPY(session);
    const current = map.get(key) || {
      key,
      eventCount: 0,
      salesJPY: 0,
      unknownFxCount: 0,
      itemCount: 0,
      transactionCount: 0
    };

    current.eventCount += 1;
    current.itemCount += number(session?.salesSummary?.itemCount);
    current.transactionCount += number(session?.salesSummary?.transactionCount);
    if (salesJPY === null) current.unknownFxCount += 1;
    else current.salesJPY += salesJPY;

    map.set(key, current);
  });

  return Array.from(map.values()).sort((a, b) =>
    b.salesJPY - a.salesJPY ||
    b.eventCount - a.eventCount ||
    a.key.localeCompare(b.key, "ja")
  );
}

function metric(label, value, note = "") {
  return `
    <section class="analyticsMetric">
      <div class="analyticsMetricLabel">${esc(label)}</div>
      <div class="analyticsMetricValue">${esc(value)}</div>
      ${note ? `<div class="analyticsMetricNote">${esc(note)}</div>` : ""}
    </section>
  `;
}

function aggregateRows(rows) {
  return rows.map(row => {
    const averageEvent = row.eventCount > 0 ? row.salesJPY / row.eventCount : 0;
    const averageTicket = row.transactionCount > 0 ? row.salesJPY / row.transactionCount : 0;
    const fxNote = row.unknownFxCount > 0 ? ` / 為替未設定 ${row.unknownFxCount}件` : "";
    return `
      <div class="analyticsTableRow">
        <div class="analyticsTableMain">
          <strong>${esc(row.key)}</strong>
          <span>${row.eventCount}イベント / ${row.itemCount.toLocaleString("ja-JP")}点 / ${row.transactionCount.toLocaleString("ja-JP")}会計${esc(fxNote)}</span>
        </div>
        <div class="analyticsTableNumbers">
          <strong>${esc(formatJPY(row.salesJPY))}</strong>
          <span>平均イベント ${esc(formatJPY(averageEvent))}</span>
          <span>平均客単価 ${esc(formatJPY(averageTicket))}</span>
        </div>
      </div>
    `;
  }).join("");
}

function eventRows(sessions) {
  return sessions
    .slice()
    .sort((a, b) =>
      text(b.startDate).localeCompare(text(a.startDate)) ||
      text(a.eventName).localeCompare(text(b.eventName), "ja")
    )
    .map(session => {
      const netSales = number(session?.salesSummary?.netSales);
      const itemCount = number(session?.salesSummary?.itemCount);
      const transactionCount = number(session?.salesSummary?.transactionCount);
      const salesJPY = sessionSalesJPY(session);
      const avgTicket = transactionCount > 0 ? netSales / transactionCount : 0;
      const avgDaily = dayCount(session) > 0 ? netSales / dayCount(session) : 0;
      const location = [text(session.country), text(session.city)].filter(Boolean).join(" / ") || "地域未設定";

      return `
        <div class="analyticsEventRow">
          <div class="analyticsEventHead">
            <div>
              <strong>${esc(session.eventName || "Event")}</strong>
              <span>${esc(location)} / ${esc(dateText(session))}</span>
            </div>
            <div class="analyticsEventSales">
              <strong>${esc(formatLocal(netSales, session.currency))}</strong>
              <span>${salesJPY === null ? "円換算未設定" : esc(formatJPY(salesJPY))}</span>
            </div>
          </div>
          <div class="analyticsEventStats">
            <span>販売 ${itemCount.toLocaleString("ja-JP")}点</span>
            <span>会計 ${transactionCount.toLocaleString("ja-JP")}件</span>
            <span>平均客単価 ${esc(formatLocal(avgTicket, session.currency))}</span>
            <span>1日平均 ${esc(formatLocal(avgDaily, session.currency))}</span>
          </div>
        </div>
      `;
    }).join("");
}

function installStyles() {
  if (document.getElementById("analyticsUiStyles")) return;
  const style = document.createElement("style");
  style.id = "analyticsUiStyles";
  style.textContent = `
    .analyticsEntryButton{width:100%;min-height:52px;border:0;border-radius:14px;background:#1f1f1f;color:#fff;font:800 15px/1.2 system-ui,sans-serif;touch-action:manipulation}
    .analyticsTopbar{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}
    .analyticsTopActions{display:flex;gap:7px}.analyticsTopActions button{min-height:38px;padding:0 12px;border:1px solid #deded9;border-radius:11px;background:#fff;font-weight:800;touch-action:manipulation}
    .analyticsMetrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin-top:12px}.analyticsMetric{min-width:0;padding:13px;border:1px solid #e6e6e1;border-radius:15px;background:#fff}.analyticsMetricLabel{font-size:11px;color:#777;font-weight:800}.analyticsMetricValue{margin-top:5px;font-size:22px;line-height:1.15;font-weight:900;overflow-wrap:anywhere}.analyticsMetricNote{margin-top:4px;font-size:10px;color:#888;line-height:1.4}
    .analyticsCard{margin-top:12px;padding:15px;border:1px solid #e5e5df;border-radius:18px;background:#fff}.analyticsCardTitle{font-size:16px;font-weight:900}.analyticsNote{margin-top:5px;color:#777;font-size:10px;line-height:1.55}
    .analyticsTableRow,.analyticsEventRow{padding:12px 0;border-bottom:1px solid #ecece7}.analyticsTableRow:last-child,.analyticsEventRow:last-child{border-bottom:0}.analyticsTableRow{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:start}.analyticsTableMain,.analyticsTableNumbers,.analyticsEventSales{display:grid;gap:3px}.analyticsTableMain span,.analyticsTableNumbers span,.analyticsEventHead span,.analyticsEventStats{color:#777;font-size:10px;line-height:1.4}.analyticsTableNumbers{text-align:right}.analyticsTableNumbers strong{white-space:nowrap}
    .analyticsEventHead{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:start}.analyticsEventHead>div:first-child{display:grid;gap:3px;min-width:0}.analyticsEventHead strong{overflow-wrap:anywhere}.analyticsEventSales{text-align:right}.analyticsEventSales strong{white-space:nowrap}.analyticsEventStats{display:flex;gap:8px 12px;flex-wrap:wrap;margin-top:7px}
    @media(max-width:430px){.analyticsMetricValue{font-size:19px}.analyticsTableRow{grid-template-columns:1fr}.analyticsTableNumbers{text-align:left;grid-template-columns:repeat(2,minmax(0,1fr))}.analyticsTableNumbers strong{grid-column:1/-1}.analyticsEventHead{grid-template-columns:1fr}.analyticsEventSales{text-align:left;grid-template-columns:auto auto;justify-content:start;gap:10px}}
  `;
  document.head.appendChild(style);
}

async function renderAnalytics() {
  installStyles();
  const view = document.getElementById("view");
  if (!view) return;

  view.innerHTML = `
    <div class="analyticsTopbar">
      <div><h1 class="page-title" style="margin-bottom:4px">Analytics</h1><p class="page-note" style="margin-top:0">イベント累計と地域別分析</p></div>
      <div class="analyticsTopActions"><button id="analyticsBack" type="button">戻る</button><button id="analyticsRefresh" type="button">更新</button></div>
    </div>
    <section class="analyticsCard"><div class="muted">販売実績を読み込んでいます</div></section>
  `;

  document.getElementById("analyticsBack")?.addEventListener("click", () => {
    document.querySelector('.nav-btn[data-route="more"]')?.click();
  });
  document.getElementById("analyticsRefresh")?.addEventListener("click", () => void renderAnalytics());

  try {
    const sessions = (await listSalesSessions()).filter(usableSession);
    if (text(document.querySelector("h1.page-title")?.textContent) !== "Analytics") return;

    const totalEvents = sessions.length;
    const totalItems = sessions.reduce((sum, session) => sum + number(session?.salesSummary?.itemCount), 0);
    const totalTransactions = sessions.reduce((sum, session) => sum + number(session?.salesSummary?.transactionCount), 0);
    let totalSalesJPY = 0;
    let fxMissing = 0;
    sessions.forEach(session => {
      const value = sessionSalesJPY(session);
      if (value === null) fxMissing += 1;
      else totalSalesJPY += value;
    });
    const averageEventSales = totalEvents > 0 ? totalSalesJPY / totalEvents : 0;
    const averageTicketJPY = totalTransactions > 0 ? totalSalesJPY / totalTransactions : 0;
    const countries = aggregateBy(sessions, session => text(session.country) || "国未設定");
    const regions = aggregateBy(sessions, regionKey);

    view.innerHTML = `
      <div class="analyticsTopbar">
        <div><h1 class="page-title" style="margin-bottom:4px">Analytics</h1><p class="page-note" style="margin-top:0">イベント累計と地域別分析</p></div>
        <div class="analyticsTopActions"><button id="analyticsBack" type="button">戻る</button><button id="analyticsRefresh" type="button">更新</button></div>
      </div>

      <div class="analyticsMetrics">
        ${metric("販売実績イベント", `${totalEvents}件`)}
        ${metric("売上円換算合計", formatJPY(totalSalesJPY), fxMissing ? `為替未設定 ${fxMissing}イベントを除く` : "全イベント換算済み")}
        ${metric("記録済み販売点数", `${totalItems.toLocaleString("ja-JP")}点`, "数量不明の未分類会計は含みません")}
        ${metric("会計数", `${totalTransactions.toLocaleString("ja-JP")}件`)}
        ${metric("平均イベント売上", formatJPY(averageEventSales), "円換算できる売上をイベント数で算出")}
        ${metric("平均客単価", formatJPY(averageTicketJPY), "円換算売上 ÷ 会計数")}
      </div>

      <section class="analyticsCard">
        <div class="analyticsCardTitle">国別</div>
        <div class="analyticsNote">Sessionの国情報で集計します。表記が異なる国名は別集計になります。</div>
        ${countries.length ? aggregateRows(countries) : '<div class="analyticsNote">販売実績がありません。</div>'}
      </section>

      <section class="analyticsCard">
        <div class="analyticsCardTitle">地域別</div>
        <div class="analyticsNote">国と都市の組み合わせで集計します。</div>
        ${regions.length ? aggregateRows(regions) : '<div class="analyticsNote">販売実績がありません。</div>'}
      </section>

      <section class="analyticsCard">
        <div class="analyticsCardTitle">イベント別累計</div>
        <div class="analyticsNote">販売点数はSessionに記録された数量です。最速POSなど数量不明の会計は売上には含まれますが、販売点数には含まれない場合があります。</div>
        ${sessions.length ? eventRows(sessions) : '<div class="analyticsNote">販売実績がありません。</div>'}
      </section>
    `;

    document.getElementById("analyticsBack")?.addEventListener("click", () => {
      document.querySelector('.nav-btn[data-route="more"]')?.click();
    });
    document.getElementById("analyticsRefresh")?.addEventListener("click", () => void renderAnalytics());
  } catch (error) {
    view.innerHTML = `
      <div class="analyticsTopbar">
        <div><h1 class="page-title" style="margin-bottom:4px">Analytics</h1><p class="page-note" style="margin-top:0">イベント累計と地域別分析</p></div>
        <div class="analyticsTopActions"><button id="analyticsBack" type="button">戻る</button><button id="analyticsRefresh" type="button">再読み込み</button></div>
      </div>
      <section class="analyticsCard"><div class="warning">Analyticsを読み込めませんでした。${esc(error?.message || String(error))}</div></section>
    `;
    document.getElementById("analyticsBack")?.addEventListener("click", () => {
      document.querySelector('.nav-btn[data-route="more"]')?.click();
    });
    document.getElementById("analyticsRefresh")?.addEventListener("click", () => void renderAnalytics());
  }
}

function enhanceMore() {
  if (text(document.querySelector("h1.page-title")?.textContent) !== "More") return;
  if (document.getElementById(ENTRY_ID)) return;

  const view = document.getElementById("view");
  const title = view?.querySelector("h1.page-title");
  if (!view || !title) return;

  installStyles();
  const card = document.createElement("section");
  card.id = ENTRY_ID;
  card.className = "card";
  card.innerHTML = `
    <div class="card-title">Analytics</div>
    <div class="muted" style="margin-top:6px;margin-bottom:12px;line-height:1.5">全イベントの販売数、売上、国別、地域別の累計を確認します。</div>
    <button id="openAnalyticsButton" class="analyticsEntryButton" type="button">Analyticsを開く</button>
  `;
  title.insertAdjacentElement("afterend", card);
  card.querySelector("#openAnalyticsButton")?.addEventListener("click", () => void renderAnalytics());
}

let scheduled = false;
function scheduleEnhance() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    enhanceMore();
  });
}

const view = document.getElementById("view");
if (view) new MutationObserver(scheduleEnhance).observe(view, { childList: true, subtree: true });
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) scheduleEnhance();
});
scheduleEnhance();
