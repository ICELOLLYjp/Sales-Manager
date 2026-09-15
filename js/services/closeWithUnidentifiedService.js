import { getFirebaseState } from "../firebase.js";

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
  return String(value || "").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120);
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
  return Math.max(0, Number(
    master?.inventory_v2?.[target.bodyId]?.[target.designId]?.[target.colorId]?.[target.sizeId]?.qty || 0
  ));
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

function reductionTotal(closing) {
  return REDUCTION_KEYS.reduce((sum, [key]) => sum + nonNegativeInt(closing?.[key]), 0);
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

function buildReconciliation(session, transactions) {
  const opening = openingItems(session).filter(item => TRACKED_CATEGORIES.has(text(item?.category)));
  const openingById = new Map(opening.map(item => [text(item?.variantId), item]));
  const closingById = new Map(closingItems(session).map(item => [text(item?.variantId), item]));
  const exactByVariant = exactSalesByVariant(transactions);
  const units = quickUnits(transactions);
  const unitByKey = new Map(units.map(unit => [unit.allocationKey, unit]));

  if (!opening.length) throw new Error("開始在庫が保存されていません。");

  const incomplete = opening.filter(item => {
    const closing = closingById.get(text(item?.variantId));
    return !closing || closing.closingQty === null || closing.closingQty === undefined || closing.closingQty === "";
  });
  if (incomplete.length) {
    const error = new Error(`終了在庫が未入力のSKUが ${incomplete.length} 件あります。棚卸を確定してから終了してください。`);
    error.code = "closing-count-incomplete";
    throw error;
  }

  const assignedKeys = new Set();
  const manualByVariant = new Map();
  const manualByCategory = new Map();
  const manualMetaByVariant = new Map();

  (Array.isArray(session?.inventoryCount?.quickAllocations)
    ? session.inventoryCount.quickAllocations
    : []).forEach(allocation => {
      const key = text(allocation?.allocationKey);
      const variantId = text(allocation?.variantId);
      const unit = unitByKey.get(key);
      if (!key || !variantId || !unit || assignedKeys.has(key)) return;
      if (allocation?.category && text(allocation.category) !== unit.category) return;

      const openingItem = openingById.get(variantId);
      const snapshot = openingItem || allocation?.variantSnapshot || null;
      if (!snapshot || text(snapshot?.category) !== unit.category) return;

      assignedKeys.add(key);
      manualByVariant.set(variantId, (manualByVariant.get(variantId) || 0) + 1);
      manualByCategory.set(unit.category, (manualByCategory.get(unit.category) || 0) + 1);
      if (!manualMetaByVariant.has(variantId)) manualMetaByVariant.set(variantId, snapshot);
    });

  const remainingUnits = units.filter(unit => !assignedKeys.has(unit.allocationKey));
  const remainingByCategory = new Map();
  remainingUnits.forEach(unit => {
    remainingByCategory.set(unit.category, (remainingByCategory.get(unit.category) || 0) + 1);
  });

  const rows = opening.map(item => {
    const variantId = text(item?.variantId);
    const closing = closingById.get(variantId);
    const exactQty = nonNegativeInt(exactByVariant.get(variantId));
    const manualQuickQty = nonNegativeInt(manualByVariant.get(variantId));
    const actualQty = nonNegativeInt(closing?.closingQty);
    const expectedBeforeAuto =
      nonNegativeInt(item?.openingQty) -
      exactQty -
      manualQuickQty -
      reductionTotal(closing) +
      int(closing?.stockAdjustment);
    const differenceBeforeAuto = expectedBeforeAuto - actualQty;

    return {
      opening: item,
      closing,
      variantId,
      category: text(item?.category),
      exactQty,
      manualQuickQty,
      autoQuickQty: 0,
      actualQty,
      expectedBeforeAuto,
      differenceBeforeAuto,
      differenceAfterAuto: differenceBeforeAuto
    };
  });

  const autoResolvedCategories = new Set();
  const autoByVariant = new Map();

  remainingByCategory.forEach((remainingQty, category) => {
    if (remainingQty <= 0) return;
    const categoryRows = rows.filter(row => row.category === category);
    const hasNegativeDifference = categoryRows.some(row => row.differenceBeforeAuto < 0);
    const positiveGapTotal = categoryRows.reduce(
      (sum, row) => sum + Math.max(0, row.differenceBeforeAuto),
      0
    );

    if (!hasNegativeDifference && positiveGapTotal === remainingQty) {
      autoResolvedCategories.add(category);
      categoryRows.forEach(row => {
        const quantity = Math.max(0, row.differenceBeforeAuto);
        if (quantity > 0) autoByVariant.set(row.variantId, quantity);
      });
    }
  });

  rows.forEach(row => {
    row.autoQuickQty = nonNegativeInt(autoByVariant.get(row.variantId));
    row.differenceAfterAuto = row.differenceBeforeAuto - row.autoQuickQty;
  });

  const unresolvedUnits = remainingUnits.filter(unit => !autoResolvedCategories.has(unit.category));
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
    a.category.localeCompare(b.category) ||
    a.unitPrice - b.unitPrice ||
    a.tshirtBodyKey.localeCompare(b.tshirtBodyKey)
  );

  const movements = [];

  rows.forEach(row => {
    const quickQty = row.manualQuickQty + row.autoQuickQty;
    if (quickQty > 0) {
      movements.push({
        variantId: row.variantId,
        category: row.category,
        label: text(row.opening?.label),
        sku: text(row.opening?.sku),
        inventorySource: text(row.opening?.inventorySource),
        inventoryKey: text(row.opening?.inventoryKey),
        reason: row.autoQuickQty > 0 && row.manualQuickQty === 0
          ? "quick_sale_auto_reconciliation"
          : "quick_sale_allocation",
        reasonLabel: row.autoQuickQty > 0 && row.manualQuickQty === 0
          ? "Quick販売・棚卸自動特定"
          : "Quick販売配分",
        quantity: quickQty,
        delta: -quickQty
      });
    }

    REDUCTION_KEYS.forEach(([key, label]) => {
      const quantity = nonNegativeInt(row.closing?.[key]);
      if (quantity <= 0) return;
      movements.push({
        variantId: row.variantId,
        category: row.category,
        label: text(row.opening?.label),
        sku: text(row.opening?.sku),
        inventorySource: text(row.opening?.inventorySource),
        inventoryKey: text(row.opening?.inventoryKey),
        reason: key,
        reasonLabel: label,
        quantity,
        delta: -quantity
      });
    });

    const adjustment = int(row.closing?.stockAdjustment);
    if (adjustment !== 0) {
      movements.push({
        variantId: row.variantId,
        category: row.category,
        label: text(row.opening?.label),
        sku: text(row.opening?.sku),
        inventorySource: text(row.opening?.inventorySource),
        inventoryKey: text(row.opening?.inventoryKey),
        reason: "stock_adjustment",
        reasonLabel: "在庫調整",
        quantity: Math.abs(adjustment),
        delta: adjustment
      });
    }
  });

  manualByVariant.forEach((quantity, variantId) => {
    if (openingById.has(variantId) || quantity <= 0) return;
    const snapshot = manualMetaByVariant.get(variantId) || {};
    movements.push({
      variantId,
      category: text(snapshot?.category),
      label: text(snapshot?.label || snapshot?.displayName),
      sku: text(snapshot?.sku),
      inventorySource: text(snapshot?.inventorySource),
      inventoryKey: text(snapshot?.inventoryKey),
      reason: "quick_sale_allocation",
      reasonLabel: "Quick販売配分",
      quantity,
      delta: -quantity
    });
  });

  const soldByVariant = {};
  exactByVariant.forEach((quantity, variantId) => {
    soldByVariant[variantId] = nonNegativeInt(quantity);
  });
  manualByVariant.forEach((quantity, variantId) => {
    soldByVariant[variantId] = nonNegativeInt(soldByVariant[variantId]) + nonNegativeInt(quantity);
  });
  autoByVariant.forEach((quantity, variantId) => {
    soldByVariant[variantId] = nonNegativeInt(soldByVariant[variantId]) + nonNegativeInt(quantity);
  });

  const openingTotal = rows.reduce((sum, row) => sum + nonNegativeInt(row.opening?.openingQty), 0);
  const closingTotal = rows.reduce((sum, row) => sum + row.actualQty, 0);
  const reductionTotalValue = rows.reduce((sum, row) => sum + reductionTotal(row.closing), 0);
  const stockAdjustmentTotal = rows.reduce((sum, row) => sum + int(row.closing?.stockAdjustment), 0);
  const exactSalesTotal = Array.from(exactByVariant.values()).reduce((sum, qty) => sum + nonNegativeInt(qty), 0);
  const manualAllocatedTotal = assignedKeys.size;
  const autoResolvedTotal = Array.from(autoByVariant.values()).reduce((sum, qty) => sum + nonNegativeInt(qty), 0);
  const identifiedQuickTotal = manualAllocatedTotal + autoResolvedTotal;
  const residualDifferenceRows = rows.filter(row => row.differenceAfterAuto !== 0);

  return {
    rows,
    movements,
    soldByVariant,
    groups,
    unresolvedUnits,
    autoResolvedCategories: Array.from(autoResolvedCategories),
    autoByVariant: Object.fromEntries(autoByVariant),
    openingTotal,
    closingTotal,
    reductionTotal: reductionTotalValue,
    stockAdjustmentTotal,
    exactSalesTotal,
    quickSalesTotal: units.length,
    manualAllocatedTotal,
    autoResolvedTotal,
    identifiedQuickTotal,
    unresolvedTotal: unresolvedUnits.length,
    residualDifferenceCount: residualDifferenceRows.length,
    residualDifferenceByVariant: residualDifferenceRows.map(row => ({
      variantId: row.variantId,
      difference: row.differenceAfterAuto,
      expectedQty: row.actualQty + row.differenceAfterAuto,
      actualQty: row.actualQty
    }))
  };
}

