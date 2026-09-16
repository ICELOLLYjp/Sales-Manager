import { getFirebaseState } from "../firebase.js";
import { summarizeEventFlow } from "./eventFlowAccountingService.js?v=20260916-flow-accounting-1";

const TRACKED_CATEGORIES = new Set([
  "tshirt",
  "pierce",
  "earring",
  "drop_pierce",
  "drop_earring"
]);

const REDUCTION_KEYS = [
  ["loss", "紛失"],
  ["theft", "盗難"],
  ["damage", "破損"],
  ["gift", "プレゼント"],
  ["sample", "サンプル"]
];

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

function timestampKey(value) {
  if (!value) return "";
  try {
    if (typeof value.toMillis === "function") return String(value.toMillis());
  } catch {}
  if (Number.isFinite(Number(value?.seconds))) {
    return `${Number(value.seconds)}:${Number(value.nanoseconds || 0)}`;
  }
  return String(value);
}

function sanitizeDocPart(value) {
  return text(value).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120);
}

function parseTshirtInventoryKey(value) {
  const raw = text(value);
  if (!raw.startsWith("tshirt:")) return null;
  const parts = raw.slice(7).split("|").map(part => decodeURIComponent(part));
  if (parts.length !== 4) return null;
  return { bodyId: parts[0], designId: parts[1], colorId: parts[2], sizeId: parts[3] };
}

function parseAccessoryInventoryKey(value) {
  const raw = text(value);
  if (!raw.startsWith("accessory:")) return null;
  const parts = raw.slice(10).split("|").map(part => decodeURIComponent(part));
  if (parts.length !== 2) return null;
  return { sourceId: parts[0], stockField: parts[1] };
}

function readTshirtQty(master, target) {
  return int(master?.inventory_v2?.[target.bodyId]?.[target.designId]?.[target.colorId]?.[target.sizeId]?.qty);
}

function closingItems(session) {
  return Array.isArray(session?.inventoryCount?.closing?.items)
    ? session.inventoryCount.closing.items
    : [];
}

function reductionTotal(closing) {
  return REDUCTION_KEYS.reduce((sum, [key]) => sum + nonNegativeInt(closing?.[key]), 0);
}

