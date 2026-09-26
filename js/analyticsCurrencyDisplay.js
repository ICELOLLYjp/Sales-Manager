import { listSalesSessions } from "./services/sessionService.js";

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

function normalizeCountry(value) {
  const raw = text(value);
  const compact = raw
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[\s._-]+/g, "");

  const aliases = [
    [["japan", "日本"], "Japan"],
    [["taiwan", "台灣", "台湾", "taiwanprovinceofchina"], "Taiwan"],
    [["singapore", "シンガポール"], "Singapore"],
    [["thailand", "タイ", "タイ王国"], "Thailand"],
    [["hongkong", "香港"], "Hong Kong"],
    [["southkorea", "korea", "韓国", "韓國", "republicofkorea"], "South Korea"],
    [["unitedstates", "usa", "us", "america", "アメリカ", "米国", "米國"], "United States"]
  ];

  for (const [keys, label] of aliases) {
    if (keys.some(key => compact === key.normalize("NFKC").toLocaleLowerCase("en").replace(/[\s._-]+/g, ""))) {
      return label;
    }
  }

  return raw || "国未設定";
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

function sessionSalesJPY(session) {
  const netSales = number(session?.salesSummary?.netSales);
  if (text(session?.currency) === "JPY") return netSales;

  const stored = number(session?.salesSummary?.netSalesJPY);
  if (stored > 0) return stored;

  const rate = number(session?.fxRateToJPY);
  return rate > 0 ? netSales * rate : null;
}

function usableSession(session) {
  if (!session || text(session.status) === "archived") return false;
  const summary = session.salesSummary || {};
  return number(summary.netSales) !== 0 ||
    number(summary.transactionCount) > 0 ||
    number(summary.itemCount) > 0;
}

function countryKey(session) {
  return normalizeCountry(session?.country);
}

function regionKey(session) {
  const country = normalizeCountry(session?.country);
  const city = text(session?.city) || "地域未設定";
  return `${country} / ${city}`;
}

function aggregate(sessions, keyFor) {
  const map = new Map();

  sessions.forEach(session => {
    const key = keyFor(session);
    const currency = text(session?.currency) || "JPY";
    const localAmount = number(session?.salesSummary?.netSales);
    const salesJPY = sessionSalesJPY(session);
    const transactionCount = number(session?.salesSummary?.transactionCount);

    const current = map.get(key) || {
      key,
      eventCount: 0,
      convertedEventCount: 0,
      salesJPY: 0,
      unknownFxCount: 0,
      itemCount: 0,
      transactionCount: 0,
      convertedTransactionCount: 0,
      localSales: new Map()
    };

    current.eventCount += 1;
    current.itemCount += number(session?.salesSummary?.itemCount);
    current.transactionCount += transactionCount;
    current.localSales.set(currency, number(current.localSales.get(currency)) + localAmount);

    if (salesJPY === null) {
      current.unknownFxCount += 1;
    } else {
      current.salesJPY += salesJPY;
      current.convertedEventCount += 1;
      current.convertedTransactionCount += transactionCount;
    }

    map.set(key, current);
  });

  return Array.from(map.values()).sort((a, b) =>
    b.salesJPY - a.salesJPY ||
    b.eventCount - a.eventCount ||
    a.key.localeCompare(b.key, "ja")
  );
}

function singleLocal(row) {
  const entries = Array.from(row.localSales.entries());
  if (entries.length !== 1) return null;
  return entries[0];
}

function localTotalText(row) {
  const local = singleLocal(row);
  if (!local) return row.localSales.size > 1 ? "現地通貨 複数通貨" : "";

  const [currency, amount] = local;
  if (currency === "JPY") return "";
  return formatLocal(amount, currency);
}

function averageTexts(row) {
  const averageEventJPY = row.convertedEventCount > 0
    ? row.salesJPY / row.convertedEventCount
    : 0;
  const averageTicketJPY = row.convertedTransactionCount > 0
    ? row.salesJPY / row.convertedTransactionCount
    : 0;

  let averageEventLocal = "";
  let averageTicketLocal = "";
  const local = singleLocal(row);

  if (local) {
    const [currency, amount] = local;
    if (currency !== "JPY") {
      averageEventLocal = formatLocal(
        row.eventCount > 0 ? amount / row.eventCount : 0,
        currency
      );
      averageTicketLocal = formatLocal(
        row.transactionCount > 0 ? amount / row.transactionCount : 0,
        currency
      );
    }
  }

  return {
    averageEventJPY,
    averageTicketJPY,
    averageEventLocal,
    averageTicketLocal
  };
}