export async function closeEventWithUnidentified({
  sessionId,
  closedByEmail = ""
}) {
  const cleanSessionId = text(sessionId);
  if (!cleanSessionId) throw new Error("販売セッションが見つかりません。");

  const loaded = await loadSessionAndSales(cleanSessionId);
  if (loaded.session?.status === "closed") {
    return {
      sessionId: cleanSessionId,
      status: "closed",
      duplicate: true,
      unresolvedTotal: nonNegativeInt(loaded.session?.inventoryCount?.unidentifiedQuick?.unresolvedTotal)
    };
  }

  if (loaded.session?.status !== "pending_allocation") {
    const error = new Error("先に「未解決を残して仮終了」を行ってください。仮終了後に未特定ありで正式終了できます。");
    error.code = "provisional-close-required";
    throw error;
  }

  const reconciliation = buildReconciliation(loaded.session, loaded.transactions);
  if (reconciliation.unresolvedTotal <= 0) {
    const error = new Error("未特定販売は残っていません。通常の「イベントを終了して在庫を確定」を使用してください。");
    error.code = "no-unidentified-sales";
    throw error;
  }

  const unsupported = reconciliation.movements.filter(row =>
    !["tshirt", "accessory"].includes(text(row?.inventorySource)) || !text(row?.inventoryKey)
  );
  if (unsupported.length) {
    const error = new Error("在庫へ安全に反映できない特定済みSKUがあります。商品登録を確認してください。");
    error.code = "unsupported-inventory-source";
    throw error;
  }

  const db = loaded.db;
  const {
    doc,
    runTransaction,
    FieldPath,
    serverTimestamp
  } = await firestoreModule();

  const sessionRef = loaded.sessionRef;
  const closeId = `eventclose_${sanitizeDocPart(cleanSessionId)}`;
  const lockRef = doc(db, "transactionLocks", closeId);
  const tshirtMasterRef = doc(db, "tshirtStock", "master");
  const accessorySharedRef = doc(db, "accessoryStock", "shared");
  const loadedUpdatedAt = timestampKey(loaded.session?.updatedAt);

  return await runTransaction(db, async transaction => {
    const [lockSnapshot, currentSessionSnapshot] = await Promise.all([
      transaction.get(lockRef),
      transaction.get(sessionRef)
    ]);

    if (lockSnapshot.exists() && lockSnapshot.data()?.status === "committed") {
      return {
        sessionId: cleanSessionId,
        closeId,
        status: "closed",
        duplicate: true,
        unresolvedTotal: reconciliation.unresolvedTotal
      };
    }

    if (!currentSessionSnapshot.exists()) throw new Error("販売セッションが見つかりません。");
    const currentSession = currentSessionSnapshot.data();
    if (currentSession?.status !== "pending_allocation") {
      throw new Error("イベント状態が変更されました。画面を更新してもう一度確認してください。");
    }
    if (timestampKey(currentSession?.updatedAt) !== loadedUpdatedAt) {
      const error = new Error("終了処理の直前に配分または棚卸データが変更されました。画面を更新してもう一度確認してください。");
      error.code = "event-data-changed";
      throw error;
    }

    const tshirtMovements = reconciliation.movements.filter(row => row.inventorySource === "tshirt");
    const accessoryMovements = reconciliation.movements.filter(row => row.inventorySource === "accessory");

    const tshirtSnapshot = tshirtMovements.length ? await transaction.get(tshirtMasterRef) : null;
    const accessorySnapshot = accessoryMovements.length ? await transaction.get(accessorySharedRef) : null;

    if (tshirtMovements.length && !tshirtSnapshot?.exists()) throw new Error("Tシャツ実在庫を確認できません。");
    if (accessoryMovements.length && !accessorySnapshot?.exists()) throw new Error("アクセサリー実在庫を確認できません。");

    const tshirtMaster = tshirtSnapshot?.data() || null;
    const tshirtChanges = new Map();

    tshirtMovements.forEach(row => {
      const target = parseTshirtInventoryKey(row.inventoryKey);
      if (!target) throw new Error(`${row.label || row.sku || "Tシャツ"} の在庫キーが不正です。`);
      if (!tshirtChanges.has(row.inventoryKey)) {
        tshirtChanges.set(row.inventoryKey, { target, delta: 0, label: row.label || row.sku || "Tシャツ" });
      }
      tshirtChanges.get(row.inventoryKey).delta += row.delta;
    });

    tshirtChanges.forEach(change => {
      const currentQty = readTshirtQty(tshirtMaster, change.target);
      const nextQty = currentQty + change.delta;
      if (nextQty < 0) {
        const error = new Error(`${change.label} の正式実在庫が不足しています。現在 ${currentQty} 点、反映予定 ${change.delta} 点です。`);
        error.code = "stock-insufficient";
        throw error;
      }
      change.currentQty = currentQty;
      change.nextQty = nextQty;
    });

    const accessoryShared = accessorySnapshot?.data() || null;
    let accessoryDesigns = Array.isArray(accessoryShared?.designs)
      ? accessoryShared.designs.map(item => ({ ...item }))
      : [];
    const accessoryChanges = new Map();

    accessoryMovements.forEach(row => {
      const target = parseAccessoryInventoryKey(row.inventoryKey);
      if (!target) throw new Error(`${row.label || row.sku || "アクセサリー"} の在庫キーが不正です。`);
      if (!accessoryChanges.has(row.inventoryKey)) {
        accessoryChanges.set(row.inventoryKey, { target, delta: 0, label: row.label || row.sku || "アクセサリー" });
      }
      accessoryChanges.get(row.inventoryKey).delta += row.delta;
    });

    accessoryChanges.forEach(change => {
      const index = accessoryDesigns.findIndex(design => text(design?.id) === change.target.sourceId);
      if (index < 0) throw new Error(`${change.label} のアクセサリー実在庫が見つかりません。`);
      const currentQty = Math.max(0, Number(accessoryDesigns[index]?.[change.target.stockField] || 0));
      const nextQty = currentQty + change.delta;
      if (nextQty < 0) {
        const error = new Error(`${change.label} の正式実在庫が不足しています。現在 ${currentQty} 点、反映予定 ${change.delta} 点です。`);
        error.code = "stock-insufficient";
        throw error;
      }
      accessoryDesigns[index][change.target.stockField] = nextQty;
      change.currentQty = currentQty;
      change.nextQty = nextQty;
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

    reconciliation.movements.forEach((row, index) => {
      const movementId = `${closeId}__${index + 1}__${sanitizeDocPart(row.reason)}`;
      const movementRef = doc(db, "inventoryMovements", movementId);
      transaction.set(movementRef, {
        movementId,
        eventCloseId: closeId,
        sessionId: cleanSessionId,
        type: "adjustment",
        reason: row.reason,
        reasonLabel: row.reasonLabel,
        sourceAction: "event_close_with_unidentified",
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
        createdAt: serverTimestamp()
      });
    });

    const unidentifiedState = {
      version: 2,
      status: "closed_unidentified",
      source: "inventory_reconciliation",
      quickTotal: reconciliation.quickSalesTotal,
      manualAllocatedTotal: reconciliation.manualAllocatedTotal,
      autoResolvedTotal: reconciliation.autoResolvedTotal,
      identifiedTotal: reconciliation.identifiedQuickTotal,
      unresolvedTotal: reconciliation.unresolvedTotal,
      groups: reconciliation.groups,
      autoResolvedCategories: reconciliation.autoResolvedCategories,
      autoResolvedByVariant: reconciliation.autoByVariant,
      inventoryNotAppliedTotal: reconciliation.unresolvedTotal,
      residualDifferenceCount: reconciliation.residualDifferenceCount,
      residualDifferenceByVariant: reconciliation.residualDifferenceByVariant,
      closedByEmail: text(closedByEmail),
      closedAt: serverTimestamp()
    };

    transaction.update(sessionRef, {
      status: "closed",
      closedAt: serverTimestamp(),
      closedByEmail: text(closedByEmail),
      eventCloseId: closeId,
      eventCloseMode: "closed_with_unidentified",
      eventCloseSummary: {
        openingTotal: reconciliation.openingTotal,
        skuSalesTotal: reconciliation.exactSalesTotal + reconciliation.identifiedQuickTotal,
        quickSalesTotal: reconciliation.quickSalesTotal,
        quickAllocatedTotal: reconciliation.identifiedQuickTotal,
        quickUnresolvedTotal: reconciliation.unresolvedTotal,
        closingTotal: reconciliation.closingTotal,
        recordedReductionTotal: reconciliation.reductionTotal,
        stockAdjustmentTotal: reconciliation.stockAdjustmentTotal,
        movementCount: reconciliation.movements.length,
        unclassifiedDifferenceCount: reconciliation.residualDifferenceCount,
        reconciliationStatus: "unidentified_remaining"
      },
      "inventoryCount.soldByVariant": reconciliation.soldByVariant,
      "inventoryCount.unidentifiedQuick": unidentifiedState,
      "inventoryCount.finalizedAt": serverTimestamp(),
      "inventoryCount.finalizedByEmail": text(closedByEmail),
      "inventoryCount.adjustmentsAppliedAt": serverTimestamp(),
      "inventoryCount.reconciliationStatus": "closed_with_unidentified",
      updatedAt: serverTimestamp()
    });

    transaction.set(lockRef, {
      transactionId: closeId,
      action: "event_close_with_unidentified",
      sessionId: cleanSessionId,
      status: "committed",
      movementCount: reconciliation.movements.length,
      quickUnresolvedTotal: reconciliation.unresolvedTotal,
      createdAt: serverTimestamp()
    });

    return {
      sessionId: cleanSessionId,
      closeId,
      status: "closed",
      duplicate: false,
      closeMode: "closed_with_unidentified",
      unresolvedTotal: reconciliation.unresolvedTotal,
      identifiedQuickTotal: reconciliation.identifiedQuickTotal,
      groups: reconciliation.groups,
      movementCount: reconciliation.movements.length,
      residualDifferenceCount: reconciliation.residualDifferenceCount
    };
  });
}
