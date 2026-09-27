import { getFirebaseState } from "../firebase.js";
import { commitQuickSale } from "./transactionService.js?v=20260914-event-flow-pos-1";
import { enqueueOfflineSale } from "./offlineQueueService.js?v=20260911-offline-resilience-1";

const CATEGORY = "unclassified";
const TRACKING_MODE = "amount_only";

async function firestoreModule() {
  return await import("https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js");
}

function text(value) {
  return String(value ?? "").trim();
}

function money(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function quantity(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

function makeTransactionId() {
  if (globalThis.crypto?.randomUUID) {
    return `sale_fast_${globalThis.crypto.randomUUID()}`;
  }
  return `sale_fast_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function fastAmountHintLabel(hint) {
  switch (text(hint)) {
    case "tshirt":
      return "未分類売上（Tシャツ）";
    case "accessory":
      return "未分類売上（アクセサリー）";
    case "other":
      return "未分類売上（その他）";
    default:
      return "未分類売上";
  }
}

function hintFromLabel(label) {
  const value = text(label);
  if (value.includes("Tシャツ")) return "tshirt";
  if (value.includes("アクセサリー")) return "accessory";
  if (value.includes("その他")) return "other";
  return "unclassified";
}

export function buildFastAmountSalePayload({
  transactionId = "",
  sessionId,
  amount,
  createdByEmail = "",
  classificationHint = "unclassified"
}) {
  const cleanSessionId = text(sessionId);
  const cleanAmount = money(amount);
  if (!cleanSessionId) throw new Error("販売セッションを選択してください。");
  if (cleanAmount <= 0) throw new Error("金額を入力してください。");

  return {
    transactionId: text(transactionId) || makeTransactionId(),
    sessionId: cleanSessionId,
    items: [
      {
        lineId: "amount_only",
        category: CATEGORY,
        label: fastAmountHintLabel(classificationHint),
        quantity: 1,
        unitPrice: cleanAmount,
        trackingMode: TRACKING_MODE,
        setDiscount: 0,
        manualDiscount: 0
      }
    ],
    orderDiscount: 0,
    createdByEmail: text(createdByEmail)
  };
}

export async function normalizeFastAmountTransaction({
  transactionId,
  classificationHint = ""
}) {
  const { db, enabled } = getFirebaseState();
  if (!enabled || !db) return { adjusted: false, reason: "firebase-unavailable" };

  const {
    doc,
    runTransaction,
    increment,
    serverTimestamp
  } = await firestoreModule();

  const cleanTransactionId = text(transactionId);
  if (!cleanTransactionId) return { adjusted: false, reason: "transaction-missing" };

  const saleRef = doc(db, "salesTransactions", cleanTransactionId);
  const lockRef = doc(db, "transactionLocks", cleanTransactionId);

  return await runTransaction(db, async transaction => {
    const saleSnap = await transaction.get(saleRef);
    if (!saleSnap.exists()) return { adjusted: false, reason: "sale-missing" };

    const sale = saleSnap.data();
    if (sale?.fastAmountAdjusted === true) {
      return { adjusted: false, duplicate: true };
    }

    const items = Array.isArray(sale?.items) ? sale.items : [];
    const amountEntries = items
      .map((item, index) => ({ item, index }))
      .filter(entry => text(entry.item?.trackingMode) === TRACKING_MODE);

    if (!amountEntries.length) {
      return { adjusted: false, reason: "not-fast-amount" };
    }

    const sessionId = text(sale?.sessionId);
    if (!sessionId) throw new Error("最速POS売上のSessionが不明です。");

    const sessionRef = doc(db, "salesSessions", sessionId);
    const movementRefs = amountEntries.map(entry =>
      doc(db, "inventoryMovements", `${cleanTransactionId}__${entry.index + 1}`)
    );

    const sessionSnap = await transaction.get(sessionRef);
    if (!sessionSnap.exists()) throw new Error("販売セッションが見つかりません。");

    const movementSnaps = [];
    for (const movementRef of movementRefs) {
      movementSnaps.push(await transaction.get(movementRef));
    }

    const firstAmountItem = amountEntries[0].item;
    const defaultHint = text(classificationHint) || hintFromLabel(firstAmountItem?.label);
    const knownItems = items.filter(item => text(item?.trackingMode) !== TRACKING_MODE);
    const knownItemCount = knownItems.reduce((sum, item) => sum + quantity(item?.quantity), 0);
    const unknownPlaceholderCount = amountEntries.reduce(
      (sum, entry) => sum + quantity(entry.item?.quantity),
      0
    );
    const amountOnly = knownItems.length === 0;

    const nextItems = items.map(item => {
      if (text(item?.trackingMode) !== TRACKING_MODE) return item;
      const itemHint = text(classificationHint) || hintFromLabel(item?.label) || defaultHint;
      return {
        ...item,
        category: CATEGORY,
        label: fastAmountHintLabel(itemHint),
        physicalQuantityKnown: false,
        inventoryApplied: false,
        eventInventoryApplied: false,
        reconciliationStatus: "unclassified"
      };
    });

    const saleUpdate = {
      mode: amountOnly ? "amount_only" : "mixed",
      items: nextItems,
      itemCount: knownItemCount,
      itemCountKnown: false,
      amountOnly,
      fastAmountAdjusted: true,
      classificationStatus: amountOnly ? "unclassified" : "partial",
      classificationHint: defaultHint,
      requiresClassification: true,
      inventoryMode: amountOnly ? "unclassified" : "mixed",
      reconciliationStatus: amountOnly ? "unclassified" : "partial",
      updatedAt: serverTimestamp()
    };

    if (amountOnly) {
      Object.assign(saleUpdate, {
        inventoryApplied: false,
        costSnapshotComplete: false,
        costSnapshotCoveredQuantity: 0,
        costSnapshotMissingQuantity: 0
      });
    } else {
      saleUpdate.costSnapshotComplete = false;
    }

    transaction.update(saleRef, saleUpdate);

    const sessionUpdate = {
      "salesSummary.unclassifiedTransactionCount": increment(1),
      updatedAt: serverTimestamp()
    };

    if (unknownPlaceholderCount > 0) {
      sessionUpdate["salesSummary.itemCount"] = increment(-unknownPlaceholderCount);
    }

    transaction.update(sessionRef, sessionUpdate);

    amountEntries.forEach((entry, offset) => {
      const movementSnap = movementSnaps[offset];
      if (!movementSnap?.exists()) return;
      const itemHint = text(classificationHint) || hintFromLabel(entry.item?.label) || defaultHint;
      transaction.set(
        movementRefs[offset],
        {
          category: CATEGORY,
          label: fastAmountHintLabel(itemHint),
          quantity: 0,
          expectedInventoryDelta: 0,
          appliedInventoryDelta: 0,
          inventoryApplied: false,
          eventInventoryApplied: false,
          trackingMode: TRACKING_MODE,
          variantId: null,
          inventoryKey: null,
          inventorySource: null,
          status: "unclassified",
          physicalQuantityKnown: false
        },
        { merge: true }
      );
    });

    transaction.set(
      lockRef,
      {
        fastAmountAdjusted: true,
        fastAmountAdjustedAt: serverTimestamp()
      },
      { merge: true }
    );

    return {
      adjusted: true,
      sessionId,
      amountOnly,
      knownItemCount,
      unknownPlaceholderCount
    };
  });
}

export async function commitFastAmountSale({
  transactionId = "",
  sessionId,
  amount,
  createdByEmail = "",
  classificationHint = "unclassified",
  paymentMethod = "manual",
  paymentProvider = "",
  providerPaymentIntentId = "",
  providerCheckoutSessionId = "",
  providerPaymentStatus = ""
}) {
  const salePayload = buildFastAmountSalePayload({
    transactionId,
    sessionId,
    amount,
    createdByEmail,
    classificationHint
  });

  const result = await commitQuickSale({
    ...salePayload,
    paymentMethod,
    paymentProvider,
    providerPaymentIntentId,
    providerCheckoutSessionId,
    providerPaymentStatus
  });

  await normalizeFastAmountTransaction({
    transactionId: salePayload.transactionId,
    classificationHint
  });

  return {
    ...result,
    transactionId: salePayload.transactionId,
    amountOnly: true,
    classificationStatus: "unclassified"
  };
}

export function queueFastAmountSale({
  transactionId = "",
  sessionId,
  amount,
  createdByEmail = "",
  classificationHint = "unclassified",
  currency = ""
}) {
  const sale = buildFastAmountSalePayload({
    transactionId,
    sessionId,
    amount,
    createdByEmail,
    classificationHint
  });

  const row = enqueueOfflineSale({
    sale,
    display: {
      kind: "amount_only",
      currency: text(currency),
      amount: money(amount),
      label: fastAmountHintLabel(classificationHint)
    }
  });

  return {
    ...row,
    transactionId: sale.transactionId
  };
}

export async function normalizeFastAmountSalesForSession(sessionId) {
  const cleanSessionId = text(sessionId);
  const { db, enabled } = getFirebaseState();
  if (!cleanSessionId || !enabled || !db || !navigator.onLine) return { adjusted: 0 };

  const {
    collection,
    query,
    where,
    getDocsFromServer
  } = await firestoreModule();

  const snapshot = await getDocsFromServer(
    query(collection(db, "salesTransactions"), where("sessionId", "==", cleanSessionId))
  );

  let adjusted = 0;
  for (const docSnap of snapshot.docs) {
    const data = docSnap.data();
    if (data?.fastAmountAdjusted === true) continue;
    const amountItem = (Array.isArray(data?.items) ? data.items : [])
      .find(item => text(item?.trackingMode) === TRACKING_MODE);
    if (!amountItem) continue;

    const result = await normalizeFastAmountTransaction({
      transactionId: docSnap.id,
      classificationHint: hintFromLabel(amountItem?.label)
    });
    if (result?.adjusted) adjusted += 1;
  }

  return { adjusted };
}
