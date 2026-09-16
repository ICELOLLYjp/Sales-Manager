import { loadDailyCloseSummary } from "./eventDailyCloseService.js?v=20260916-daily-close-1";

function text(value) {
  return String(value ?? "").trim();
}

function int(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : 0;
}

function nonNegativeInt(value) {
  return Math.max(0, int(value));
}

function isAccessory(category) {
  return ["pierce", "earring", "drop_pierce", "drop_earring"].includes(text(category));
}

function dayFromClose(close, metaById) {
  const items = (Array.isArray(close?.items) ? close.items : []).map(item => {
    const variantId = text(item?.variantId);
    const meta = metaById.get(variantId) || {};
    const status = text(item?.status) || "unknown";
    const physicalQty = item?.physicalQty === null || item?.physicalQty === undefined || item?.physicalQty === ""
      ? null
      : nonNegativeInt(item.physicalQty);
    return {
      variantId,
      category: text(item?.category || meta.category),
      label: text(meta.label || variantId),
      detail: text(meta.detail),
      status,
      physicalQty: status === "unknown" ? null : physicalQty,
      reasons: Array.isArray(item?.reasons) ? item.reasons.map(text).filter(Boolean) : []
    };
  }).filter(item => item.variantId);

  return normalizeDay({
    key: `day_${nonNegativeInt(close?.dayNumber)}`,
    dayNumber: nonNegativeInt(close?.dayNumber),
    label: text(close?.label) || `Day ${nonNegativeInt(close?.dayNumber)}`,
    closedAtIso: text(close?.closedAtIso),
    current: false,
    countMode: text(close?.countMode),
    confirmedCount: nonNegativeInt(close?.confirmedCount),
    inheritedCount: nonNegativeInt(close?.inheritedCount),
    unknownCount: nonNegativeInt(close?.unknownCount),
    exactSales: nonNegativeInt(close?.exactSalesToday),
    quickSales: nonNegativeInt(close?.quickSalesToday),
    restock: nonNegativeInt(close?.restockToday),
    openingCorrection: int(close?.openingCorrectionToday),
    items
  });
}

function currentDay(summary) {
  const items = (Array.isArray(summary?.states) ? summary.states : []).map(item => ({
    variantId: text(item?.variantId),
    category: text(item?.category),
    label: text(item?.label || item?.variantId),
    detail: text(item?.detail),
    status: text(item?.status) || "unknown",
    physicalQty: item?.physicalQty === null || item?.physicalQty === undefined || item?.physicalQty === ""
      ? null
      : nonNegativeInt(item.physicalQty),
    reasons: Array.isArray(item?.reasons) ? item.reasons.map(text).filter(Boolean) : []
  })).filter(item => item.variantId);

  return normalizeDay({
    key: `day_${nonNegativeInt(summary?.dayNumber)}_current`,
    dayNumber: nonNegativeInt(summary?.dayNumber),
    label: `Day ${nonNegativeInt(summary?.dayNumber)} 現在`,
    closedAtIso: "",
    current: true,
    countMode: text(summary?.countMode),
    confirmedCount: nonNegativeInt(summary?.confirmedCount),
    inheritedCount: nonNegativeInt(summary?.inheritedCount),
    unknownCount: nonNegativeInt(summary?.unknownCount),
    exactSales: nonNegativeInt(summary?.exactSalesToday),
    quickSales: nonNegativeInt(summary?.quickSalesToday),
    restock: nonNegativeInt(summary?.restockToday),
    openingCorrection: int(summary?.openingCorrectionToday),
    items
  });
}

function normalizeDay(day) {
  const knownItems = day.items.filter(item => item.status !== "unknown" && item.physicalQty !== null);
  const tshirtItems = knownItems.filter(item => item.category === "tshirt");
  const accessoryItems = knownItems.filter(item => isAccessory(item.category));
  return {
    ...day,
    knownSkuCount: knownItems.length,
    knownQty: knownItems.reduce((sum, item) => sum + nonNegativeInt(item.physicalQty), 0),
    tshirtKnownQty: tshirtItems.reduce((sum, item) => sum + nonNegativeInt(item.physicalQty), 0),
    accessoryKnownQty: accessoryItems.reduce((sum, item) => sum + nonNegativeInt(item.physicalQty), 0)
  };
}

function variantTimeline(days, currentStates) {
  const metaById = new Map(
    (Array.isArray(currentStates) ? currentStates : []).map(row => [text(row?.variantId), {
      category: text(row?.category),
      label: text(row?.label || row?.variantId),
      detail: text(row?.detail)
    }])
  );
  const byId = new Map();

  days.forEach(day => {
    day.items.forEach(item => {
      if (!byId.has(item.variantId)) {
        const meta = metaById.get(item.variantId) || item;
        byId.set(item.variantId, {
          variantId: item.variantId,
          category: text(meta.category || item.category),
          label: text(meta.label || item.label || item.variantId),
          detail: text(meta.detail || item.detail),
          days: {}
        });
      }
      byId.get(item.variantId).days[day.key] = {
        status: item.status,
        physicalQty: item.physicalQty,
        reasons: item.reasons || []
      };
    });
  });

  return [...byId.values()].sort((a, b) =>
    (a.category === "tshirt" ? 0 : 1) - (b.category === "tshirt" ? 0 : 1) ||
    a.label.localeCompare(b.label, "ja") ||
    a.detail.localeCompare(b.detail, "ja")
  );
}

export async function loadDailyInventoryTrend({ sessionId }) {
  const summary = await loadDailyCloseSummary({ sessionId });
  const metaById = new Map(
    (Array.isArray(summary?.states) ? summary.states : []).map(row => [text(row?.variantId), {
      category: text(row?.category),
      label: text(row?.label || row?.variantId),
      detail: text(row?.detail)
    }])
  );
  const days = (Array.isArray(summary?.history) ? summary.history : [])
    .map(close => dayFromClose(close, metaById));
  if (summary.sessionStatus === "open") days.push(currentDay(summary));

  return {
    sessionId: text(sessionId),
    eventName: text(summary?.eventName),
    sessionStatus: text(summary?.sessionStatus),
    days,
    variants: variantTimeline(days, summary?.states),
    totalDayCount: days.length,
    closedDayCount: days.filter(day => !day.current).length,
    currentDayNumber: nonNegativeInt(summary?.dayNumber)
  };
}
