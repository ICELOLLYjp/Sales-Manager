import { getFirebaseState } from "../firebase.js";
import * as base from "./eventCloseService.js?v=20260915-quick-allocation-list-1";

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

function openingItems(session) {
  return Array.isArray(session?.inventoryCount?.opening?.items)
    ? session.inventoryCount.opening.items
    : [];
}

function closingItems(session) {
  return Array.isArray(session?.inventoryCount?.closing?.items)
    ? session.inventoryCount.closing.items
    : [];
}

function quickUnits(transactions) {
  const units = new Map();

  (Array.isArray(transactions) ? transactions : [])
    .filter(transaction => transaction?.status !== "voided")
    .forEach(transaction => {
      (Array.isArray(transaction?.items) ? transaction.items : []).forEach((item, itemIndex) => {
        const quantity = nonNegativeInt(item?.quantity);
        const category = text(item?.category);
        const variantId = text(item?.variantId);
        if (quantity <= 0 || variantId || !TRACKED_CATEGORIES.has(category)) return;

        for (let unitIndex = 0; unitIndex < quantity; unitIndex += 1) {
          const allocationKey = `${text(transaction?.transactionId)}:${itemIndex}:${unitIndex}`;
          units.set(allocationKey, {
            allocationKey,
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

  return units;
}

function registeredVariantSnapshot(id, data) {
  const variantId = text(data?.variantId || id);
  const category = text(data?.category);
  const inventorySource = text(data?.inventorySource);
  const inventoryKey = text(data?.inventoryKey);

  if (!variantId || !TRACKED_CATEGORIES.has(category)) return null;
  if (data?.active === false || data?.saleStatus === "inactive") return null;
  if (!inventoryKey || !["tshirt", "accessory"].includes(inventorySource)) return null;

  const label = text(data?.displayName || data?.design || data?.name || data?.sku || variantId);
  const detail = [
    data?.body,
    data?.color,
    data?.size,
    data?.variant
  ].map(text).filter(Boolean).join(" / ");

  return {
    variantId,
    category,
    label,
    detail,
    sku: text(data?.sku || variantId),
    inventorySource,
    inventoryKey,
    bodyId: text(data?.bodyId),
    designId: text(data?.designId),
    colorId: text(data?.colorId),
    sizeId: text(data?.sizeId)
  };
}

function openingSnapshot(item) {
  return {
    variantId: text(item?.variantId),
    category: text(item?.category),
    label: text(item?.label),
    detail: text(item?.detail),
    sku: text(item?.sku),
    inventorySource: text(item?.inventorySource),
    inventoryKey: text(item?.inventoryKey),
    bodyId: text(item?.bodyId),
    designId: text(item?.designId),
    colorId: text(item?.colorId),
    sizeId: text(item?.sizeId)
  };
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

export async function saveEventQuickAllocations({
  sessionId,
  allocations = [],
  savedByEmail = ""
}) {
  const cleanSessionId = text(sessionId);
  if (!cleanSessionId) throw new Error("販売セッションが見つかりません。");

  const { db, sessionRef, session, transactions } = await loadSessionAndSales(cleanSessionId);
  if (session?.status !== "open" && session?.status !== "pending_allocation") {
    throw new Error("正式終了済みのイベントではQuick配分を変更できません。");
  }

  const {
    collection,
    getDocsFromServer,
    updateDoc,
    serverTimestamp
  } = await firestoreModule();

  const variantSnapshot = await getDocsFromServer(collection(db, "productVariants"));
  const registeredById = new Map();
  variantSnapshot.docs.forEach(snapshot => {
    const normalized = registeredVariantSnapshot(snapshot.id, snapshot.data());
    if (normalized) registeredById.set(normalized.variantId, normalized);
  });

  const originalOpening = openingItems(session);
  const openingById = new Map(
    originalOpening.map(item => [text(item?.variantId), openingSnapshot(item)])
  );
  const units = quickUnits(transactions);
  const normalized = [];
  const usedKeys = new Set();

  (Array.isArray(allocations) ? allocations : []).forEach(item => {
    const allocationKey = text(item?.allocationKey);
    const variantId = text(item?.variantId);
    const unit = units.get(allocationKey);
    if (!unit || !variantId || usedKeys.has(allocationKey)) return;

    const fromOpening = openingById.get(variantId) || null;
    const variant = fromOpening || registeredById.get(variantId) || null;
    if (!variant || text(variant.category) !== unit.category) return;

    usedKeys.add(allocationKey);
    normalized.push({
      allocationKey,
      transactionId: unit.transactionId,
      itemIndex: unit.itemIndex,
      unitIndex: unit.unitIndex,
      category: unit.category,
      unitPrice: unit.unitPrice,
      variantId,
      outsideOpening: !fromOpening,
      variantSnapshot: variant
    });
  });

  await updateDoc(sessionRef, {
    "inventoryCount.quickAllocations": normalized,
    "inventoryCount.quickAllocationsSavedAt": serverTimestamp(),
    "inventoryCount.quickAllocationsSavedByEmail": text(savedByEmail),
    updatedAt: serverTimestamp()
  });

  return {
    sessionId: cleanSessionId,
    savedCount: normalized.length,
    totalCount: units.size,
    outsideOpeningCount: normalized.filter(item => item.outsideOpening).length
  };
}

function reductionTotal(closing) {
  return ["loss", "theft", "damage", "gift", "sample"]
    .reduce((sum, key) => sum + nonNegativeInt(closing?.[key]), 0);
}

function exactSalesByVariant(transactions) {
  const map = new Map();
  (Array.isArray(transactions) ? transactions : [])
    .filter(transaction => transaction?.status !== "voided")
    .forEach(transaction => {
      (Array.isArray(transaction?.items) ? transaction.items : []).forEach(item => {
        const variantId = text(item?.variantId);
        const quantity = nonNegativeInt(item?.quantity);
        if (!variantId || quantity <= 0) return;
        map.set(variantId, (map.get(variantId) || 0) + quantity);
      });
    });
  return map;
}

export async function finalizeEventSession({
  sessionId,
  closedByEmail = ""
}) {
  const cleanSessionId = text(sessionId);
  if (!cleanSessionId) throw new Error("販売セッションが見つかりません。");

  const loaded = await loadSessionAndSales(cleanSessionId);
  const { sessionRef, session, transactions } = loaded;

  if (session?.status === "closed") {
    return await base.finalizeEventSession({ sessionId: cleanSessionId, closedByEmail });
  }

  const allocations = Array.isArray(session?.inventoryCount?.quickAllocations)
    ? session.inventoryCount.quickAllocations
    : [];
  const outsideAllocations = allocations.filter(item => item?.outsideOpening && item?.variantSnapshot);

  if (!outsideAllocations.length) {
    return await base.finalizeEventSession({ sessionId: cleanSessionId, closedByEmail });
  }

  const originalOpening = Array.isArray(session?.inventoryCount?.eventAdditionRecovery?.originalOpeningItems)
    ? session.inventoryCount.eventAdditionRecovery.originalOpeningItems
    : openingItems(session);
  const originalIds = new Set(originalOpening.map(item => text(item?.variantId)));
  const closingMap = new Map(
    closingItems(session).map(item => [text(item?.variantId), item])
  );
  const exactByVariant = exactSalesByVariant(transactions);
  const grouped = new Map();

  outsideAllocations.forEach(allocation => {
    const variantId = text(allocation?.variantId);
    if (!variantId || originalIds.has(variantId)) return;
    if (!grouped.has(variantId)) {
      grouped.set(variantId, {
        snapshot: allocation.variantSnapshot,
        quickQty: 0
      });
    }
    grouped.get(variantId).quickQty += 1;
  });

  if (!grouped.size) {
    return await base.finalizeEventSession({ sessionId: cleanSessionId, closedByEmail });
  }

  const syntheticRows = [];
  const eventAdditions = [];

  grouped.forEach((group, variantId) => {
    const closing = closingMap.get(variantId);
    if (!closing || closing.closingQty === null || closing.closingQty === undefined || closing.closingQty === "") {
      const label = text(group.snapshot?.label || group.snapshot?.sku || variantId);
      const error = new Error(`${label} は開始在庫外から配分されています。終了実数を入力してから正式確定してください。`);
      error.code = "outside-opening-closing-missing";
      throw error;
    }

    const closingQty = nonNegativeInt(closing.closingQty);
    const exactQty = nonNegativeInt(exactByVariant.get(variantId));
    const reductions = reductionTotal(closing);
    const adjustment = int(closing.stockAdjustment);
    const addedQty = Math.max(
      0,
      closingQty + group.quickQty + exactQty + reductions - adjustment
    );

    const snapshot = group.snapshot || {};
    syntheticRows.push({
      ...snapshot,
      variantId,
      openingQty: addedQty,
      eventAddedQty: addedQty,
      addedDuringEvent: true,
      source: "quick_outside_opening_reconstruction"
    });

    eventAdditions.push({
      variantId,
      category: text(snapshot.category),
      label: text(snapshot.label),
      detail: text(snapshot.detail),
      sku: text(snapshot.sku),
      inventorySource: text(snapshot.inventorySource),
      inventoryKey: text(snapshot.inventoryKey),
      quantity: addedQty,
      quickAllocatedQty: group.quickQty,
      exactSalesQty: exactQty,
      closingQty,
      recordedReductionQty: reductions,
      stockAdjustment: adjustment,
      source: "quick_outside_opening_reconstruction"
    });
  });

  const originalOpeningTotal = originalOpening.reduce(
    (sum, item) => sum + nonNegativeInt(item?.openingQty),
    0
  );
  const eventAddedTotal = eventAdditions.reduce(
    (sum, item) => sum + nonNegativeInt(item?.quantity),
    0
  );

  const {
    updateDoc,
    serverTimestamp,
    deleteField
  } = await firestoreModule();

  await updateDoc(sessionRef, {
    "inventoryCount.opening.items": [
      ...originalOpening,
      ...syntheticRows
    ],
    "inventoryCount.eventAdditions": eventAdditions,
    "inventoryCount.eventAdditionRecovery": {
      originalOpeningItems: originalOpening,
      preparedAt: serverTimestamp(),
      preparedByEmail: text(closedByEmail)
    },
    updatedAt: serverTimestamp()
  });

  try {
    const result = await base.finalizeEventSession({
      sessionId: cleanSessionId,
      closedByEmail
    });

    await updateDoc(sessionRef, {
      "inventoryCount.opening.items": originalOpening,
      "inventoryCount.eventAdditions": eventAdditions,
      "inventoryCount.eventAdditionRecovery": deleteField(),
      "eventCloseSummary.openingTotal": originalOpeningTotal,
      "eventCloseSummary.eventAddedTotal": eventAddedTotal,
      "eventCloseSummary.reconciledOpeningTotal": originalOpeningTotal + eventAddedTotal,
      updatedAt: serverTimestamp()
    });

    return {
      ...result,
      eventAddedTotal,
      outsideOpeningSkuCount: eventAdditions.length
    };
  } catch (error) {
    try {
      await updateDoc(sessionRef, {
        "inventoryCount.opening.items": originalOpening,
        "inventoryCount.eventAdditions": eventAdditions,
        "inventoryCount.eventAdditionRecovery": deleteField(),
        updatedAt: serverTimestamp()
      });
    } catch {
      // Recovery data remains on the session if the restore write also fails.
    }
    throw error;
  }
}

export async function provisionallyCloseEventSession(args) {
  return await base.provisionallyCloseEventSession(args);
}
