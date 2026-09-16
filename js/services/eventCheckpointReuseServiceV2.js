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

function checkpointItems(checkpoint) {
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

function checkpoints(session) {
  return (Array.isArray(session?.inventoryCount?.checkpoints)
    ? session.inventoryCount.checkpoints
    : [])
    .filter(row => text(row?.id) && timestampMs(row?.capturedAtIso))
    .sort((a, b) => timestampMs(a?.capturedAtIso) - timestampMs(b?.capturedAtIso));
}

function latestCheckpointItemByVariant(session) {
  const map = new Map();
  checkpoints(session).forEach(checkpoint => {
    checkpointItems(checkpoint).forEach(item => {
      map.set(item.variantId, { checkpoint, item });
    });
  });
  return map;
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

function closingItems(session) {
  return Array.isArray(session?.inventoryCount?.closing?.items)
    ? session.inventoryCount.closing.items
    : [];
}

function hasClosingQty(item) {
  return Boolean(
    item &&
    item.closingQty !== null &&
    item.closingQty !== undefined &&
    item.closingQty !== ""
  );
}

function transactionTime(transaction) {
  return (
    timestampMs(transaction?.createdAt) ||
    timestampMs(transaction?.committedAt) ||
    timestampMs(transaction?.updatedAt)
  );
}

function quickCategoryChangedAfter(transactions, category, checkpointMs) {
  return (Array.isArray(transactions) ? transactions : [])
    .filter(transaction => transaction?.status !== "voided")
    .some(transaction => {
      const txMs = transactionTime(transaction);
      return (Array.isArray(transaction?.items) ? transaction.items : []).some(item => {
        const itemCategory = text(item?.category);
        const variantId = text(item?.variantId);
        const quantity = nonNegativeInt(item?.quantity);
        if (
          quantity <= 0 ||
          variantId ||
          itemCategory !== category ||
          !TRACKED_CATEGORIES.has(itemCategory)
        ) {
          return false;
        }
        return !txMs || txMs > checkpointMs;
      });
    });
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
  const allCheckpoints = checkpoints(session);
  const latestOverall = allCheckpoints.at(-1) || null;
  const latestByVariant = latestCheckpointItemByVariant(session);
  const flow = summarizeEventFlow(session);
  const targetRows = flow.adjustedOpeningItems.filter(item =>
    TRACKED_CATEGORIES.has(text(item?.category)) && text(item?.variantId)
  );
  const closingById = new Map(
    closingItems(session).map(item => [text(item?.variantId), item])
  );

  if (!allCheckpoints.length) {
    return {
      sessionId,
      sessionStatus: text(session?.status),
      hasCheckpoint: false,
      checkpointId: "",
      checkpointType: "",
      checkpointLabel: "",
      checkpointCapturedAtIso: "",
      sourceCheckpointCount: 0,
      totalTrackedSkuCount: targetRows.length,
      reusableCount: 0,
      carryableCount: 0,
      recheckCount: targetRows.filter(row => !hasClosingQty(closingById.get(text(row?.variantId)))).length,
      alreadyClosingCount: targetRows.filter(row => hasClosingQty(closingById.get(text(row?.variantId)))).length,
      effectiveComplete: targetRows.length > 0 && targetRows.every(row => hasClosingQty(closingById.get(text(row?.variantId)))),
      reusableRows: [],
      carryableRows: [],
      recheckRows: [],
      loadedUpdatedAtKey: timestampKey(session?.updatedAt)
    };
  }

  const currentSold = currentSoldByVariant(session);
  const rawFlowEntries = (Array.isArray(session?.inventoryCount?.flowEntries)
    ? session.inventoryCount.flowEntries
    : [])
    .filter(entry => ["restock", "opening_correction"].includes(text(entry?.type)));

  const rowStates = targetRows.map(row => {
    const variantId = text(row?.variantId);
    const category = text(row?.category);
    const source = latestByVariant.get(variantId) || null;
    const checkpoint = source?.checkpoint || null;
    const cpItem = source?.item || null;
    const checkpointMs = timestampMs(checkpoint?.capturedAtIso);
    const capturedSold = checkpoint?.soldByVariantSnapshot &&
      typeof checkpoint.soldByVariantSnapshot === "object"
        ? checkpoint.soldByVariantSnapshot
        : {};
    const closing = closingById.get(variantId) || null;
    const alreadyClosing = hasClosingQty(closing);
    const reasons = [];

    if (!cpItem) reasons.push("前回カウントなし");

    if (
      cpItem &&
      nonNegativeInt(capturedSold?.[variantId]) !==
      nonNegativeInt(currentSold?.[variantId])
    ) {
      reasons.push("SKU販売/取消あり");
    }

    if (cpItem) {
      const flowChanged = rawFlowEntries.some(entry =>
        text(entry?.variantId) === variantId &&
        timestampMs(entry?.recordedAtIso) > checkpointMs
      );
      if (flowChanged) reasons.push("Restock/開始修正あり");

      if (quickCategoryChangedAfter(transactions, category, checkpointMs)) {
        reasons.push("Quick販売あり");
      }
    }

    const reusable = Boolean(cpItem) && reasons.length === 0;
    const carryable = reusable && !alreadyClosing;
    const needsRecheck = !alreadyClosing && !reusable;

    return {
      variantId,
      category,
      label: text(row?.label || row?.sku || variantId),
      detail: text(row?.detail),
      physicalQty: cpItem ? nonNegativeInt(cpItem.physicalQty) : null,
      checkpointId: text(checkpoint?.id),
      checkpointType: text(checkpoint?.type || "checkpoint"),
      checkpointLabel: text(checkpoint?.label),
      checkpointCapturedAtIso: text(checkpoint?.capturedAtIso),
      reusable,
      carryable,
      needsRecheck,
      alreadyClosing,
      reasons
    };
  });

  const reusableRows = rowStates.filter(row => row.reusable);
  const carryableRows = rowStates.filter(row => row.carryable);
  const recheckRows = rowStates.filter(row => row.needsRecheck);
  const alreadyClosingRows = rowStates.filter(row => row.alreadyClosing);
  const sourceCheckpointIds = Array.from(new Set(
    reusableRows.map(row => row.checkpointId).filter(Boolean)
  ));

  return {
    sessionId,
    sessionStatus: text(session?.status),
    hasCheckpoint: true,
    checkpointId: text(latestOverall?.id),
    checkpointType: text(latestOverall?.type || "checkpoint"),
    checkpointLabel: text(latestOverall?.label),
    checkpointCapturedAtIso: text(latestOverall?.capturedAtIso),
    sourceCheckpointCount: sourceCheckpointIds.length,
    sourceCheckpointIds,
    totalTrackedSkuCount: targetRows.length,
    reusableCount: reusableRows.length,
    carryableCount: carryableRows.length,
    recheckCount: recheckRows.length,
    alreadyClosingCount: alreadyClosingRows.length,
    effectiveComplete:
      targetRows.length > 0 &&
      rowStates.every(row => row.alreadyClosing || row.reusable),
    reusableRows,
    carryableRows,
    recheckRows,
    loadedUpdatedAtKey: timestampKey(session?.updatedAt)
  };
}

export async function loadCheckpointReuseSummary({ sessionId }) {
  const cleanSessionId = text(sessionId);
  if (!cleanSessionId) throw new Error("販売セッションが見つかりません。");
  const loaded = await loadSessionAndSales(cleanSessionId);
  return buildSummary(cleanSessionId, loaded.session, loaded.transactions);
}

export async function applyReusableCheckpointToClosing({
  sessionId,
  savedByEmail = ""
}) {
  const cleanSessionId = text(sessionId);
  if (!cleanSessionId) throw new Error("販売セッションが見つかりません。");

  const loaded = await loadSessionAndSales(cleanSessionId);
  const summary = buildSummary(cleanSessionId, loaded.session, loaded.transactions);

  if (!summary.hasCheckpoint) {
    const error = new Error("再利用できる途中カウントがありません。");
    error.code = "checkpoint-missing";
    throw error;
  }

  if (!["open", "pending_allocation"].includes(summary.sessionStatus)) {
    throw new Error("正式終了済みイベントではカウントを変更できません。");
  }

  if (summary.carryableCount <= 0) {
    return {
      sessionId: cleanSessionId,
      appliedCount: 0,
      recheckCount: summary.recheckCount,
      checkpointId: summary.checkpointId,
      duplicate: true
    };
  }

  const { runTransaction, serverTimestamp } = await firestoreModule();
  const carryById = new Map(
    summary.carryableRows.map(row => [row.variantId, row])
  );

  return await runTransaction(loaded.db, async transaction => {
    const currentSnapshot = await transaction.get(loaded.sessionRef);
    if (!currentSnapshot.exists()) throw new Error("販売セッションが見つかりません。");
    const current = currentSnapshot.data();

    if (!["open", "pending_allocation"].includes(text(current?.status))) {
      throw new Error("イベント状態が変更されました。画面を更新してください。");
    }

    if (timestampKey(current?.updatedAt) !== summary.loadedUpdatedAtKey) {
      const error = new Error("前回カウント確認後に売上または在庫情報が変わりました。画面を更新してもう一度確認してください。");
      error.code = "event-data-changed";
      throw error;
    }

    const currentItems = closingItems(current);
    const currentById = new Map(
      currentItems.map(item => [text(item?.variantId), item])
    );
    const nextById = new Map(
      currentItems.map(item => [text(item?.variantId), { ...item }])
    );

    let appliedCount = 0;
    const usedCheckpointIds = new Set();

    carryById.forEach((row, variantId) => {
      const existing = currentById.get(variantId);
      if (hasClosingQty(existing)) return;

      nextById.set(variantId, {
        ...(existing || {}),
        variantId,
        closingQty: nonNegativeInt(row.physicalQty),
        loss: nonNegativeInt(existing?.loss),
        theft: nonNegativeInt(existing?.theft),
        damage: nonNegativeInt(existing?.damage),
        gift: nonNegativeInt(existing?.gift),
        sample: nonNegativeInt(existing?.sample),
        stockAdjustment: int(existing?.stockAdjustment),
        countSource: "checkpoint_reuse",
        checkpointId: row.checkpointId,
        checkpointCapturedAtIso: row.checkpointCapturedAtIso
      });
      if (row.checkpointId) usedCheckpointIds.add(row.checkpointId);
      appliedCount += 1;
    });

    const nextItems = Array.from(nextById.values());
    const targetRows = summarizeEventFlow(current).adjustedOpeningItems.filter(item =>
      TRACKED_CATEGORIES.has(text(item?.category)) && text(item?.variantId)
    );
    const mergedById = new Map(nextItems.map(item => [text(item?.variantId), item]));
    const tshirtRows = targetRows.filter(item => text(item?.category) === "tshirt");
    const accessoryRows = targetRows.filter(item => text(item?.category) !== "tshirt");
    const tshirtComplete = tshirtRows.length > 0 && tshirtRows.every(item => hasClosingQty(mergedById.get(text(item?.variantId))));
    const accessoryComplete = accessoryRows.length > 0 && accessoryRows.every(item => hasClosingQty(mergedById.get(text(item?.variantId))));

    const payload = {
      "inventoryCount.closing": {
        ...(current?.inventoryCount?.closing || {}),
        savedAt: serverTimestamp(),
        savedByEmail: text(savedByEmail),
        items: nextItems
      },
      "inventoryCount.checkpointReuse": {
        version: 2,
        checkpointId: summary.checkpointId,
        checkpointType: summary.checkpointType,
        checkpointCapturedAtIso: summary.checkpointCapturedAtIso,
        sourceCheckpointIds: Array.from(usedCheckpointIds),
        sourceCheckpointCount: usedCheckpointIds.size,
        appliedCount,
        reusableCount: summary.reusableCount,
        recheckCount: summary.recheckCount,
        appliedByEmail: text(savedByEmail),
        appliedAt: serverTimestamp()
      },
      "inventoryCount.updatedAt": serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    if (tshirtComplete && text(current?.inventoryCount?.externalCounts?.tshirt?.status) !== "confirmed") {
      payload["inventoryCount.externalCounts.tshirt.status"] = "confirmed";
      payload["inventoryCount.externalCounts.tshirt.source"] = "checkpoint_reuse";
      payload["inventoryCount.externalCounts.tshirt.confirmedAt"] = serverTimestamp();
      payload["inventoryCount.externalCounts.tshirt.confirmedByEmail"] = text(savedByEmail);
    }

    if (accessoryComplete && text(current?.inventoryCount?.externalCounts?.accessory?.status) !== "confirmed") {
      payload["inventoryCount.externalCounts.accessory.status"] = "confirmed";
      payload["inventoryCount.externalCounts.accessory.source"] = "checkpoint_reuse";
      payload["inventoryCount.externalCounts.accessory.confirmedAt"] = serverTimestamp();
      payload["inventoryCount.externalCounts.accessory.confirmedByEmail"] = text(savedByEmail);
    }

    transaction.update(loaded.sessionRef, payload);

    return {
      sessionId: cleanSessionId,
      appliedCount,
      recheckCount: summary.recheckCount,
      checkpointId: summary.checkpointId,
      sourceCheckpointCount: usedCheckpointIds.size,
      duplicate: appliedCount === 0
    };
  });
}
