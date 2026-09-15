import { getFirebaseState } from "../firebase.js";
import { provisionallyCloseEventSession as baseProvisionalClose } from "./eventCloseServiceCompat.js?v=20260915-outside-opening-1";
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

function nonNegativeInt(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.trunc(number));
}

function int(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.trunc(number);
}

function reductionTotal(closing) {
  return ["loss", "theft", "damage", "gift", "sample"]
    .reduce((sum, key) => sum + nonNegativeInt(closing?.[key]), 0);
}

function closingItems(session) {
  return Array.isArray(session?.inventoryCount?.closing?.items)
    ? session.inventoryCount.closing.items
    : [];
}

function quickUnits(transactions) {
  const result = [];

  (Array.isArray(transactions) ? transactions : [])
    .filter(transaction => transaction?.status !== "voided")
    .forEach(transaction => {
      (Array.isArray(transaction?.items) ? transaction.items : []).forEach((item, itemIndex) => {
        const quantity = nonNegativeInt(item?.quantity);
        const category = text(item?.category);
        const variantId = text(item?.variantId);

        if (quantity <= 0 || variantId || !TRACKED_CATEGORIES.has(category)) return;

        for (let unitIndex = 0; unitIndex < quantity; unitIndex += 1) {
          result.push({
            allocationKey: `${text(transaction?.transactionId)}:${itemIndex}:${unitIndex}`,
            transactionId: text(transaction?.transactionId),
            itemIndex,
            unitIndex,
            category,
            unitPrice: Number(item?.unitPrice || 0),
            tshirtBodyKey: text(item?.tshirtBodyKey)
          });
        }
      });
    });

  return result;
}

function exactSalesByVariant(transactions) {
  const result = new Map();

  (Array.isArray(transactions) ? transactions : [])
    .filter(transaction => transaction?.status !== "voided")
    .forEach(transaction => {
      (Array.isArray(transaction?.items) ? transaction.items : []).forEach(item => {
        const variantId = text(item?.variantId);
        const quantity = nonNegativeInt(item?.quantity);
        if (!variantId || quantity <= 0) return;
        result.set(variantId, (result.get(variantId) || 0) + quantity);
      });
    });

  return result;
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

function buildSummary(session, transactions) {
  const units = quickUnits(transactions);
  const unitByKey = new Map(units.map(unit => [unit.allocationKey, unit]));
  const flow = summarizeEventFlow(session);
  const opening = flow.adjustedOpeningItems.filter(item =>
    TRACKED_CATEGORIES.has(text(item?.category))
  );
  const closingById = new Map(
    closingItems(session).map(item => [text(item?.variantId), item])
  );
  const exactByVariant = exactSalesByVariant(transactions);

  const assignedKeys = new Set();
  const savedByVariant = new Map();
  const savedByCategory = new Map();

  (Array.isArray(session?.inventoryCount?.quickAllocations)
    ? session.inventoryCount.quickAllocations
    : []).forEach(item => {
      const key = text(item?.allocationKey);
      const variantId = text(item?.variantId);
      const unit = unitByKey.get(key);
      if (!unit || !variantId || assignedKeys.has(key)) return;
      if (item?.category && text(item.category) !== unit.category) return;

      assignedKeys.add(key);
      savedByVariant.set(variantId, (savedByVariant.get(variantId) || 0) + 1);
      savedByCategory.set(unit.category, (savedByCategory.get(unit.category) || 0) + 1);
    });

  const remainingByCategory = new Map();
  units.forEach(unit => {
    if (assignedKeys.has(unit.allocationKey)) return;
    remainingByCategory.set(
      unit.category,
      (remainingByCategory.get(unit.category) || 0) + 1
    );
  });

  let closingComplete = opening.length > 0;
  const gapByCategory = new Map();
  const negativeGapByCategory = new Map();
  let differenceCount = 0;

  opening.forEach(item => {
    const variantId = text(item?.variantId);
    const category = text(item?.category);
    const closing = closingById.get(variantId);

    if (
      !closing ||
      closing.closingQty === null ||
      closing.closingQty === undefined ||
      closing.closingQty === ""
    ) {
      closingComplete = false;
      return;
    }

    const expectedBeforeAuto =
      nonNegativeInt(item?.openingQty) -
      nonNegativeInt(exactByVariant.get(variantId)) -
      nonNegativeInt(savedByVariant.get(variantId)) -
      reductionTotal(closing) +
      int(closing?.stockAdjustment);

    const actual = nonNegativeInt(closing.closingQty);
    const difference = expectedBeforeAuto - actual;

    if (difference !== 0) differenceCount += 1;
    if (difference > 0) {
      gapByCategory.set(category, (gapByCategory.get(category) || 0) + difference);
    } else if (difference < 0) {
      negativeGapByCategory.set(
        category,
        (negativeGapByCategory.get(category) || 0) + Math.abs(difference)
      );
    }
  });

  const autoResolvedCategories = new Set();
  let autoResolvedTotal = 0;

  if (closingComplete) {
    remainingByCategory.forEach((quantity, category) => {
      const gap = nonNegativeInt(gapByCategory.get(category));
      const negativeGap = nonNegativeInt(negativeGapByCategory.get(category));
      if (quantity > 0 && negativeGap === 0 && gap === quantity) {
        autoResolvedCategories.add(category);
        autoResolvedTotal += quantity;
      }
    });
  }

  const unresolvedUnits = units.filter(unit =>
    !assignedKeys.has(unit.allocationKey) &&
    !autoResolvedCategories.has(unit.category)
  );

  const groups = new Map();
  unresolvedUnits.forEach(unit => {
    const bodyKey = unit.category === "tshirt" ? unit.tshirtBodyKey : "";
    const groupKey = [unit.category, Number(unit.unitPrice || 0), bodyKey].join("||");
    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        groupKey,
        category: unit.category,
        unitPrice: Number(unit.unitPrice || 0),
        tshirtBodyKey: bodyKey,
        quantity: 0
      });
    }
    groups.get(groupKey).quantity += 1;
  });

  const grouped = Array.from(groups.values()).sort((a, b) =>
    a.category.localeCompare(b.category) ||
    a.unitPrice - b.unitPrice ||
    a.tshirtBodyKey.localeCompare(b.tshirtBodyKey)
  );

  const externalCounts = session?.inventoryCount?.externalCounts || {};

  return {
    sessionId: text(session?.sessionId),
    sessionStatus: text(session?.status),
    currency: text(session?.currency || "JPY"),
    quickTotal: units.length,
    manualAllocatedTotal: assignedKeys.size,
    autoResolvedTotal,
    identifiedTotal: assignedKeys.size + autoResolvedTotal,
    unresolvedTotal: unresolvedUnits.length,
    groups: grouped,
    closingComplete,
    differenceCount,
    tshirtCountStatus: text(externalCounts?.tshirt?.status),
    accessoryCountStatus: text(externalCounts?.accessory?.status),
    persistedStatus: text(session?.inventoryCount?.unidentifiedQuick?.status),
    flowEntryCount: flow.flowEntryCount,
    restockTotal: flow.restockTotal,
    openingCorrectionTotal: flow.openingCorrectionTotal,
    adjustedOpeningTotal: flow.adjustedOpeningTotal,
    flowOnlySkuCount: flow.flowOnlySkuCount
  };
}

