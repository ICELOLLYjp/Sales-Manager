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

function makeTransactionId() {
  if (globalThis.crypto?.randomUUID) {
    return `sale_fast_${globalThis.crypto.randomUUID()}`;
  }
  return `sale_fast_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function hintLabel(hint) {
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
        label: hintLabel(classificationHint),
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

async function normalizeFastAmountTransaction({
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

  const saleRef = doc(db, "salesTransactions", transactionId);
  const lockRef = doc(db, "transactionLocks", transactionId);
  const movementRef = doc(db, "inventoryMovements", `${transactionId}__1`);

  return await runTransaction(db, async transaction => {
    const saleSnap = await transaction.get(saleRef);
    if (!saleSnap.exists()) return { adjusted: false, reason: "sale-missing" };

    const sale = saleSnap.data();
    if (sale?.fastAmountAdjusted === true) {
      return { adjusted: false, duplicate: true };
    }

    const items = Array.isArray(sale?.items) ? sale.items : [];
    const amountItem = items.find(item => text(item?.trackingMode) === TRACKING_MODE);
    if (!amountItem) return { adjusted: false, reason: "not-fast-amount" };

    const sessionId = text(sale?.sessionId);
    if (!sessionId) throw new Error("最速POS売上のSessionが不明です。");

    const sessionRef = doc(db, "salesSessions", sessionId);
    const sessionSnap = await transaction.get(sessionRef);
    if (!sessionSnap.exists()) throw new Error("販売セッションが見つかりません。");

    const movementSnap = await transaction.get(movementRef);
    const hint = text(classificationHint) || hintFromLabel(amountItem?.label);

    const nextItems = items.map(item => {
      if (text(item?.trackingMode) !== TRACKING_MODE) return item;
      return {
        ...item,
        category: CATEGORY,
        label: hintLabel(hint),
        physicalQuantityKnown: false,
        inventoryApplied: false,
        eventInventoryApplied: false,
        reconciliationStatus: "unclassified"
      };
    });

    transaction.update(saleRef, {
      mode: "amount_only",
      items: nextItems,
      itemCount: 0,
      itemCountKnown: false,
      amountOnly: true,
      fastAmountAdjusted: true,
      classificationStatus: "unclassified",
      classificationHint: hint,
      requiresClassification: true,
      inventoryMode: "unclassified",
      inventoryApplied: false,
      reconciliationStatus: "unclassified",
      costSnapshotComplete: false,
      costSnapshotCoveredQuantity: 0,
      costSnapshotMissingQuantity: 0,
      updatedAt: serverTimestamp()
    });

    transaction.update(sessionRef, {
      "salesSummary.itemCount": increment(-1),
      "salesSummary.unclassifiedTransactionCount": increment(1),
      updatedAt: serverTimestamp()
    });

    if (movementSnap.exists()) {
      transaction.set(
        movementRef,
        {
          category: CATEGORY,
          label: hintLabel(hint),
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
    }

    transaction.set(
      lockRef,
      {
        fastAmountAdjusted: true,
        fastAmountAdjustedAt: serverTimestamp()
      },
      { merge: true }
    );

    return { adjusted: true, sessionId };
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
      label: hintLabel(classificationHint)
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
