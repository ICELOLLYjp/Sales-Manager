import { getFirebaseState } from "../firebase.js";

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

function nowIso() {
  return new Date().toISOString();
}

function sanitizeDocPart(value) {
  return text(value).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 100);
}

function encodePart(value) {
  return encodeURIComponent(text(value));
}

function tshirtVariantId(bodyId, designId, colorId, sizeId) {
  return ["tshirt", encodePart(bodyId), encodePart(designId), encodePart(colorId), encodePart(sizeId)].join("__");
}

function tshirtInventoryKey(bodyId, designId, colorId, sizeId) {
  return `tshirt:${encodePart(bodyId)}|${encodePart(designId)}|${encodePart(colorId)}|${encodePart(sizeId)}`;
}

function accessoryVariantId(category, sourceId) {
  return ["accessory", encodePart(category), encodePart(sourceId)].join("__");
}

function accessoryInventoryKey(sourceId, stockField) {
  return `accessory:${encodePart(sourceId)}|${encodePart(stockField)}`;
}

function categoryForAccessory(sourceCategory, stockField) {
  if (text(sourceCategory) === "puraplara") {
    return stockField === "piercing" ? "drop_pierce" : "drop_earring";
  }
  return stockField === "piercing" ? "pierce" : "earring";
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

function displayName(map, id, fields) {
  const item = map?.[id] || {};
  for (const field of fields) {
    const value = text(item?.[field]);
    if (value) return value;
  }
  return text(id);
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

function resolvedAllocationKeys(session) {
  const keys = new Set();
  (Array.isArray(session?.inventoryCount?.quickAllocations)
    ? session.inventoryCount.quickAllocations
    : []).forEach(row => {
      const key = text(row?.allocationKey);
      if (key) keys.add(key);
    });
  (Array.isArray(session?.inventoryCount?.lateQuickAllocations)
    ? session.inventoryCount.lateQuickAllocations
    : []).forEach(row => {
      (Array.isArray(row?.allocationKeys) ? row.allocationKeys : []).forEach(key => {
        const clean = text(key);
        if (clean) keys.add(clean);
      });
    });
  return keys;
}

function buildCurrentQuickGroups(session, transactions) {
  const units = quickUnits(transactions);
  const resolvedKeys = resolvedAllocationKeys(session);
  const autoResolvedCategories = new Set(
    Array.isArray(session?.inventoryCount?.unidentifiedQuick?.autoResolvedCategories)
      ? session.inventoryCount.unidentifiedQuick.autoResolvedCategories.map(text)
      : []
  );

  const groups = new Map();
  units.forEach(unit => {
    if (resolvedKeys.has(unit.allocationKey)) return;
    if (autoResolvedCategories.has(unit.category)) return;
    const bodyKey = unit.category === "tshirt" ? unit.tshirtBodyKey : "";
    const groupKey = [unit.category, Number(unit.unitPrice || 0), bodyKey].join("||");
    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        groupKey,
        category: unit.category,
        unitPrice: Number(unit.unitPrice || 0),
        tshirtBodyKey: bodyKey,
        quantity: 0,
        allocationKeys: []
      });
    }
    const group = groups.get(groupKey);
    group.quantity += 1;
    group.allocationKeys.push(unit.allocationKey);
  });

  return Array.from(groups.values()).sort((a, b) =>
    a.category.localeCompare(b.category) ||
    a.unitPrice - b.unitPrice ||
    a.tshirtBodyKey.localeCompare(b.tshirtBodyKey)
  );
}