export async function loadUnidentifiedQuickSummary({ sessionId }) {
  const cleanSessionId = text(sessionId);
  if (!cleanSessionId) throw new Error("販売セッションが見つかりません。");

  const loaded = await loadSessionAndSales(cleanSessionId);
  const summary = buildSummary(
    { sessionId: cleanSessionId, ...loaded.session },
    loaded.transactions
  );

  return summary;
}

async function persistSummary(sessionRef, summary, savedByEmail = "", forcedStatus = "") {
  const { updateDoc, serverTimestamp } = await firestoreModule();
  const status = forcedStatus || (summary.unresolvedTotal > 0 ? "unidentified" : "resolved");

  await updateDoc(sessionRef, {
    "inventoryCount.unidentifiedQuick": {
      version: 2,
      status,
      source: "inventory_reconciliation",
      quickTotal: summary.quickTotal,
      manualAllocatedTotal: summary.manualAllocatedTotal,
      autoResolvedTotal: summary.autoResolvedTotal,
      identifiedTotal: summary.identifiedTotal,
      unresolvedTotal: summary.unresolvedTotal,
      groups: summary.groups,
      closingComplete: summary.closingComplete,
      differenceCount: summary.differenceCount,
      tshirtCountStatus: summary.tshirtCountStatus,
      accessoryCountStatus: summary.accessoryCountStatus,
      flowEntryCount: summary.flowEntryCount,
      restockTotal: summary.restockTotal,
      openingCorrectionTotal: summary.openingCorrectionTotal,
      adjustedOpeningTotal: summary.adjustedOpeningTotal,
      flowOnlySkuCount: summary.flowOnlySkuCount,
      savedByEmail: text(savedByEmail),
      savedAt: serverTimestamp()
    },
    "inventoryCount.updatedAt": serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

export async function syncUnidentifiedQuickState({
  sessionId,
  savedByEmail = ""
}) {
  const cleanSessionId = text(sessionId);
  if (!cleanSessionId) throw new Error("販売セッションが見つかりません。");

  const loaded = await loadSessionAndSales(cleanSessionId);
  const summary = buildSummary(
    { sessionId: cleanSessionId, ...loaded.session },
    loaded.transactions
  );

  const forcedStatus = loaded.session?.status === "open"
    ? "draft"
    : (summary.unresolvedTotal > 0 ? "unidentified" : "resolved");

  await persistSummary(loaded.sessionRef, summary, savedByEmail, forcedStatus);
  return summary;
}

export async function provisionallyCloseWithUnidentified({
  sessionId,
  closedByEmail = ""
}) {
  const cleanSessionId = text(sessionId);
  if (!cleanSessionId) throw new Error("販売セッションが見つかりません。");

  const before = await loadSessionAndSales(cleanSessionId);
  const status = text(before.session?.status);

  let closeResult = {
    sessionId: cleanSessionId,
    status
  };

  if (status === "open") {
    closeResult = await baseProvisionalClose({
      sessionId: cleanSessionId,
      closedByEmail
    });
  } else if (status !== "pending_allocation") {
    throw new Error("このイベントは仮終了できる状態ではありません。");
  }

  const after = await loadSessionAndSales(cleanSessionId);
  const summary = buildSummary(
    { sessionId: cleanSessionId, ...after.session },
    after.transactions
  );

  await persistSummary(
    after.sessionRef,
    summary,
    closedByEmail,
    summary.unresolvedTotal > 0 ? "unidentified" : "resolved"
  );

  return {
    ...closeResult,
    status: "pending_allocation",
    quickSalesTotal: summary.quickTotal,
    quickAllocatedTotal: summary.identifiedTotal,
    quickUnresolvedTotal: summary.unresolvedTotal,
    unidentifiedGroups: summary.groups,
    differenceCount: summary.differenceCount,
    restockTotal: summary.restockTotal,
    openingCorrectionTotal: summary.openingCorrectionTotal,
    adjustedOpeningTotal: summary.adjustedOpeningTotal
  };
}
