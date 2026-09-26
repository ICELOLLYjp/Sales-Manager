import { listSalesSessions } from "./services/sessionService.js";

const KNOWN_EVENT_FAMILIES = [
  ["publicgarden", "Public Garden"],
  ["connectasia", "Connect Asia"],
  ["好好", "好好"],
  ["森之市", "森之市"]
];

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

function normalizedName(value) {
  return text(value)
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[\s._-]+/g, "");
}

function eventFamilyName(session) {
  const raw = text(session?.eventName) || "Event";
  const normalized = normalizedName(raw);

  for (const [key, label] of KNOWN_EVENT_FAMILIES) {
    if (normalized.startsWith(key)) return label;
  }

  const withoutTrailingDate = raw
    .replace(/\s*(?:20\d{2}[\/.\-]?\d{2}[\/.\-]?\d{2}|\d{8})\s*$/u, "")
    .trim();

  return withoutTrailingDate || raw;
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
      maximumFractionDigits: currency === "JPY" || currency === "KRW" ? 0 : 2
    }).format(number(value));
  } catch {
    return `${text(currency)} ${number(value).toLocaleString("ja-JP")}`.trim();
  }
}

function usableSession(session) {
  if (!session || text(session.status) === "archived") return false;
  const summary = session.salesSummary || {};
  return number(summary.netSales) !== 0 ||
    number(summary.transactionCount) > 0 ||
    number(summary.itemCount) > 0;
}

function aggregateEventFamilies(sessions) {
  const groups = new Map();

  sessions.forEach(session => {
    const name = eventFamilyName(session);
    const current = groups.get(name) || {
      name,
      sessions: 0,
      itemCount: 0,
      transactionCount: 0,
      totalDays: 0,
      salesJPY: 0,
      unknownFxCount: 0,
      localSales: new Map(),
      countries: new Set(),
      cities: new Set(),
      startDate: "",
      endDate: ""
    };

    const currency = text(session?.currency) || "JPY";
    const netSales = number(session?.salesSummary?.netSales);
    const salesJPY = sessionSalesJPY(session);
    const start = text(session?.startDate);
    const end = text(session?.endDate) || start;
    const country = text(session?.country);
    const city = text(session?.city);

    current.sessions += 1;
    current.itemCount += number(session?.salesSummary?.itemCount);
    current.transactionCount += number(session?.salesSummary?.transactionCount);
    current.totalDays += dayCount(session);
    current.localSales.set(currency, number(current.localSales.get(currency)) + netSales);

    if (salesJPY === null) current.unknownFxCount += 1;
    else current.salesJPY += salesJPY;

    if (country) current.countries.add(country);
    if (city) current.cities.add(city);
    if (start && (!current.startDate || start < current.startDate)) current.startDate = start;
    if (end && (!current.endDate || end > current.endDate)) current.endDate = end;

    groups.set(name, current);
  });

  return Array.from(groups.values()).sort((a, b) =>
    text(b.endDate || b.startDate).localeCompare(text(a.endDate || a.startDate)) ||
    a.name.localeCompare(b.name, "ja")
  );
}

function locationText(group) {
  if (group.countries.size > 1) return "複数国";

  const country = Array.from(group.countries)[0] || "地域未設定";
  if (group.cities.size === 0) return country;
  if (group.cities.size === 1) return `${country} / ${Array.from(group.cities)[0]}`;
  return `${country} / 複数地域`;
}

function dateText(group) {
  const start = text(group.startDate).replaceAll("-", "/");
  const end = text(group.endDate).replaceAll("-", "/");
  if (!start) return "";
  if (!end || start === end) return start;
  return `${start} 〜 ${end}`;
}

function primarySalesText(group) {
  if (group.unknownFxCount > 0 && group.salesJPY <= 0) {
    return "円換算未設定";
  }

  return formatJPY(group.salesJPY);
}

