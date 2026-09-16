import { getFirebaseState } from "../firebase.js";
import { summarizeEventFlow } from "./eventFlowAccountingService.js?v=20260916-flow-accounting-1";

const TRACKED_CATEGORIES = new Set([
  "tshirt",
  "pierce",
  "earring",
  "drop_pierce",
  "drop_earring"
]);

async function firestoreModule() {
  return await import("https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js");
}

async function requireDb() {
  const { db, enabled } = getFirebaseState();
  if (!enabled || !db) throw new Error("Firebase is not connected.");
  return db;
}

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

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix) {
  if (globalThis.crypto?.randomUUID) return `${prefix}_${globalThis.crypto.randomUUID()}`;
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function timestampMs(value) {
  if (!value) return 0;
  try {
    if (typeof value.toMillis === "function") return value.toMillis();
    if (typeof value.toDate === "function") return value.toDate().getTime();
  } catch {}
  if (Number.isFinite(Number(value?.seconds))) {
    return Number(value.seconds) * 1000 + Math.floor(Number(value.nanoseconds || 0) / 1e6);
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function timestampKey(value) {
  const ms = timestampMs(value);
  return ms ? String(ms) : text(value);
}

function currentSoldByVariant(session) {
  const source = session?.inventoryCount?.soldByVariant;
  if (!source || typeof source !== "object" || Array.isArray(source)) return {};
  return Object.fromEntries(
    Object.entries(source)
      .map(([variantId, quantity]) => [text(variantId), nonNegativeInt(quantity)])
      .filter(([variantId]) => variantId)
  );
}

function checkpoints(session) {
  return (Array.isArray(session?.inventoryCount?.checkpoints)
    ? session.inventoryCount.checkpoints
    : [])
    .filter(row => text(row?.id) && timestampMs(row?.capturedAtIso))
    .sort((a, b) => timestampMs(a?.capturedAtIso) - timestampMs(b?.capturedAtIso));
}

function checkpointKnownItems(checkpoint) {
  return (Array.isArray(checkpoint?.items) ? checkpoint.items : [])
    .map(item => ({
      variantId: text(item?.variantId),
      physicalQty:
        item?.physicalQty === null ||
        item?.physicalQty === undefined ||
        item?.physicalQty === ""
          ? null
          : nonNegativeInt(item.physicalQty)
    }))
    .filter(item => item.variantId && item.physicalQty !== null);
}

function checkpointScope(checkpoint) {
  const explicit = text(checkpoint?.scope);
  if (explicit === "tshirt" || explicit === "accessory") return explicit;
  const source = text(checkpoint?.source);
  if (source.includes("tshirt")) return "tshirt";
  if (source.includes("accessory")) return "accessory";
  return "all";
}

function rowScope(category) {
  return text(category) === "tshirt" ? "tshirt" : "accessory";
}

function latestKnownByVariant(session) {
  const map = new Map();
  checkpoints(session).forEach(checkpoint => {
    checkpointKnownItems(checkpoint).forEach(item => {
      map.set(item.variantId, { checkpoint, item });
    });
  });
  return map;
}

function laterAmbiguousScopeCheckpoint(session, variantCategory, afterMs) {
  const scope = rowScope(variantCategory);
  return checkpoints(session).find(checkpoint => {
    const cpMs = timestampMs(checkpoint?.capturedAtIso);
    if (!cpMs || cpMs <= afterMs) return false;
    const cpScope = checkpointScope(checkpoint);
    if (cpScope !== "all" && cpScope !== scope) return false;
    return nonNegativeInt(checkpoint?.skippedUnknownCount) > 0;
  }) || null;
}

function transactionTime(transaction) {
  return (
    timestampMs(transaction?.createdAt) ||
    timestampMs(transaction?.committedAt) ||
    timestampMs(transaction?.updatedAt)
  );
}

function quickUnits(transaction) {
  if (transaction?.status === "voided") return [];
  const txMs = transactionTime(transaction);
  return (Array.isArray(transaction?.items) ? transaction.items : [])
    .map(item => ({
      category: text(item?.category),
      variantId: text(item?.variantId),
      quantity: nonNegativeInt(item?.quantity),
      txMs
    }))
    .filter(item =>
      !item.variantId &&
      item.quantity > 0 &&
      TRACKED_CATEGORIES.has(item.category)
    );
}

function quickChangedAfter(transactions, category, afterMs) {
  return (Array.isArray(transactions) ? transactions : []).some(transaction =>
    quickUnits(transaction).some(item =>
      item.category === category && (!item.txMs || item.txMs > afterMs)
    )
  );
}

function cumulativeQuickTotal(transactions) {
  return (Array.isArray(transactions) ? transactions : []).reduce((sum, transaction) =>
    sum + quickUnits(transaction).reduce((inner, item) => inner + item.quantity, 0), 0
  );
}

function flowEntries(session) {
  return (Array.isArray(session?.inventoryCount?.flowEntries)
    ? session.inventoryCount.flowEntries
    : [])
    .filter(entry => ["restock", "opening_correction"].includes(text(entry?.type)));
}

function dailyCloses(session) {
  return (Array.isArray(session?.inventoryCount?.dailyCloses)
    ? session.inventoryCount.dailyCloses
    : [])
    .filter(row => text(row?.id))
    .sort((a, b) => nonNegativeInt(a?.dayNumber) - nonNegativeInt(b?.dayNumber));
}

function previousDailyClose(session) {
  return dailyCloses(session).at(-1) || null;
}

function dailyState(session) {
  const previous = previousDailyClose(session);
  const raw = session?.inventoryCount?.dailyState;
  const dayNumber = Math.max(
    1,
    nonNegativeInt(raw?.dayNumber) || (nonNegativeInt(previous?.dayNumber) + 1) || 1
  );
  return {
    dayNumber,
    status: text(raw?.status) || "open",
    startedAtIso: text(raw?.startedAtIso),
    startedByEmail: text(raw?.startedByEmail),
    previousDailyCloseId: text(raw?.previousDailyCloseId)
  };
}

function trackedRows(session) {
  return summarizeEventFlow(session).adjustedOpeningItems
    .filter(item => TRACKED_CATEGORIES.has(text(item?.category)) && text(item?.variantId))
    .map(item => ({
      variantId: text(item.variantId),
      category: text(item.category),
      label: text(item?.label || item?.sku || item.variantId),
      detail: text(item?.detail),
      inventorySource: text(item?.inventorySource),
      inventoryKey: text(item?.inventoryKey)
    }));
}

function buildInventoryStates(session, transactions) {
  const rows = trackedRows(session);
  const latestByVariant = latestKnownByVariant(session);
  const soldNow = currentSoldByVariant(session);
  const flows = flowEntries(session);
  const previous = previousDailyClose(session);
  const previousClosedAtMs = timestampMs(previous?.closedAtIso);

  return rows.map(row => {
    const source = latestByVariant.get(row.variantId) || null;
    const checkpoint = source?.checkpoint || null;
    const cpItem = source?.item || null;
    const cpMs = timestampMs(checkpoint?.capturedAtIso);
    const reasons = [];

    if (!cpItem) reasons.push("実数カウントなし");

    if (cpItem) {
      const capturedSold = checkpoint?.soldByVariantSnapshot &&
        typeof checkpoint.soldByVariantSnapshot === "object"
          ? checkpoint.soldByVariantSnapshot
          : {};
      if (nonNegativeInt(capturedSold?.[row.variantId]) !== nonNegativeInt(soldNow?.[row.variantId])) {
        reasons.push("カウント後にSKU販売/取消あり");
      }
      if (flows.some(entry =>
        text(entry?.variantId) === row.variantId &&
        timestampMs(entry?.recordedAtIso) > cpMs
      )) {
        reasons.push("カウント後にRestock/開始修正あり");
      }
      if (quickChangedAfter(transactions, row.category, cpMs)) {
        reasons.push("カウント後にQuick販売あり");
      }
      if (laterAmbiguousScopeCheckpoint(session, row.category, cpMs)) {
        reasons.push("後のカウントに不明あり");
      }
    }

    const known = Boolean(cpItem) && reasons.length === 0;
    const status = !known
      ? "unknown"
      : cpMs > previousClosedAtMs
        ? "confirmed"
        : "inherited";

    return {
      variantId: row.variantId,
      category: row.category,
      label: row.label,
      detail: row.detail,
      status,
      physicalQty: known ? nonNegativeInt(cpItem.physicalQty) : null,
      sourceCheckpointId: known ? text(checkpoint?.id) : "",
      sourceCheckpointType: known ? text(checkpoint?.type) : "",
      sourceCheckpointAtIso: known ? text(checkpoint?.capturedAtIso) : "",
      reasons
    };
  });
}

function flowTotals(session) {
  let restock = 0;
  let correction = 0;
  flowEntries(session).forEach(entry => {
    if (text(entry?.type) === "restock") restock += Math.max(0, int(entry?.quantity));
    if (text(entry?.type) === "opening_correction") correction += int(entry?.quantity);
  });
  return { restock, correction };
}

function salesTotals(session, transactions) {
  const exact = Object.values(currentSoldByVariant(session)).reduce((sum, qty) => sum + nonNegativeInt(qty), 0);
  const quick = cumulativeQuickTotal(transactions);
  return { exact, quick };
}

async function loadSessionAndSales(sessionId) {
  const db = await requireDb();
  const {
    doc,
    collection,
    query,
    where,
    getDocFromServer,
    getDocsFromServer
  } = await firestoreModule();

  const sessionRef = doc(db, "salesSessions", sessionId);
  const [sessionSnapshot, salesSnapshot] = await Promise.all([
    getDocFromServer(sessionRef),
    getDocsFromServer(query(
      collection(db, "salesTransactions"),
      where("sessionId", "==", sessionId)
    ))
  ]);

  if (!sessionSnapshot.exists()) throw new Error("販売セッションが見つかりません。");
  return {
    db,
    sessionRef,
    session: sessionSnapshot.data(),
    transactions: salesSnapshot.docs.map(snapshot => ({
      transactionId: snapshot.id,
      ...snapshot.data()
    }))
  };
}

function buildSummary(sessionId, session, transactions) {
  const currentDailyState = dailyState(session);
  const history = dailyCloses(session);
  const previous = history.at(-1) || null;
  const states = buildInventoryStates(session, transactions);
  const totals = salesTotals(session, transactions);
  const flows = flowTotals(session);

  const confirmedRows = states.filter(row => row.status === "confirmed");
  const inheritedRows = states.filter(row => row.status === "inherited");
  const unknownRows = states.filter(row => row.status === "unknown");
  const previousExact = nonNegativeInt(previous?.exactSalesTotalSnapshot);
  const previousQuick = nonNegativeInt(previous?.quickSalesTotalSnapshot);
  const previousRestock = nonNegativeInt(previous?.restockTotalSnapshot);
  const previousCorrection = int(previous?.openingCorrectionTotalSnapshot);
  const checkpointsAfterPrevious = checkpoints(session).filter(cp =>
    timestampMs(cp?.capturedAtIso) > timestampMs(previous?.closedAtIso)
  );

  const newPhysicalCount = checkpointsAfterPrevious.some(cp => checkpointKnownItems(cp).length > 0);
  const countMode = states.length === 0 || unknownRows.length === states.length
    ? "none"
    : unknownRows.length > 0
      ? "partial"
      : "full";

  return {
    sessionId,
    sessionStatus: text(session?.status),
    eventName: text(session?.eventName || session?.name),
    dayNumber: currentDailyState.dayNumber,
    dailyState: currentDailyState,
    previousDailyCloseId: text(previous?.id),
    previousClosedAtIso: text(previous?.closedAtIso),
    history,
    totalTrackedSkuCount: states.length,
    confirmedCount: confirmedRows.length,
    inheritedCount: inheritedRows.length,
    unknownCount: unknownRows.length,
    knownCount: confirmedRows.length + inheritedRows.length,
    countMode,
    newPhysicalCount,
    exactSalesToday: Math.max(0, totals.exact - previousExact),
    quickSalesToday: Math.max(0, totals.quick - previousQuick),
    restockToday: Math.max(0, flows.restock - previousRestock),
    openingCorrectionToday: flows.correction - previousCorrection,
    exactSalesTotalSnapshot: totals.exact,
    quickSalesTotalSnapshot: totals.quick,
    restockTotalSnapshot: flows.restock,
    openingCorrectionTotalSnapshot: flows.correction,
    soldByVariantSnapshot: currentSoldByVariant(session),
    flowEntryCountAtClose: flowEntries(session).length,
    states,
    loadedUpdatedAtKey: timestampKey(session?.updatedAt)
  };
}

export async function loadDailyCloseSummary({ sessionId }) {
  const cleanSessionId = text(sessionId);
  if (!cleanSessionId) throw new Error("販売セッションを選択してください。");
  const loaded = await loadSessionAndSales(cleanSessionId);
  return buildSummary(cleanSessionId, loaded.session, loaded.transactions);
}

export async function closeCurrentDayAndStartNext({
  sessionId,
  closedByEmail = "",
  note = ""
}) {
  const cleanSessionId = text(sessionId);
  if (!cleanSessionId) throw new Error("販売セッションを選択してください。");

  const loaded = await loadSessionAndSales(cleanSessionId);
  const summary = buildSummary(cleanSessionId, loaded.session, loaded.transactions);

  if (summary.sessionStatus !== "open") {
    throw new Error("日次締めは販売中のイベントで実行してください。");
  }

  const { runTransaction, serverTimestamp } = await firestoreModule();
  const closedAtIso = nowIso();
  const dailyClose = {
    id: makeId("dayclose"),
    dayNumber: summary.dayNumber,
    label: `Day ${summary.dayNumber}`,
    closedAtIso,
    closedByEmail: text(closedByEmail),
    note: text(note),
    countMode: summary.countMode,
    newPhysicalCount: Boolean(summary.newPhysicalCount),
    totalTrackedSkuCount: summary.totalTrackedSkuCount,
    confirmedCount: summary.confirmedCount,
    inheritedCount: summary.inheritedCount,
    unknownCount: summary.unknownCount,
    exactSalesToday: summary.exactSalesToday,
    quickSalesToday: summary.quickSalesToday,
    restockToday: summary.restockToday,
    openingCorrectionToday: summary.openingCorrectionToday,
    exactSalesTotalSnapshot: summary.exactSalesTotalSnapshot,
    quickSalesTotalSnapshot: summary.quickSalesTotalSnapshot,
    restockTotalSnapshot: summary.restockTotalSnapshot,
    openingCorrectionTotalSnapshot: summary.openingCorrectionTotalSnapshot,
    soldByVariantSnapshot: summary.soldByVariantSnapshot,
    flowEntryCountAtClose: summary.flowEntryCountAtClose,
    items: summary.states.map(row => ({
      variantId: row.variantId,
      category: row.category,
      status: row.status,
      physicalQty: row.physicalQty,
      sourceCheckpointId: row.sourceCheckpointId,
      sourceCheckpointAtIso: row.sourceCheckpointAtIso,
      reasons: row.reasons.slice(0, 3)
    }))
  };

  return await runTransaction(loaded.db, async transaction => {
    const snapshot = await transaction.get(loaded.sessionRef);
    if (!snapshot.exists()) throw new Error("販売セッションが見つかりません。");
    const current = snapshot.data();

    if (text(current?.status) !== "open") {
      throw new Error("イベント状態が変更されました。画面を更新してください。");
    }
    if (timestampKey(current?.updatedAt) !== summary.loadedUpdatedAtKey) {
      const error = new Error("日次締めの確認後に売上または在庫情報が変わりました。画面を更新してもう一度実行してください。");
      error.code = "daily-close-data-changed";
      throw error;
    }

    const existing = dailyCloses(current);
    const expectedDay = Math.max(1, nonNegativeInt(existing.at(-1)?.dayNumber) + 1);
    if (expectedDay !== summary.dayNumber) {
      throw new Error("日次締め状態が更新されています。画面を再読み込みしてください。");
    }

    transaction.update(loaded.sessionRef, {
      "inventoryCount.dailyCloses": [...existing, dailyClose],
      "inventoryCount.dailyState": {
        dayNumber: summary.dayNumber + 1,
        status: "open",
        startedAtIso: closedAtIso,
        startedByEmail: text(closedByEmail),
        previousDailyCloseId: dailyClose.id,
        previousDayNumber: summary.dayNumber
      },
      "inventoryCount.dailyUpdatedAt": serverTimestamp(),
      "inventoryCount.updatedAt": serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    return {
      sessionId: cleanSessionId,
      dailyCloseId: dailyClose.id,
      closedDayNumber: summary.dayNumber,
      nextDayNumber: summary.dayNumber + 1,
      countMode: summary.countMode,
      confirmedCount: summary.confirmedCount,
      inheritedCount: summary.inheritedCount,
      unknownCount: summary.unknownCount,
      exactSalesToday: summary.exactSalesToday,
      quickSalesToday: summary.quickSalesToday,
      restockToday: summary.restockToday,
      openingCorrectionToday: summary.openingCorrectionToday
    };
  });
}