function rowsHtml(rows) {
  return rows.map(row => {
    const localTotal = localTotalText(row);
    const averages = averageTexts(row);
    const fxNote = row.unknownFxCount > 0
      ? ` / 為替未設定 ${row.unknownFxCount}件`
      : "";

    const averageEvent = averages.averageEventLocal
      ? `${formatJPY(averages.averageEventJPY)} / ${averages.averageEventLocal}`
      : formatJPY(averages.averageEventJPY);

    const averageTicket = averages.averageTicketLocal
      ? `${formatJPY(averages.averageTicketJPY)} / ${averages.averageTicketLocal}`
      : formatJPY(averages.averageTicketJPY);

    return `
      <div class="analyticsTableRow analyticsCurrencyRow">
        <div class="analyticsTableMain">
          <strong>${esc(row.key)}</strong>
          <span>${row.eventCount}イベント / ${row.itemCount.toLocaleString("ja-JP")}点 / ${row.transactionCount.toLocaleString("ja-JP")}会計${esc(fxNote)}</span>
        </div>
        <div class="analyticsTableNumbers analyticsCurrencyNumbers">
          <strong class="analyticsJpyPrimary">${row.convertedEventCount > 0 ? esc(formatJPY(row.salesJPY)) : "円換算未設定"}</strong>
          ${localTotal ? `<span class="analyticsLocalSecondary">${esc(localTotal)}</span>` : ""}
          <span>平均イベント ${esc(averageEvent)}</span>
          <span>平均客単価 ${esc(averageTicket)}</span>
        </div>
      </div>
    `;
  }).join("");
}

function installStyles() {
  if (document.getElementById("analyticsCurrencyDisplayStyles")) return;

  const style = document.createElement("style");
  style.id = "analyticsCurrencyDisplayStyles";
  style.textContent = `
    .analyticsCurrencyNumbers{min-width:190px;gap:2px}
    .analyticsJpyPrimary{font-size:20px;line-height:1.18}
    .analyticsLocalSecondary{font-size:13px!important;color:#555!important;font-weight:800}
    @media(max-width:430px){
      .analyticsCurrencyNumbers{min-width:0;display:grid!important;grid-template-columns:1fr!important;gap:3px!important}
      .analyticsJpyPrimary{font-size:22px;grid-column:auto!important}
      .analyticsLocalSecondary{font-size:14px!important}
    }
  `;
  document.head.appendChild(style);
}

function analyticsCard(title) {
  return Array.from(document.querySelectorAll(".analyticsCard"))
    .find(card => text(card.querySelector(".analyticsCardTitle")?.textContent) === title);
}

let scheduled = false;
let busy = false;
let runToken = 0;

async function enhanceCurrencyDisplay() {
  if (busy) return;
  if (text(document.querySelector("h1.page-title")?.textContent) !== "Analytics") return;

  const countryCard = analyticsCard("国別");
  const regionCard = analyticsCard("地域別");
  if (!countryCard || !regionCard) return;
  if (
    countryCard.dataset.currencyEnhanced === "1" &&
    regionCard.dataset.currencyEnhanced === "1"
  ) {
    return;
  }

  busy = true;
  const token = ++runToken;

  try {
    installStyles();
    const sessions = (await listSalesSessions()).filter(usableSession);
    if (token !== runToken) return;
    if (text(document.querySelector("h1.page-title")?.textContent) !== "Analytics") return;

    const countries = aggregate(sessions, countryKey);
    const regions = aggregate(sessions, regionKey);

    countryCard.innerHTML = `
      <div class="analyticsCardTitle">国別</div>
      <div class="analyticsNote">日本円を大きく表示し、その下に現地通貨を併記します。過去の国名表記も標準名にまとめて集計します。</div>
      ${countries.length ? rowsHtml(countries) : '<div class="analyticsNote">販売実績がありません。</div>'}
    `;
    countryCard.dataset.currencyEnhanced = "1";

    regionCard.innerHTML = `
      <div class="analyticsCardTitle">地域別</div>
      <div class="analyticsNote">国と都市の組み合わせで集計し、日本円と現地通貨を併記します。</div>
      ${regions.length ? rowsHtml(regions) : '<div class="analyticsNote">販売実績がありません。</div>'}
    `;
    regionCard.dataset.currencyEnhanced = "1";
  } catch (error) {
    console.warn("Analytics currency display failed", error);
  } finally {
    busy = false;
  }
}

function scheduleEnhance() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    void enhanceCurrencyDisplay();
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