function quickUnits(transactions) {
  const result = [];
  (Array.isArray(transactions) ? transactions : [])
    .filter(transaction => transaction?.status !== "voided")
    .forEach(transaction => {
      (Array.isArray(transaction?.items) ? transaction.items : []).forEach((item, itemIndex) => {
        const quantity = nonNegativeInt(item?.quantity);
        const category = text(item?.category);
        if (quantity <= 0 || text(item?.variantId) || !TRACKED_CATEGORIES.has(category)) return;
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
  const cleanSessionId = text(sessionId);
  if (!cleanSessionId) throw new Error("販売セッションが見つかりません。");
  const db = await requireDb();
  const { doc, collection, query, where, getDocFromServer, getDocsFromServer } = await firestoreModule();
  const sessionRef = doc(db, "salesSessions", cleanSessionId);
  const [sessionSnapshot, salesSnapshot] = await Promise.all([
    getDocFromServer(sessionRef),
    getDocsFromServer(query(collection(db, "salesTransactions"), where("sessionId", "==", cleanSessionId)))
  ]);
  if (!sessionSnapshot.exists()) throw new Error("販売セッションが見つかりません。");
  return {
    db,
    sessionRef,
    session: sessionSnapshot.data(),
    transactions: salesSnapshot.docs.map(snapshot => ({ transactionId: snapshot.id, ...snapshot.data() }))
  };
}

function activeUnregisteredItems(session) {
  return (Array.isArray(session?.inventoryCount?.unregisteredItems)
    ? session.inventoryCount.unregisteredItems
    : [])
    .filter(item => text(item?.tempId) && TRACKED_CATEGORIES.has(text(item?.category)))
    .filter(item => !text(item?.linkedVariantId) && text(item?.status || "unregistered") !== "linked");
}

function buildPendingState(session, transactions) {
  const flow = summarizeEventFlow(session);
  const openingRows = flow.adjustedOpeningItems.filter(item =>
    TRACKED_CATEGORIES.has(text(item?.category)) && text(item?.variantId)
  );
  const closing = closingItems(session).filter(item =>
    TRACKED_CATEGORIES.has(text(item?.category)) && text(item?.variantId)
  );
  const closingById = new Map(closing.map(item => [text(item.variantId), item]));
  const rowById = new Map(openingRows.map(item => [text(item.variantId), { ...item }]));

  closing.forEach(item => {
    const variantId = text(item?.variantId);
    if (!variantId || rowById.has(variantId)) return;
    rowById.set(variantId, {
      ...item,
      variantId,
      openingQty: 0,
      label: text(item?.label || item?.sku || variantId),
      detail: text(item?.detail),
      category: text(item?.category),
      inventorySource: text(item?.inventorySource),
      inventoryKey: text(item?.inventoryKey),
      sku: text(item?.sku || variantId)
    });
  });

  const rows = Array.from(rowById.values());
  const exactByVariant = exactSalesByVariant(transactions);
  const units = quickUnits(transactions);
  const unitByKey = new Map(units.map(unit => [unit.allocationKey, unit]));
  const assignedKeys = new Set();
  const manualByVariant = new Map();
  const manualMetaByVariant = new Map();

  (Array.isArray(session?.inventoryCount?.quickAllocations)
    ? session.inventoryCount.quickAllocations
    : []).forEach(allocation => {
      const key = text(allocation?.allocationKey);
      const variantId = text(allocation?.variantId);
      const unit = unitByKey.get(key);
      if (!key || !variantId || !unit || assignedKeys.has(key)) return;
      if (allocation?.category && text(allocation.category) !== unit.category) return;
      const row = rowById.get(variantId);
      const snapshot = row || allocation?.variantSnapshot || null;
      if (!snapshot || text(snapshot?.category) !== unit.category) return;
      assignedKeys.add(key);
      manualByVariant.set(variantId, (manualByVariant.get(variantId) || 0) + 1);
      if (!manualMetaByVariant.has(variantId)) manualMetaByVariant.set(variantId, snapshot);
    });

  const unresolvedUnits = units.filter(unit => !assignedKeys.has(unit.allocationKey));
  const groupMap = new Map();
  unresolvedUnits.forEach(unit => {
    const bodyKey = unit.category === "tshirt" ? unit.tshirtBodyKey : "";
    const groupKey = [unit.category, Number(unit.unitPrice || 0), bodyKey].join("||");
    if (!groupMap.has(groupKey)) {
      groupMap.set(groupKey, {
        groupKey,
        category: unit.category,
        unitPrice: Number(unit.unitPrice || 0),
        tshirtBodyKey: bodyKey,
        quantity: 0,
        allocationKeys: []
      });
    }
    const group = groupMap.get(groupKey);
    group.quantity += 1;
    group.allocationKeys.push(unit.allocationKey);
  });
  const groups = Array.from(groupMap.values()).sort((a, b) =>
    a.category.localeCompare(b.category) || a.unitPrice - b.unitPrice || a.tshirtBodyKey.localeCompare(b.tshirtBodyKey)
  );

  const rowStates = rows.map(row => {
    const variantId = text(row?.variantId);
    const end = closingById.get(variantId) || null;
    const hasCount = Boolean(end && end.closingQty !== null && end.closingQty !== undefined && end.closingQty !== "");
    const exactQty = nonNegativeInt(exactByVariant.get(variantId));
    const manualQuickQty = nonNegativeInt(manualByVariant.get(variantId));
    let difference = null;
    let expectedQty = null;
    let actualQty = null;
    if (hasCount) {
      actualQty = nonNegativeInt(end.closingQty);
      expectedQty =
        nonNegativeInt(row?.openingQty) -
        exactQty -
        manualQuickQty -
        reductionTotal(end) +
        int(end?.stockAdjustment);
      difference = expectedQty - actualQty;
    }
    return {
      row,
      closing: end,
      variantId,
      category: text(row?.category),
      hasCount,
      exactQty,
      manualQuickQty,
      expectedQty,
      actualQty,
      difference
    };
  });

  const rawMovements = [];
  manualByVariant.forEach((quantity, variantId) => {
    if (quantity <= 0) return;
    const meta = rowById.get(variantId) || manualMetaByVariant.get(variantId) || {};
    rawMovements.push({
      variantId,
      category: text(meta?.category),
      label: text(meta?.label || meta?.displayName || meta?.sku || variantId),
      sku: text(meta?.sku || variantId),
      inventorySource: text(meta?.inventorySource),
      inventoryKey: text(meta?.inventoryKey),
      reason: "quick_sale_allocation",
      reasonLabel: "Quick販売配分",
      quantity,
      delta: -quantity
    });
  });

  rowStates.forEach(state => {
    const end = state.closing;
    if (!end) return;
    REDUCTION_KEYS.forEach(([key, label]) => {
      const quantity = nonNegativeInt(end?.[key]);
      if (quantity <= 0) return;
      rawMovements.push({
        variantId: state.variantId,
        category: state.category,
        label: text(state.row?.label || state.row?.sku || state.variantId),
        sku: text(state.row?.sku || state.variantId),
        inventorySource: text(state.row?.inventorySource || end?.inventorySource),
        inventoryKey: text(state.row?.inventoryKey || end?.inventoryKey),
        reason: key,
        reasonLabel: label,
        quantity,
        delta: -quantity
      });
    });
    const adjustment = int(end?.stockAdjustment);
    if (adjustment !== 0) {
      rawMovements.push({
        variantId: state.variantId,
        category: state.category,
        label: text(state.row?.label || state.row?.sku || state.variantId),
        sku: text(state.row?.sku || state.variantId),
        inventorySource: text(state.row?.inventorySource || end?.inventorySource),
        inventoryKey: text(state.row?.inventoryKey || end?.inventoryKey),
        reason: "stock_adjustment",
        reasonLabel: "在庫調整",
        quantity: Math.abs(adjustment),
        delta: adjustment
      });
    }
  });

  const applicableMovements = [];
  const unappliedMovements = [];
  rawMovements.forEach(movement => {
    const source = text(movement.inventorySource);
    const key = text(movement.inventoryKey);
    const valid =
      (source === "tshirt" && Boolean(parseTshirtInventoryKey(key))) ||
      (source === "accessory" && Boolean(parseAccessoryInventoryKey(key)));
    if (valid) applicableMovements.push(movement);
    else unappliedMovements.push({ ...movement, reasonPending: "正式在庫キー未確認" });
  });

  const soldByVariant = {};
  exactByVariant.forEach((quantity, variantId) => {
    soldByVariant[variantId] = nonNegativeInt(quantity);
  });
  manualByVariant.forEach((quantity, variantId) => {
    soldByVariant[variantId] = nonNegativeInt(soldByVariant[variantId]) + nonNegativeInt(quantity);
  });

  const missingRows = rowStates.filter(state => !state.hasCount);
  const countedRows = rowStates.filter(state => state.hasCount);
  const residualRows = countedRows.filter(state => state.difference !== 0);
  const unregistered = activeUnregisteredItems(session);

  return {
    flow,
    rows: rowStates,
    applicableMovements,
    unappliedMovements,
    soldByVariant,
    quickTotal: units.length,
    manualAllocatedTotal: assignedKeys.size,
    unresolvedQuickTotal: unresolvedUnits.length,
    unresolvedQuickGroups: groups,
    missingClosingCount: missingRows.length,
    missingClosingVariantIds: missingRows.map(state => state.variantId),
    countedClosingCount: countedRows.length,
    totalTrackedSkuCount: rowStates.length,
    residualDifferenceCount: residualRows.length,
    residualDifferenceByVariant: residualRows.map(state => ({
      variantId: state.variantId,
      difference: state.difference,
      expectedQty: state.expectedQty,
      actualQty: state.actualQty
    })),
    unregisteredItemCount: unregistered.length,
    unregisteredTempIds: unregistered.map(item => text(item.tempId)),
    unappliedMovementCount: unappliedMovements.length,
    closingComplete: rowStates.length > 0 && missingRows.length === 0
  };
}

export async function loadPendingInventoryCloseSummary({ sessionId }) {
  const loaded = await loadSessionAndSales(sessionId);
  const state = buildPendingState(loaded.session, loaded.transactions);
  return {
    sessionId: text(sessionId),
    sessionStatus: text(loaded.session?.status),
    ...state
  };
}

export async function closeEventWithPendingInventory({
  sessionId,
  closedByEmail = ""
}) {
  const cleanSessionId = text(sessionId);
  const loaded = await loadSessionAndSales(cleanSessionId);
  if (text(loaded.session?.status) === "closed") {
    return {
      sessionId: cleanSessionId,
      status: "closed",
      duplicate: true,
      closeMode: text(loaded.session?.eventCloseMode)
    };
  }
  if (text(loaded.session?.status) !== "pending_allocation") {
    const error = new Error("先にPOSを仮終了してください。棚卸や確認をしない場合でも、その後に未処理を残して正式終了できます。");
    error.code = "provisional-close-required";
    throw error;
  }

  const state = buildPendingState(loaded.session, loaded.transactions);
  if (state.closingComplete) {
    const error = new Error("終了実数はすべて確認済みです。通常の終了または未特定販売を残す終了を使用してください。");
    error.code = "closing-already-complete";
    throw error;
  }

  const {
    doc,
    runTransaction,
    FieldPath,
    serverTimestamp
  } = await firestoreModule();

  const closeId = `eventclose_${sanitizeDocPart(cleanSessionId)}`;
  const lockRef = doc(loaded.db, "transactionLocks", closeId);
  const tshirtMasterRef = doc(loaded.db, "tshirtStock", "master");
  const accessorySharedRef = doc(loaded.db, "accessoryStock", "shared");
  const loadedUpdatedAt = timestampKey(loaded.session?.updatedAt);

  return await runTransaction(loaded.db, async transaction => {
    const [lockSnapshot, currentSessionSnapshot] = await Promise.all([
      transaction.get(lockRef),
      transaction.get(loaded.sessionRef)
    ]);

    if (lockSnapshot.exists() && lockSnapshot.data()?.status === "committed") {
      return {
        sessionId: cleanSessionId,
        closeId,
        status: "closed",
        duplicate: true,
        closeMode: text(currentSessionSnapshot.data()?.eventCloseMode || "closed_with_pending_inventory")
      };
    }

    if (!currentSessionSnapshot.exists()) throw new Error("販売セッションが見つかりません。");
    const current = currentSessionSnapshot.data();
    if (text(current?.status) !== "pending_allocation") {
      throw new Error("イベント状態が変更されました。画面を更新してください。");
    }
    if (timestampKey(current?.updatedAt) !== loadedUpdatedAt) {
      const error = new Error("終了処理の直前に売上・棚卸・配分情報が変更されました。画面を更新してもう一度確認してください。");
      error.code = "event-data-changed";
      throw error;
    }

    const verified = buildPendingState(current, loaded.transactions);
    if (verified.closingComplete) {
      throw new Error("終了実数がすべて確認済みに変わりました。通常の終了処理を使用してください。");
    }

    const tshirtMovements = verified.applicableMovements.filter(row => row.inventorySource === "tshirt");
    const accessoryMovements = verified.applicableMovements.filter(row => row.inventorySource === "accessory");
    const tshirtSnapshot = tshirtMovements.length ? await transaction.get(tshirtMasterRef) : null;
    const accessorySnapshot = accessoryMovements.length ? await transaction.get(accessorySharedRef) : null;
    if (tshirtMovements.length && !tshirtSnapshot?.exists()) throw new Error("Tシャツ実在庫を確認できません。");
    if (accessoryMovements.length && !accessorySnapshot?.exists()) throw new Error("アクセサリー実在庫を確認できません。");

    const tshirtMaster = tshirtSnapshot?.data() || null;
    const tshirtChanges = new Map();
    tshirtMovements.forEach(row => {
      const target = parseTshirtInventoryKey(row.inventoryKey);
      if (!target) return;
      if (!tshirtChanges.has(row.inventoryKey)) {
        tshirtChanges.set(row.inventoryKey, { target, delta: 0, label: row.label });
      }
      tshirtChanges.get(row.inventoryKey).delta += row.delta;
    });
    tshirtChanges.forEach(change => {
      change.currentQty = readTshirtQty(tshirtMaster, change.target);
      change.nextQty = change.currentQty + change.delta;
    });

    const accessoryShared = accessorySnapshot?.data() || null;
    const accessoryDesigns = Array.isArray(accessoryShared?.designs)
      ? accessoryShared.designs.map(item => ({ ...item }))
      : [];
    const accessoryChanges = new Map();
    accessoryMovements.forEach(row => {
      const target = parseAccessoryInventoryKey(row.inventoryKey);
      if (!target) return;
      if (!accessoryChanges.has(row.inventoryKey)) {
        accessoryChanges.set(row.inventoryKey, { target, delta: 0, label: row.label });
      }
      accessoryChanges.get(row.inventoryKey).delta += row.delta;
    });
    accessoryChanges.forEach(change => {
      const index = accessoryDesigns.findIndex(item => text(item?.id) === change.target.sourceId);
      if (index < 0) {
        const error = new Error(`${change.label || "アクセサリー"} の正式実在庫が見つかりません。`);
        error.code = "accessory-stock-missing";
        throw error;
      }
      change.index = index;
      change.currentQty = int(accessoryDesigns[index]?.[change.target.stockField]);
      change.nextQty = change.currentQty + change.delta;
      accessoryDesigns[index][change.target.stockField] = change.nextQty;
    });

    if (tshirtChanges.size) {
      const args = [tshirtMasterRef];
      tshirtChanges.forEach(change => {
        args.push(new FieldPath(
          "inventory_v2",
          change.target.bodyId,
          change.target.designId,
          change.target.colorId,
          change.target.sizeId,
          "qty"
        ));
        args.push(change.nextQty);
      });
      args.push("updatedAt", serverTimestamp());
      transaction.update(...args);
    }

    if (accessoryChanges.size) {
      transaction.update(accessorySharedRef, {
        designs: accessoryDesigns,
        updatedAt: serverTimestamp()
      });
    }

    verified.applicableMovements.forEach((row, index) => {
      const movementId = `${closeId}__pending__${index + 1}__${sanitizeDocPart(row.reason)}`;
      transaction.set(doc(loaded.db, "inventoryMovements", movementId), {
        movementId,
        eventCloseId: closeId,
        sessionId: cleanSessionId,
        type: "adjustment",
        reason: row.reason,
        reasonLabel: row.reasonLabel,
        sourceAction: "event_close_with_pending_inventory",
        category: row.category,
        label: row.label,
        sku: row.sku || null,
        quantity: row.quantity,
        signedQuantity: row.delta,
        expectedInventoryDelta: row.delta,
        appliedInventoryDelta: row.delta,
        inventoryApplied: true,
        eventInventoryApplied: true,
        trackingMode: "sku",
        variantId: row.variantId || null,
        inventoryKey: row.inventoryKey || null,
        inventorySource: row.inventorySource || null,
        status: "applied",
        createdAt: serverTimestamp(),
        createdByEmail: text(closedByEmail)
      });
    });

    const pendingInventory = {
      version: 1,
      status: "closed_with_pending_items",
      source: "manual_close_with_unknowns",
      missingClosingCount: verified.missingClosingCount,
      missingClosingVariantIds: verified.missingClosingVariantIds,
      countedClosingCount: verified.countedClosingCount,
      totalTrackedSkuCount: verified.totalTrackedSkuCount,
      unresolvedQuickTotal: verified.unresolvedQuickTotal,
      unresolvedQuickGroups: verified.unresolvedQuickGroups,
      unregisteredItemCount: verified.unregisteredItemCount,
      unregisteredTempIds: verified.unregisteredTempIds,
      residualDifferenceCount: verified.residualDifferenceCount,
      residualDifferenceByVariant: verified.residualDifferenceByVariant,
      unappliedMovementCount: verified.unappliedMovementCount,
      unappliedMovements: verified.unappliedMovements,
      appliedKnownMovementCount: verified.applicableMovements.length,
      note: "未処理・不明な項目は推測せず、正式在庫へ反映していません。",
      closedByEmail: text(closedByEmail),
      closedAt: serverTimestamp()
    };

    const previousUnidentified = current?.inventoryCount?.unidentifiedQuick || {};
    const unidentifiedQuick = {
      ...previousUnidentified,
      version: Math.max(3, nonNegativeInt(previousUnidentified?.version)),
      status: verified.unresolvedQuickTotal > 0 ? "closed_unidentified" : "resolved",
      source: "inventory_reconciliation",
      quickTotal: verified.quickTotal,
      manualAllocatedTotal: verified.manualAllocatedTotal,
      identifiedTotal: verified.manualAllocatedTotal,
      unresolvedTotal: verified.unresolvedQuickTotal,
      groups: verified.unresolvedQuickGroups,
      autoResolvedCategories: [],
      autoResolvedByVariant: {},
      inventoryNotAppliedTotal: verified.unresolvedQuickTotal,
      residualDifferenceCount: verified.residualDifferenceCount,
      residualDifferenceByVariant: verified.residualDifferenceByVariant,
      closedByEmail: text(closedByEmail),
      closedAt: serverTimestamp()
    };

    const exactSalesTotal = Object.values(verified.soldByVariant)
      .reduce((sum, qty) => sum + nonNegativeInt(qty), 0) - verified.manualAllocatedTotal;

    transaction.update(loaded.sessionRef, {
      status: "closed",
      closedAt: serverTimestamp(),
      closedByEmail: text(closedByEmail),
      eventCloseId: closeId,
      eventCloseMode: "closed_with_pending_inventory",
      eventCloseSummary: {
        skuSalesTotal: Math.max(0, exactSalesTotal) + verified.manualAllocatedTotal,
        quickSalesTotal: verified.quickTotal,
        quickAllocatedTotal: verified.manualAllocatedTotal,
        quickUnresolvedTotal: verified.unresolvedQuickTotal,
        movementCount: verified.applicableMovements.length,
        missingClosingCount: verified.missingClosingCount,
        unregisteredItemCount: verified.unregisteredItemCount,
        unclassifiedDifferenceCount: verified.residualDifferenceCount,
        unappliedMovementCount: verified.unappliedMovementCount,
        reconciliationStatus: "pending_items_remaining"
      },
      "inventoryCount.soldByVariant": verified.soldByVariant,
      "inventoryCount.unidentifiedQuick": unidentifiedQuick,
      "inventoryCount.pendingInventory": pendingInventory,
      "inventoryCount.finalizedAt": serverTimestamp(),
      "inventoryCount.finalizedByEmail": text(closedByEmail),
      "inventoryCount.adjustmentsAppliedAt": serverTimestamp(),
      "inventoryCount.reconciliationStatus": "closed_with_pending_inventory",
      updatedAt: serverTimestamp()
    });

    transaction.set(lockRef, {
      transactionId: closeId,
      action: "event_close_with_pending_inventory",
      sessionId: cleanSessionId,
      status: "committed",
      movementCount: verified.applicableMovements.length,
      missingClosingCount: verified.missingClosingCount,
      quickUnresolvedTotal: verified.unresolvedQuickTotal,
      unregisteredItemCount: verified.unregisteredItemCount,
      createdAt: serverTimestamp()
    });

    return {
      sessionId: cleanSessionId,
      closeId,
      status: "closed",
      duplicate: false,
      closeMode: "closed_with_pending_inventory",
      missingClosingCount: verified.missingClosingCount,
      unresolvedQuickTotal: verified.unresolvedQuickTotal,
      unregisteredItemCount: verified.unregisteredItemCount,
      residualDifferenceCount: verified.residualDifferenceCount,
      unappliedMovementCount: verified.unappliedMovementCount,
      appliedKnownMovementCount: verified.applicableMovements.length
    };
  });
}