function secondarySalesText(group) {
  const localEntries = Array.from(group.localSales.entries());
  let localText = "";

  if (localEntries.length === 1) {
    const [currency, amount] = localEntries[0];
    if (currency !== "JPY") {
      localText = formatLocal(amount, currency);
    }
  } else if (localEntries.length > 1) {
    localText = "複数通貨";
  }

  if (group.unknownFxCount > 0) {
    const warning = `円換算一部未設定 ${group.unknownFxCount}件`;
    return localText ? `${localText} / ${warning}` : warning;
  }

  return localText;
}

function averageTicketText(group) {
  if (group.transactionCount <= 0) return "0";
  if (group.localSales.size === 1) {
    const [currency, amount] = Array.from(group.localSales.entries())[0];
    return formatLocal(amount / group.transactionCount, currency);
  }
  return group.unknownFxCount > 0
    ? "円換算未設定"
    : formatJPY(group.salesJPY / group.transactionCount);
}

function averageDayText(group) {
  const days = Math.max(1, group.totalDays);
  if (group.localSales.size === 1) {
    const [currency, amount] = Array.from(group.localSales.entries())[0];
    return formatLocal(amount / days, currency);
  }
  return group.unknownFxCount > 0
    ? "円換算未設定"
    : formatJPY(group.salesJPY / days);
}

function rowsHtml(groups) {
  return groups.map(group => {
    const secondary = secondarySalesText(group);

    return `
    <div class="analyticsEventRow analyticsGroupedEventRow">
      <div class="analyticsEventHead">
        <div>
          <strong>${esc(group.name)}</strong>
          <span>${esc(locationText(group))} / ${esc(dateText(group))}${group.sessions > 1 ? ` / ${group.sessions} Session` : ""}</span>
        </div>
        <div class="analyticsEventSales">
          <strong>${esc(primarySalesText(group))}</strong>
          ${secondary ? `<span>${esc(secondary)}</span>` : ""}
        </div>
      </div>
      <div class="analyticsEventStats">
        <span>販売 ${group.itemCount.toLocaleString("ja-JP")}点</span>
        <span>会計 ${group.transactionCount.toLocaleString("ja-JP")}件</span>
        <span>平均客単価 ${esc(averageTicketText(group))}</span>
        <span>1日平均 ${esc(averageDayText(group))}</span>
      </div>
    </div>
  `;
  }).join("");
}

let refreshToken = 0;
let scheduled = false;

async function enhanceEventRows() {
  if (text(document.querySelector("h1.page-title")?.textContent) !== "Analytics") return;

  const card = Array.from(document.querySelectorAll(".analyticsCard"))
    .find(item => text(item.querySelector(".analyticsCardTitle")?.textContent) === "イベント別累計");

  if (!card || card.dataset.groupingBusy === "1") return;

  const token = ++refreshToken;
  card.dataset.groupingBusy = "1";

  try {
    const sessions = (await listSalesSessions()).filter(usableSession);
    if (token !== refreshToken) return;
    if (text(document.querySelector("h1.page-title")?.textContent) !== "Analytics") return;

    const groups = aggregateEventFamilies(sessions);
    const signature = groups.map(group => [
      group.name,
      group.sessions,
      group.itemCount,
      group.transactionCount,
      group.salesJPY,
      group.startDate,
      group.endDate
    ].join("|")).join("||");

    if (card.dataset.groupedSignature === signature) return;

    card.innerHTML = `
      <div class="analyticsCardTitle">イベント別累計</div>
      <div class="analyticsNote">同じイベント系列をまとめて集計します。Public Garden、Connect Asia、好好、森之市は同系列としてまとめ、その他は末尾の日付を除いてまとめます。販売点数はSessionに記録された数量です。</div>
      ${groups.length ? rowsHtml(groups) : '<div class="analyticsNote">販売実績がありません。</div>'}
    `;
    card.dataset.groupedSignature = signature;
  } catch (error) {
    console.warn("Analytics event grouping failed", error);
  } finally {
    card.dataset.groupingBusy = "0";
  }
}

function scheduleEnhance() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    void enhanceEventRows();
  });
}

const view = document.getElementById("view");
if (view) {
  new MutationObserver(scheduleEnhance).observe(view, {
    childList: true,
    subtree: true
  });
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) scheduleEnhance();
});

scheduleEnhance();
