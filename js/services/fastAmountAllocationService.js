import { getFirebaseState } from "../firebase.js";
import { loadFormalCandidates } from "./eventLateSkuResolutionService.js?v=20260916-fast-amount-allocation-1";

const CATEGORY_LABELS = {
  tshirt: "Tシャツ",
  accessory: "アクセサリー",
  other: "その他"
};

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

function positiveInt(value) {
  return Math.max(0, int(value));
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

function isUnclassifiedFastAmountSale(sale) {
  return sale?.amountOnly === true &&
    text(sale?.classificationStatus || "unclassified") === "unclassified" &&
    sale?.status !== "voided";
}

function allocationId(transactionId) {
  return `${text(transactionId)}__fast_amount_allocation`;
}

function categoryItem(sale, category) {
  const original = (Array.isArray(sale?.items) ? sale.items : [])[0] || {};
  const label = CATEGORY_LABELS[category] || category;
  return {
    ...original,
    category,
    label,
    quantity: 0,
    trackingMode: "category_only",
    physicalQuantityKnown: false,
    inventoryApplied: false,
    eventInventoryApplied: false,
    reconciliationStatus: "category_classified",
    variantId: null,
    inventoryKey: null,
    inventorySource: null
  };
}

function skuItem(sale, candidate, quantity, stockBefore, stockAfter) {
  const original = (Array.isArray(sale?.items) ? sale.items : [])[0] || {};
  const grossSales = Number(sale?.grossSales || sale?.netSales || 0);
  return {
    ...original,
    category: candidate.category,
    label: candidate.label,
    detail: candidate.detail,
    sku: candidate.sku,
    quantity,
    unitPrice: quantity > 0 ? grossSales / quantity : grossSales,
    grossLineTotal: grossSales,
    trackingMode: "sku",
    physicalQuantityKnown: true,
    variantId: candidate.variantId,
    inventoryKey: candidate.inventoryKey,
    inventorySource: candidate.inventorySource,
    bodyId: candidate.bodyId || null,
    inventoryApplied: true,
    eventInventoryApplied: true,
    inventoryQtyBefore: stockBefore,
    inventoryQtyAfter: stockAfter,
    inventoryWarning: stockAfter < 0,
    reconciliationStatus: "reconciled"
  };
}

export async function loadFastAmountAllocation({ transactionId }) {
  const cleanTransactionId = text(transactionId);
  if (!cleanTransactionId) throw new Error("会計IDを確認してください。");
  const db = await requireDb();
  const { doc, getDocFromServer } = await firestoreModule();
  const snapshot = await getDocFromServer(doc(db, "salesTransactions", cleanTransactionId));
  if (!snapshot.exists()) throw new Error("会計が見つかりません。");
  const sale = { transactionId: snapshot.id, ...snapshot.data() };
  if (!isUnclassifiedFastAmountSale(sale)) throw new Error("この会計は分類済み、または分類対象外です。");
  return {
    sale,
    candidates: await loadFormalCandidates(db)
  };
}

export async function classifyFastAmountByCategory({
  transactionId,
  category,
  classifiedByEmail = ""
}) {
  const cleanTransactionId = text(transactionId);
  const cleanCategory = text(category);
  if (!cleanTransactionId || !CATEGORY_LABELS[cleanCategory]) {
    throw new Error("会計とカテゴリを確認してください。");
  }
  const db = await requireDb();
  const { doc, runTransaction, serverTimestamp } = await firestoreModule();
  const saleRef = doc(db, "salesTransactions", cleanTransactionId);
  const lockRef = doc(db, "transactionLocks", allocationId(cleanTransactionId));
  const movementRef = doc(db, "inventoryMovements", `${cleanTransactionId}__1`);

  return await runTransaction(db, async transaction => {
    const saleSnapshot = await transaction.get(saleRef);
    if (!saleSnapshot.exists()) throw new Error("会計が見つかりません。");
    const sale = saleSnapshot.data();
    const sessionId = text(sale?.sessionId);
    if (!sessionId) throw new Error("販売セッションが見つかりません。");
    const sessionRef = doc(db, "salesSessions", sessionId);
    const sessionSnapshot = await transaction.get(sessionRef);
    const lockSnapshot = await transaction.get(lockRef);
    if (!sessionSnapshot.exists()) throw new Error("販売セッションが見つかりません。");
    if (lockSnapshot.exists()) {
      return { duplicate: true, transactionId: cleanTransactionId, category: cleanCategory };
    }
    if (!isUnclassifiedFastAmountSale(sale)) {
      throw new Error("この会計はすでに分類済み、取消済み、または状態が変更されています。");
    }

    const session = sessionSnapshot.data();
    const item = categoryItem(sale, cleanCategory);
    const audit = {
      type: "category",
      category: cleanCategory,
      label: CATEGORY_LABELS[cleanCategory],
      inventoryChanged: false,
      classifiedByEmail: text(classifiedByEmail)
    };
    transaction.update(saleRef, {
      items: [item],
      mode: "category_only",
      classificationStatus: "category_classified",
      classifiedCategory: cleanCategory,
      requiresClassification: false,
      inventoryMode: "category_only",
      inventoryApplied: false,
      reconciliationStatus: "category_classified",
      classificationAudit: audit,
      classifiedAt: serverTimestamp(),
      classifiedByEmail: text(classifiedByEmail),
      updatedAt: serverTimestamp()
    });
    transaction.update(sessionRef, {
      "salesSummary.unclassifiedTransactionCount": Math.max(0, positiveInt(session?.salesSummary?.unclassifiedTransactionCount) - 1),
      updatedAt: serverTimestamp()
    });
    transaction.set(movementRef, {
      category: cleanCategory,
      label: CATEGORY_LABELS[cleanCategory],
      trackingMode: "category_only",
      status: "category_classified",
      classificationAudit: audit,
      updatedAt: serverTimestamp()
    }, { merge: true });
    transaction.set(lockRef, {
      transactionId: cleanTransactionId,
      sessionId,
      action: "fast_amount_category_classification",
      category: cleanCategory,
      inventoryChanged: false,
      status: "committed",
      createdAt: serverTimestamp(),
      createdByEmail: text(classifiedByEmail)
    });
    return { duplicate: false, transactionId: cleanTransactionId, category: cleanCategory };
  });
}

export async function classifyFastAmountToSku({
  transactionId,
  variantId,
  quantity,
  classifiedByEmail = ""
}) {
  const cleanTransactionId = text(transactionId);
  const cleanVariantId = text(variantId);
  const cleanQuantity = positiveInt(quantity);
  if (!cleanTransactionId || !cleanVariantId || cleanQuantity <= 0) {
    throw new Error("会計、SKU、数量を確認してください。");
  }
  const db = await requireDb();
  const candidates = await loadFormalCandidates(db);
  const candidate = candidates.find(row => row.variantId === cleanVariantId);
  if (!candidate) throw new Error("正式SKUが見つかりません。");

  const { doc, runTransaction, FieldPath, serverTimestamp } = await firestoreModule();
  const saleRef = doc(db, "salesTransactions", cleanTransactionId);
  const lockRef = doc(db, "transactionLocks", allocationId(cleanTransactionId));
  const originalMovementRef = doc(db, "inventoryMovements", `${cleanTransactionId}__1`);
  const allocationMovementRef = doc(db, "inventoryMovements", allocationId(cleanTransactionId));
  const tshirtRef = doc(db, "tshirtStock", "master");
  const accessoryRef = doc(db, "accessoryStock", "shared");

  return await runTransaction(db, async transaction => {
    const saleSnapshot = await transaction.get(saleRef);
    if (!saleSnapshot.exists()) throw new Error("会計が見つかりません。");
    const sale = saleSnapshot.data();
    const sessionId = text(sale?.sessionId);
    if (!sessionId) throw new Error("販売セッションが見つかりません。");
    const sessionRef = doc(db, "salesSessions", sessionId);
    const sessionSnapshot = await transaction.get(sessionRef);
    const lockSnapshot = await transaction.get(lockRef);
    let stockSnapshot = null;
    if (candidate.inventorySource === "tshirt") stockSnapshot = await transaction.get(tshirtRef);
    else if (candidate.inventorySource === "accessory") stockSnapshot = await transaction.get(accessoryRef);
    else throw new Error("このSKUは正式実在庫へ安全に反映できません。");

    if (!sessionSnapshot.exists()) throw new Error("販売セッションが見つかりません。");
    if (lockSnapshot.exists()) {
      return { duplicate: true, transactionId: cleanTransactionId, variantId: cleanVariantId };
    }
    if (!isUnclassifiedFastAmountSale(sale)) {
      throw new Error("この会計はすでに分類済み、取消済み、または状態が変更されています。");
    }
    if (!stockSnapshot?.exists()) throw new Error("正式実在庫を確認できません。");

    let stockBefore = 0;
    let stockAfter = 0;
    if (candidate.inventorySource === "tshirt") {
      const target = parseTshirtInventoryKey(candidate.inventoryKey);
      if (!target) throw new Error("Tシャツ在庫キーが不正です。");
      stockBefore = int(stockSnapshot.data()?.inventory_v2?.[target.bodyId]?.[target.designId]?.[target.colorId]?.[target.sizeId]?.qty);
      stockAfter = stockBefore - cleanQuantity;
      transaction.update(
        tshirtRef,
        new FieldPath("inventory_v2", target.bodyId, target.designId, target.colorId, target.sizeId, "qty"),
        stockAfter,
        "updatedAt",
        serverTimestamp()
      );
    } else {
      const target = parseAccessoryInventoryKey(candidate.inventoryKey);
      if (!target) throw new Error("アクセサリー在庫キーが不正です。");
      const designs = Array.isArray(stockSnapshot.data()?.designs)
        ? stockSnapshot.data().designs.map(item => ({ ...item }))
        : [];
      const index = designs.findIndex(item => text(item?.id) === target.sourceId);
      if (index < 0) throw new Error("アクセサリー実在庫が見つかりません。");
      stockBefore = int(designs[index]?.[target.stockField]);
      stockAfter = stockBefore - cleanQuantity;
      designs[index][target.stockField] = stockAfter;
      transaction.update(accessoryRef, { designs, updatedAt: serverTimestamp() });
    }

    const session = sessionSnapshot.data();
    const soldByVariant = session?.inventoryCount?.soldByVariant && typeof session.inventoryCount.soldByVariant === "object"
      ? { ...session.inventoryCount.soldByVariant }
      : {};
    soldByVariant[cleanVariantId] = positiveInt(soldByVariant[cleanVariantId]) + cleanQuantity;
    const item = skuItem(sale, candidate, cleanQuantity, stockBefore, stockAfter);
    const audit = {
      type: "sku",
      category: candidate.category,
      variantId: candidate.variantId,
      sku: candidate.sku,
      label: candidate.label,
      quantity: cleanQuantity,
      stockBefore,
      stockAfter,
      inventoryChanged: true,
      classifiedByEmail: text(classifiedByEmail)
    };

    transaction.update(saleRef, {
      items: [item],
      mode: "sku",
      itemCount: cleanQuantity,
      itemCountKnown: true,
      classificationStatus: "sku_classified",
      classifiedCategory: candidate.category,
      classifiedVariantId: candidate.variantId,
      requiresClassification: false,
      inventoryMode: "allocated",
      inventoryApplied: true,
      reconciliationStatus: "reconciled",
      costSnapshotComplete: false,
      costSnapshotCoveredQuantity: 0,
      costSnapshotMissingQuantity: cleanQuantity,
      classificationAudit: audit,
      classifiedAt: serverTimestamp(),
      classifiedByEmail: text(classifiedByEmail),
      updatedAt: serverTimestamp()
    });
    transaction.update(sessionRef, {
      "salesSummary.itemCount": positiveInt(session?.salesSummary?.itemCount) + cleanQuantity,
      "salesSummary.unclassifiedTransactionCount": Math.max(0, positiveInt(session?.salesSummary?.unclassifiedTransactionCount) - 1),
      "inventoryCount.soldByVariant": soldByVariant,
      "inventoryCount.salesUpdatedAt": serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    transaction.set(originalMovementRef, {
      status: "superseded_by_allocation",
      supersededByMovementId: allocationId(cleanTransactionId),
      updatedAt: serverTimestamp()
    }, { merge: true });
    transaction.set(allocationMovementRef, {
      movementId: allocationId(cleanTransactionId),
      transactionId: cleanTransactionId,
      sessionId,
      type: "adjustment",
      reason: "fast_amount_post_sale_allocation",
      reasonLabel: "最速POS未分類売上・後日SKU確定",
      sourceAction: "fast_amount_allocation",
      category: candidate.category,
      label: candidate.label,
      sku: candidate.sku || null,
      quantity: cleanQuantity,
      signedQuantity: -cleanQuantity,
      expectedInventoryDelta: -cleanQuantity,
      appliedInventoryDelta: -cleanQuantity,
      inventoryApplied: true,
      eventInventoryApplied: true,
      trackingMode: "sku",
      variantId: candidate.variantId,
      inventoryKey: candidate.inventoryKey,
      inventorySource: candidate.inventorySource,
      stockBefore,
      stockAfter,
      stockWentNegative: stockAfter < 0,
      status: "applied",
      createdAt: serverTimestamp(),
      createdByEmail: text(classifiedByEmail)
    });
    transaction.set(lockRef, {
      transactionId: cleanTransactionId,
      sessionId,
      action: "fast_amount_sku_allocation",
      variantId: candidate.variantId,
      quantity: cleanQuantity,
      status: "committed",
      createdAt: serverTimestamp(),
      createdByEmail: text(classifiedByEmail)
    });
    return {
      duplicate: false,
      transactionId: cleanTransactionId,
      variantId: candidate.variantId,
      quantity: cleanQuantity,
      stockBefore,
      stockAfter,
      stockWentNegative: stockAfter < 0
    };
  });
}