function unlinkedEventItems(session) {
  return (Array.isArray(session?.inventoryCount?.unregisteredItems)
    ? session.inventoryCount.unregisteredItems
    : [])
    .filter(item => text(item?.tempId) && TRACKED_CATEGORIES.has(text(item?.category)))
    .filter(item => !text(item?.linkedVariantId) && text(item?.status || "unregistered") !== "linked")
    .map(item => ({
      tempId: text(item.tempId),
      category: text(item.category),
      label: text(item.label),
      detail: text(item.detail),
      bodyName: text(item.bodyName),
      colorName: text(item.colorName),
      sizeName: text(item.sizeName),
      openingKnown: Boolean(item.openingKnown),
      openingQty: item.openingQty === null || item.openingQty === undefined ? null : nonNegativeInt(item.openingQty),
      countedQty: item.countedQty === null || item.countedQty === undefined ? null : nonNegativeInt(item.countedQty)
    }));
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

export async function loadFormalCandidates(db) {
  const { doc, collection, getDocFromServer, getDocsFromServer } = await firestoreModule();
  const [variantsSnapshot, tshirtSnapshot, accessorySnapshot] = await Promise.all([
    getDocsFromServer(collection(db, "productVariants")),
    getDocFromServer(doc(db, "tshirtStock", "master")),
    getDocFromServer(doc(db, "accessoryStock", "shared"))
  ]);

  const candidates = new Map();
  const put = candidate => {
    const variantId = text(candidate?.variantId);
    const category = text(candidate?.category);
    if (!variantId || !TRACKED_CATEGORIES.has(category)) return;
    const existing = candidates.get(variantId) || {};
    candidates.set(variantId, {
      ...existing,
      ...candidate,
      variantId,
      category,
      inventorySource: text(candidate?.inventorySource || existing.inventorySource),
      inventoryKey: text(candidate?.inventoryKey || existing.inventoryKey),
      sku: text(candidate?.sku || existing.sku || variantId),
      label: text(candidate?.label || existing.label || candidate?.design || existing.design || variantId),
      detail: text(candidate?.detail || existing.detail),
      bodyId: text(candidate?.bodyId || existing.bodyId),
      body: text(candidate?.body || existing.body),
      color: text(candidate?.color || existing.color),
      size: text(candidate?.size || existing.size),
      currentStockQty: Number.isFinite(Number(candidate?.currentStockQty))
        ? int(candidate.currentStockQty)
        : (Number.isFinite(Number(existing?.currentStockQty)) ? int(existing.currentStockQty) : 0)
    });
  };

  variantsSnapshot.docs.forEach(snapshot => {
    const value = { id: snapshot.id, ...snapshot.data() };
    const category = text(value?.category);
    if (!TRACKED_CATEGORIES.has(category) || value?.active === false) return;
    put({
      variantId: text(value?.variantId || value?.id || snapshot.id),
      category,
      inventorySource: text(value?.inventorySource),
      inventoryKey: text(value?.inventoryKey),
      sku: text(value?.sku || value?.variantId || snapshot.id),
      label: text(value?.displayName || value?.design || value?.label || value?.variantId || snapshot.id),
      detail: [value?.body, value?.color, value?.size].map(text).filter(Boolean).join(" / "),
      bodyId: text(value?.bodyId),
      body: text(value?.body),
      color: text(value?.color),
      size: text(value?.size)
    });
  });

  if (tshirtSnapshot.exists()) {
    const master = tshirtSnapshot.data();
    const masters = master?.masters || {};
    const bodies = masters?.bodies || {};
    const designs = masters?.designs || {};
    const colors = masters?.colors || {};
    const sizes = masters?.sizes || {};
    Object.entries(master?.inventory_v2 || {}).forEach(([bodyId, designTree]) => {
      if (bodyId === "body_unassigned") return;
      Object.entries(designTree || {}).forEach(([designId, colorTree]) => {
        Object.entries(colorTree || {}).forEach(([colorId, sizeTree]) => {
          Object.entries(sizeTree || {}).forEach(([sizeId, cell]) => {
            const body = displayName(bodies, bodyId, ["managementName", "salesName"]);
            const design = displayName(designs, designId, ["managementName", "legacyKey", "salesName"]);
            const color = displayName(colors, colorId, ["managementName", "legacyKey", "pinkoiName"]);
            const size = displayName(sizes, sizeId, ["managementName", "salesName"]);
            put({
              variantId: tshirtVariantId(bodyId, designId, colorId, sizeId),
              category: "tshirt",
              inventorySource: "tshirt",
              inventoryKey: tshirtInventoryKey(bodyId, designId, colorId, sizeId),
              sku: tshirtVariantId(bodyId, designId, colorId, sizeId),
              label: design || "Tシャツ",
              detail: [body, color, size].filter(Boolean).join(" / "),
              bodyId,
              body,
              color,
              size,
              currentStockQty: int(cell?.qty)
            });
          });
        });
      });
    });
  }

  if (accessorySnapshot.exists()) {
    const designs = Array.isArray(accessorySnapshot.data()?.designs)
      ? accessorySnapshot.data().designs
      : [];
    designs.forEach(design => {
      const sourceId = text(design?.id);
      const label = text(design?.name);
      const sourceCategory = text(design?.category || "standard");
      if (!sourceId || !label) return;
      ["piercing", "earring"].forEach(stockField => {
        const category = categoryForAccessory(sourceCategory, stockField);
        put({
          variantId: accessoryVariantId(category, sourceId),
          category,
          inventorySource: "accessory",
          inventoryKey: accessoryInventoryKey(sourceId, stockField),
          sku: accessoryVariantId(category, sourceId),
          label,
          detail: category,
          currentStockQty: int(design?.[stockField])
        });
      });
    });
  }

  return Array.from(candidates.values())
    .filter(candidate => ["tshirt", "accessory"].includes(candidate.inventorySource) && candidate.inventoryKey)
    .sort((a, b) =>
      a.category.localeCompare(b.category) ||
      a.label.localeCompare(b.label, "ja") ||
      a.detail.localeCompare(b.detail, "ja")
    );
}

export async function loadLateSkuResolutionSummary({ sessionId }) {
  const loaded = await loadSessionAndSales(sessionId);
  const candidates = await loadFormalCandidates(loaded.db);
  const quickGroups = buildCurrentQuickGroups(loaded.session, loaded.transactions);
  const items = unlinkedEventItems(loaded.session);
  return {
    sessionId: text(sessionId),
    sessionStatus: text(loaded.session?.status),
    eventCloseMode: text(loaded.session?.eventCloseMode),
    currency: text(loaded.session?.currency || "JPY"),
    unregisteredItems: items,
    unresolvedQuickGroups: quickGroups,
    unresolvedQuickTotal: quickGroups.reduce((sum, group) => sum + nonNegativeInt(group.quantity), 0),
    candidates
  };
}

export async function linkUnregisteredItemToSku({
  sessionId,
  tempId,
  variantId,
  linkedByEmail = ""
}) {
  const cleanSessionId = text(sessionId);
  const cleanTempId = text(tempId);
  const cleanVariantId = text(variantId);
  if (!cleanSessionId || !cleanTempId || !cleanVariantId) throw new Error("紐付け対象を確認してください。");

  const loaded = await loadSessionAndSales(cleanSessionId);
  const candidates = await loadFormalCandidates(loaded.db);
  const candidate = candidates.find(row => row.variantId === cleanVariantId);
  if (!candidate) throw new Error("正式SKUが見つかりません。");

  const { runTransaction, serverTimestamp } = await firestoreModule();
  let result = null;

  await runTransaction(loaded.db, async transaction => {
    const snapshot = await transaction.get(loaded.sessionRef);
    if (!snapshot.exists()) throw new Error("販売セッションが見つかりません。");
    const current = snapshot.data();
    const items = Array.isArray(current?.inventoryCount?.unregisteredItems)
      ? current.inventoryCount.unregisteredItems.map(item => ({ ...item }))
      : [];
    const index = items.findIndex(item => text(item?.tempId) === cleanTempId);
    if (index < 0) throw new Error("未登録商品が見つかりません。");
    const target = items[index];

    if (text(target?.linkedVariantId)) {
      if (text(target.linkedVariantId) === cleanVariantId) {
        result = { duplicate: true, tempId: cleanTempId, variantId: cleanVariantId, stockChanged: false };
        return;
      }
      throw new Error("この未登録商品はすでに別のSKUへ紐付いています。");
    }
    if (text(target?.category) !== candidate.category) {
      throw new Error("商品カテゴリが一致しないため紐付けできません。");
    }

    const linkedAtIso = nowIso();
    items[index] = {
      ...target,
      status: "linked",
      linkedVariantId: candidate.variantId,
      linkedInventorySource: candidate.inventorySource,
      linkedInventoryKey: candidate.inventoryKey,
      linkedSku: candidate.sku,
      linkedLabel: candidate.label,
      linkedDetail: candidate.detail,
      linkedAtIso,
      linkedByEmail: text(linkedByEmail),
      updatedAtIso: linkedAtIso,
      updatedByEmail: text(linkedByEmail)
    };

    const links = Array.isArray(current?.inventoryCount?.unregisteredItemLinks)
      ? current.inventoryCount.unregisteredItemLinks
      : [];
    const audit = {
      tempId: cleanTempId,
      variantId: candidate.variantId,
      category: candidate.category,
      inventorySource: candidate.inventorySource,
      inventoryKey: candidate.inventoryKey,
      label: candidate.label,
      linkedAtIso,
      linkedByEmail: text(linkedByEmail),
      stockChanged: false
    };

    transaction.update(loaded.sessionRef, {
      "inventoryCount.unregisteredItems": items,
      "inventoryCount.unregisteredItemLinks": [...links, audit],
      "inventoryCount.unregisteredItemsUpdatedAt": serverTimestamp(),
      "inventoryCount.updatedAt": serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    result = {
      duplicate: false,
      tempId: cleanTempId,
      variantId: cleanVariantId,
      stockChanged: false,
      candidate
    };
  });

  return result;
}

function adjustResidualDifferences(unidentified, variantId, quantity) {
  const rows = Array.isArray(unidentified?.residualDifferenceByVariant)
    ? unidentified.residualDifferenceByVariant.map(row => ({ ...row }))
    : [];
  const index = rows.findIndex(row => text(row?.variantId) === variantId);
  if (index >= 0) {
    const currentDifference = int(rows[index]?.difference);
    const nextDifference = currentDifference - quantity;
    rows[index].difference = nextDifference;
    rows[index].expectedQty = int(rows[index]?.actualQty) + nextDifference;
    if (nextDifference === 0) rows.splice(index, 1);
  }
  return rows;
}

export async function resolveClosedQuickGroupToSku({
  sessionId,
  groupKey,
  variantId,
  quantity,
  resolvedByEmail = ""
}) {
  const cleanSessionId = text(sessionId);
  const cleanGroupKey = text(groupKey);
  const cleanVariantId = text(variantId);
  const cleanQuantity = nonNegativeInt(quantity);
  if (!cleanSessionId || !cleanGroupKey || !cleanVariantId || cleanQuantity <= 0) {
    throw new Error("未特定販売の紐付け内容を確認してください。");
  }

  const loaded = await loadSessionAndSales(cleanSessionId);
  if (text(loaded.session?.status) !== "closed") {
    throw new Error("販売中・仮終了中は既存のQuick配分を使用してください。後日紐付けは正式終了後専用です。");
  }

  const candidates = await loadFormalCandidates(loaded.db);
  const candidate = candidates.find(row => row.variantId === cleanVariantId);
  if (!candidate) throw new Error("正式SKUが見つかりません。");

  const currentGroups = buildCurrentQuickGroups(loaded.session, loaded.transactions);
  const group = currentGroups.find(row => row.groupKey === cleanGroupKey);
  if (!group) throw new Error("この未特定販売はすでに解決済みか、状態が変更されています。");
  if (candidate.category !== group.category) throw new Error("販売カテゴリとSKUカテゴリが一致しません。");
  if (cleanQuantity > group.quantity) throw new Error(`未特定数は ${group.quantity} 点です。数量を確認してください。`);
  const selectedKeys = group.allocationKeys.slice(0, cleanQuantity);
  if (selectedKeys.length !== cleanQuantity) throw new Error("未特定販売の単位情報を確認できません。");

  const { doc, runTransaction, FieldPath, serverTimestamp } = await firestoreModule();
  const tshirtRef = doc(loaded.db, "tshirtStock", "master");
  const accessoryRef = doc(loaded.db, "accessoryStock", "shared");
  const loadedUpdatedAt = timestampKey(loaded.session?.updatedAt);

  return await runTransaction(loaded.db, async transaction => {
    const currentSnapshot = await transaction.get(loaded.sessionRef);
    if (!currentSnapshot.exists()) throw new Error("販売セッションが見つかりません。");
    const current = currentSnapshot.data();
    if (text(current?.status) !== "closed") throw new Error("イベント状態が変更されました。画面を更新してください。");
    if (timestampKey(current?.updatedAt) !== loadedUpdatedAt) {
      const error = new Error("未特定販売または在庫情報が変更されました。画面を更新してもう一度確認してください。");
      error.code = "event-data-changed";
      throw error;
    }

    const verifiedGroups = buildCurrentQuickGroups(current, loaded.transactions);
    const verifiedGroup = verifiedGroups.find(row => row.groupKey === cleanGroupKey);
    if (!verifiedGroup || verifiedGroup.quantity < cleanQuantity) {
      throw new Error("この未特定販売はすでに解決済みか、数量が変更されています。");
    }
    const verifiedKeys = verifiedGroup.allocationKeys.slice(0, cleanQuantity);
    if (verifiedKeys.join("|") !== selectedKeys.join("|")) {
      throw new Error("未特定販売の状態が変わりました。画面を更新してください。");
    }

    let stockBefore = 0;
    let stockAfter = 0;
    if (candidate.inventorySource === "tshirt") {
      const target = parseTshirtInventoryKey(candidate.inventoryKey);
      if (!target) throw new Error("Tシャツ在庫キーが不正です。");
      const stockSnapshot = await transaction.get(tshirtRef);
      if (!stockSnapshot.exists()) throw new Error("Tシャツ実在庫を確認できません。");
      stockBefore = int(stockSnapshot.data()?.inventory_v2?.[target.bodyId]?.[target.designId]?.[target.colorId]?.[target.sizeId]?.qty);
      stockAfter = stockBefore - cleanQuantity;
      transaction.update(
        tshirtRef,
        new FieldPath("inventory_v2", target.bodyId, target.designId, target.colorId, target.sizeId, "qty"),
        stockAfter,
        "updatedAt",
        serverTimestamp()
      );
    } else if (candidate.inventorySource === "accessory") {
      const target = parseAccessoryInventoryKey(candidate.inventoryKey);
      if (!target) throw new Error("アクセサリー在庫キーが不正です。");
      const stockSnapshot = await transaction.get(accessoryRef);
      if (!stockSnapshot.exists()) throw new Error("アクセサリー実在庫を確認できません。");
      const designs = Array.isArray(stockSnapshot.data()?.designs)
        ? stockSnapshot.data().designs.map(item => ({ ...item }))
        : [];
      const index = designs.findIndex(item => text(item?.id) === target.sourceId);
      if (index < 0) throw new Error("アクセサリー実在庫が見つかりません。");
      stockBefore = int(designs[index]?.[target.stockField]);
      stockAfter = stockBefore - cleanQuantity;
      designs[index][target.stockField] = stockAfter;
      transaction.update(accessoryRef, { designs, updatedAt: serverTimestamp() });
    } else {
      throw new Error("このSKUは正式実在庫へ安全に反映できません。");
    }

    const lateAllocations = Array.isArray(current?.inventoryCount?.lateQuickAllocations)
      ? current.inventoryCount.lateQuickAllocations
      : [];
    const quickAllocations = Array.isArray(current?.inventoryCount?.quickAllocations)
      ? current.inventoryCount.quickAllocations
      : [];
    const existingQuickKeys = new Set(quickAllocations.map(row => text(row?.allocationKey)).filter(Boolean));
    const newQuickAllocations = [...quickAllocations];
    verifiedKeys.forEach(allocationKey => {
      if (existingQuickKeys.has(allocationKey)) return;
      newQuickAllocations.push({
        allocationKey,
        variantId: candidate.variantId,
        category: candidate.category,
        source: "post_close_resolution",
        variantSnapshot: {
          variantId: candidate.variantId,
          category: candidate.category,
          inventorySource: candidate.inventorySource,
          inventoryKey: candidate.inventoryKey,
          sku: candidate.sku,
          label: candidate.label,
          detail: candidate.detail
        }
      });
    });

    const resolvedAtIso = nowIso();
    const resolutionId = `latequick_${sanitizeDocPart(cleanSessionId)}_${sanitizeDocPart(verifiedKeys[0])}_${cleanQuantity}`;
    const lateAllocation = {
      resolutionId,
      groupKey: cleanGroupKey,
      category: candidate.category,
      variantId: candidate.variantId,
      inventorySource: candidate.inventorySource,
      inventoryKey: candidate.inventoryKey,
      sku: candidate.sku,
      label: candidate.label,
      quantity: cleanQuantity,
      allocationKeys: verifiedKeys,
      stockBefore,
      stockAfter,
      stockWentNegative: stockAfter < 0,
      resolvedAtIso,
      resolvedByEmail: text(resolvedByEmail)
    };

    const nextLateAllocations = [...lateAllocations, lateAllocation];
    const currentSold = current?.inventoryCount?.soldByVariant && typeof current.inventoryCount.soldByVariant === "object"
      ? { ...current.inventoryCount.soldByVariant }
      : {};
    currentSold[candidate.variantId] = nonNegativeInt(currentSold[candidate.variantId]) + cleanQuantity;

    const nextGroups = buildCurrentQuickGroups({
      ...current,
      inventoryCount: {
        ...(current?.inventoryCount || {}),
        quickAllocations: newQuickAllocations,
        lateQuickAllocations: nextLateAllocations
      }
    }, loaded.transactions);
    const nextUnresolvedTotal = nextGroups.reduce((sum, row) => sum + nonNegativeInt(row.quantity), 0);

    const unidentified = current?.inventoryCount?.unidentifiedQuick || {};
    const residualRows = adjustResidualDifferences(unidentified, candidate.variantId, cleanQuantity);
    const previousIdentified = nonNegativeInt(unidentified?.identifiedTotal);
    const previousLate = nonNegativeInt(unidentified?.lateAllocatedTotal);
    const nextStatus = nextUnresolvedTotal > 0 ? "closed_unidentified" : "resolved_after_close";

    const closeSummary = current?.eventCloseSummary || {};
    const currentAllocated = nonNegativeInt(closeSummary?.quickAllocatedTotal);
    const currentSkuSales = nonNegativeInt(closeSummary?.skuSalesTotal);
    const currentMovementCount = nonNegativeInt(closeSummary?.movementCount);

    const movementRef = doc(loaded.db, "inventoryMovements", resolutionId);
    const lockRef = doc(loaded.db, "transactionLocks", resolutionId);
    transaction.set(movementRef, {
      movementId: resolutionId,
      sessionId: cleanSessionId,
      type: "adjustment",
      reason: "quick_sale_post_close_allocation",
      reasonLabel: "未特定Quick・終了後SKU紐付け",
      sourceAction: "post_close_quick_resolution",
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
      allocationKeys: verifiedKeys,
      stockBefore,
      stockAfter,
      stockWentNegative: stockAfter < 0,
      status: "applied",
      createdAt: serverTimestamp(),
      createdByEmail: text(resolvedByEmail)
    });
    transaction.set(lockRef, {
      transactionId: resolutionId,
      action: "post_close_quick_resolution",
      sessionId: cleanSessionId,
      status: "committed",
      allocationKeys: verifiedKeys,
      variantId: candidate.variantId,
      quantity: cleanQuantity,
      createdAt: serverTimestamp()
    });

    transaction.update(loaded.sessionRef, {
      "inventoryCount.quickAllocations": newQuickAllocations,
      "inventoryCount.lateQuickAllocations": nextLateAllocations,
      "inventoryCount.soldByVariant": currentSold,
      "inventoryCount.unidentifiedQuick": {
        ...unidentified,
        version: Math.max(3, nonNegativeInt(unidentified?.version)),
        status: nextStatus,
        groups: nextGroups,
        unresolvedTotal: nextUnresolvedTotal,
        inventoryNotAppliedTotal: nextUnresolvedTotal,
        identifiedTotal: previousIdentified + cleanQuantity,
        lateAllocatedTotal: previousLate + cleanQuantity,
        residualDifferenceCount: residualRows.length,
        residualDifferenceByVariant: residualRows,
        lastResolvedAt: serverTimestamp(),
        lastResolvedByEmail: text(resolvedByEmail)
      },
      "inventoryCount.reconciliationStatus": nextUnresolvedTotal > 0
        ? "closed_with_unidentified"
        : "resolved_after_close",
      eventCloseSummary: {
        ...closeSummary,
        skuSalesTotal: currentSkuSales + cleanQuantity,
        quickAllocatedTotal: currentAllocated + cleanQuantity,
        quickUnresolvedTotal: nextUnresolvedTotal,
        movementCount: currentMovementCount + 1,
        unclassifiedDifferenceCount: residualRows.length,
        reconciliationStatus: nextUnresolvedTotal > 0
          ? "unidentified_remaining"
          : "resolved_after_close"
      },
      updatedAt: serverTimestamp()
    });

    return {
      sessionId: cleanSessionId,
      resolutionId,
      variantId: candidate.variantId,
      quantity: cleanQuantity,
      unresolvedTotal: nextUnresolvedTotal,
      stockBefore,
      stockAfter,
      stockWentNegative: stockAfter < 0
    };
  });
}
