import { getFirebaseState } from "../firebase.js";
import { planAccessoryEventBackfill } from "./accessoryEventBackfill.mjs";

const SESSION_COLLECTION = "salesSessions";
const ALLOWED_ADJUSTMENT_TYPES = new Set([
  "restock",
  "opening_correction"
]);
const ALLOWED_CHECKPOINT_TYPES = new Set([
  "checkpoint",
  "daily_close",
  "final_count"
]);

async function firestoreModule() {
  return await import(
    "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js"
  );
}

async function requireDb() {
  const { db, enabled } = getFirebaseState();
  if (!enabled || !db) {
    throw new Error("Firebase is not connected.");
  }
  return db;
}

function text(value) {
  return String(value ?? "").trim();
}

function int(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function nonNegativeInt(value) {
  return Math.max(0, int(value));
}

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix) {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}_${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeOpeningItems(session) {
  const rows = Array.isArray(session?.inventoryCount?.opening?.items)
    ? session.inventoryCount.opening.items
    : [];

  return rows
    .map(row => ({
      variantId: text(row?.variantId),
      category: text(row?.category),
      inventorySource: text(row?.inventorySource),
      inventoryKey: text(row?.inventoryKey),
      sku: text(row?.sku),
      label: text(row?.label),
      detail: text(row?.detail),
      openingQty: nonNegativeInt(row?.openingQty)
    }))
    .filter(row => row.variantId);
}

function normalizeFlowEntries(session) {
  const rows = Array.isArray(session?.inventoryCount?.flowEntries)
    ? session.inventoryCount.flowEntries
    : [];

  return rows
    .map(row => ({
      id: text(row?.id),
      type: text(row?.type),
      variantId: text(row?.variantId),
      quantity: int(row?.quantity),
      note: text(row?.note),
      recordedAtIso: text(row?.recordedAtIso),
      recordedByEmail: text(row?.recordedByEmail),
      item: row?.item && typeof row.item === "object"
        ? {
            variantId: text(row.item.variantId),
            category: text(row.item.category),
            inventorySource: text(row.item.inventorySource),
            inventoryKey: text(row.item.inventoryKey),
            sku: text(row.item.sku),
            label: text(row.item.label),
            detail: text(row.item.detail)
          }
        : null
    }))
    .filter(row => row.id && row.variantId && ALLOWED_ADJUSTMENT_TYPES.has(row.type));
}

function normalizeSoldByVariant(session) {
  const source = session?.inventoryCount?.soldByVariant;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return {};
  }
  const result = {};
  Object.entries(source).forEach(([variantId, qty]) => {
    const id = text(variantId);
    if (id) result[id] = nonNegativeInt(qty);
  });
  return result;
}

function normalizeCheckpointItems(value) {
  return (Array.isArray(value) ? value : [])
    .map(row => ({
      variantId: text(row?.variantId),
      physicalQty:
        row?.physicalQty === null || row?.physicalQty === undefined || row?.physicalQty === ""
          ? null
          : nonNegativeInt(row.physicalQty)
    }))
    .filter(row => row.variantId && row.physicalQty !== null);
}

function normalizeCheckpoints(session) {
  const rows = Array.isArray(session?.inventoryCount?.checkpoints)
    ? session.inventoryCount.checkpoints
    : [];

  return rows
    .map(row => ({
      id: text(row?.id),
      type: ALLOWED_CHECKPOINT_TYPES.has(text(row?.type))
        ? text(row.type)
        : "checkpoint",
      label: text(row?.label),
      capturedAtIso: text(row?.capturedAtIso),
      capturedByEmail: text(row?.capturedByEmail),
      flowEntryCountAtCapture: nonNegativeInt(row?.flowEntryCountAtCapture),
      soldByVariantSnapshot:
        row?.soldByVariantSnapshot && typeof row.soldByVariantSnapshot === "object"
          ? Object.fromEntries(
              Object.entries(row.soldByVariantSnapshot).map(([k, v]) => [text(k), nonNegativeInt(v)])
            )
          : {},
      items: normalizeCheckpointItems(row?.items)
    }))
    .filter(row => row.id);
}

function itemMetaMap(session) {
  const map = new Map();
  normalizeOpeningItems(session).forEach(row => map.set(row.variantId, { ...row }));
  normalizeFlowEntries(session).forEach(entry => {
    if (!map.has(entry.variantId) && entry.item) {
      map.set(entry.variantId, {
        ...entry.item,
        openingQty: 0
      });
    }
  });
  return map;
}

export function calculateEventInventoryState(session) {
  const opening = normalizeOpeningItems(session);
  const flowEntries = normalizeFlowEntries(session);
  const soldByVariant = normalizeSoldByVariant(session);
  const checkpoints = normalizeCheckpoints(session);
  const meta = itemMetaMap(session);
  const ids = new Set([
    ...opening.map(row => row.variantId),
    ...flowEntries.map(row => row.variantId),
    ...Object.keys(soldByVariant)
  ]);

  const openingMap = new Map(opening.map(row => [row.variantId, row.openingQty]));
  const latestCheckpoint = checkpoints.length
    ? [...checkpoints].sort((a, b) => a.capturedAtIso.localeCompare(b.capturedAtIso)).at(-1)
    : null;
  const latestPhysicalMap = new Map(
    (latestCheckpoint?.items || []).map(row => [row.variantId, row.physicalQty])
  );

  const rows = [...ids].map(variantId => {
    let restockQty = 0;
    let openingCorrection = 0;
    flowEntries.forEach(entry => {
      if (entry.variantId !== variantId) return;
      if (entry.type === "restock") restockQty += Math.max(0, entry.quantity);
      if (entry.type === "opening_correction") openingCorrection += entry.quantity;
    });

    const openingQty = openingMap.get(variantId) || 0;
    const skuSales = soldByVariant[variantId] || 0;
    const expectedQty = openingQty + restockQty + openingCorrection - skuSales;
    const physicalQty = latestPhysicalMap.has(variantId)
      ? latestPhysicalMap.get(variantId)
      : null;

    return {
      variantId,
      ...(meta.get(variantId) || {}),
      openingQty,
      restockQty,
      openingCorrection,
      skuSales,
      expectedQty,
      physicalQty,
      difference: physicalQty === null ? null : physicalQty - expectedQty
    };
  });

  const checkpointStillCurrent = (() => {
    if (!latestCheckpoint) return false;
    if (latestCheckpoint.flowEntryCountAtCapture !== flowEntries.length) return false;
    const captured = latestCheckpoint.soldByVariantSnapshot || {};
    const keys = new Set([...Object.keys(captured), ...Object.keys(soldByVariant)]);
    for (const key of keys) {
      if (nonNegativeInt(captured[key]) !== nonNegativeInt(soldByVariant[key])) return false;
    }
    return true;
  })();

  return {
    opening,
    flowEntries,
    soldByVariant,
    checkpoints,
    latestCheckpoint,
    checkpointStillCurrent,
    rows
  };
}

export async function listOpenEventSessions() {
  const db = await requireDb();
  const { collection, query, where, getDocsFromServer } = await firestoreModule();
  const snapshot = await getDocsFromServer(
    query(collection(db, SESSION_COLLECTION), where("status", "==", "open"))
  );
  return snapshot.docs
    .map(docSnap => ({ id: docSnap.id, ...docSnap.data() }))
    .filter(session => (session.type || "event") === "event")
    .sort((a, b) => String(b.startDate || b.createdAt || "").localeCompare(String(a.startDate || a.createdAt || "")));
}

export async function loadEventInventoryFlow(sessionId) {
  const cleanSessionId = text(sessionId);
  if (!cleanSessionId) throw new Error("販売セッションを選択してください。");

  const db = await requireDb();
  const { doc, getDocFromServer } = await firestoreModule();
  const ref = doc(db, SESSION_COLLECTION, cleanSessionId);
  const snapshot = await getDocFromServer(ref);
  if (!snapshot.exists()) throw new Error("販売セッションが見つかりません。");
  const session = { id: snapshot.id, ...snapshot.data() };
  return { session, state: calculateEventInventoryState(session) };
}

export async function addEventInventoryAdjustment({
  sessionId,
  type,
  variantId,
  quantity,
  note = "",
  recordedByEmail = "",
  item = null
}) {
  const cleanSessionId = text(sessionId);
  const cleanType = text(type);
  const cleanVariantId = text(variantId);
  let cleanQuantity = int(quantity);

  if (!cleanSessionId || !cleanVariantId) throw new Error("イベントまたはSKUが不明です。");
  if (!ALLOWED_ADJUSTMENT_TYPES.has(cleanType)) throw new Error("在庫変更の種類が不正です。");
  if (cleanType === "restock") cleanQuantity = Math.max(0, cleanQuantity);
  if (!cleanQuantity) throw new Error("数量を入力してください。");

  const db = await requireDb();
  const { doc, runTransaction, serverTimestamp } = await firestoreModule();
  const ref = doc(db, SESSION_COLLECTION, cleanSessionId);

  const entry = {
    id: makeId("flow"),
    type: cleanType,
    variantId: cleanVariantId,
    quantity: cleanQuantity,
    note: text(note),
    recordedAtIso: nowIso(),
    recordedByEmail: text(recordedByEmail),
    item: item && typeof item === "object"
      ? {
          variantId: cleanVariantId,
          category: text(item.category),
          inventorySource: text(item.inventorySource),
          inventoryKey: text(item.inventoryKey),
          sku: text(item.sku),
          label: text(item.label),
          detail: text(item.detail)
        }
      : null
  };

  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) throw new Error("販売セッションが見つかりません。");
    const session = snapshot.data();
    if (session?.status !== "open") throw new Error("終了済みイベントは変更できません。");
    if (!session?.inventoryCount?.opening) throw new Error("先に開始在庫を保存してください。");

    const existing = normalizeFlowEntries(session);
    transaction.update(ref, {
      "inventoryCount.flowEntries": [...existing, entry],
      "inventoryCount.flowUpdatedAt": serverTimestamp(),
      "inventoryCount.updatedAt": serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  });

  return entry;
}

export async function backfillMissingAccessoryStock({ sessionId, catalogRows, selectedVariantIds, recordedByEmail = "" }) {
  const cleanSessionId = text(sessionId);
  if (!cleanSessionId) throw new Error("販売セッションを選択してください。");
  const db = await requireDb();
  const { doc, runTransaction, serverTimestamp } = await firestoreModule();
  const sessionRef = doc(db, SESSION_COLLECTION, cleanSessionId);
  const stockRef = doc(db, "accessoryStock", "shared");

  return runTransaction(db, async transaction => {
    const sessionSnapshot = await transaction.get(sessionRef);
    const stockSnapshot = await transaction.get(stockRef);
    if (!sessionSnapshot.exists()) throw new Error("販売セッションが見つかりません。");
    if (!stockSnapshot.exists()) throw new Error("アクセサリーの実在庫を確認できません。");
    const session = sessionSnapshot.data();
    if (session.status !== "open" || !session.inventoryCount?.opening) {
      throw new Error("開始在庫が保存された進行中のイベントを選択してください。");
    }
    const designs = Array.isArray(stockSnapshot.data()?.designs) ? stockSnapshot.data().designs : [];
    const stockBySource = new Map();
    const validRows = [];
    for (const design of designs) {
      const sourceId = text(design?.id);
      if (!sourceId) continue;
      for (const stockField of ["piercing", "earring"]) {
        const category = text(design?.category) === "puraplara"
          ? (stockField === "piercing" ? "drop_pierce" : "drop_earring")
          : (stockField === "piercing" ? "pierce" : "earring");
        const variantId = ["accessory", encodeURIComponent(category), encodeURIComponent(sourceId)].join("__");
        stockBySource.set(`${sourceId}|${stockField}`, Number(design?.[stockField]));
        const row = (catalogRows || []).find(item => item.variantId === variantId &&
          item.sourceId === sourceId && item.stockField === stockField && item.category === category);
        if (row) validRows.push(row);
      }
    }
    const planned = planAccessoryEventBackfill(session, validRows, stockBySource, selectedVariantIds);
    if (!planned.length) return { added: 0, quantity: 0, variantIds: [] };
    const batchId = makeId("accessory_backfill");
    const entries = planned.map(row => ({
      id: makeId("flow"), batchId, type: "opening_correction", variantId: row.variantId,
      quantity: row.quantity, note: "開始時に持参したアクセサリーの登録漏れ",
      recordedAtIso: nowIso(), recordedByEmail: text(recordedByEmail),
      item: {
        variantId: row.variantId, category: row.category, inventorySource: "accessory",
        inventoryKey: row.inventoryKey, sku: row.sku || row.variantId,
        label: row.label, detail: row.detail
      }
    }));
    const previous = Array.isArray(session.inventoryCount.flowEntries)
      ? session.inventoryCount.flowEntries : [];
    const combined = [...previous, ...entries];
    if (JSON.stringify(combined).length > 800000) {
      throw new Error("一括登録の件数が多いため保存できません。対象を分けて登録してください。");
    }
    transaction.update(sessionRef, {
      "inventoryCount.flowEntries": combined,
      "inventoryCount.flowUpdatedAt": serverTimestamp(),
      "inventoryCount.updatedAt": serverTimestamp(), updatedAt: serverTimestamp()
    });
    return { added: entries.length, quantity: entries.reduce((sum, entry) => sum + entry.quantity, 0),
      variantIds: entries.map(entry => entry.variantId) };
  });
}

export async function deleteEventInventoryAdjustment({ sessionId, entryId }) {
  const cleanSessionId = text(sessionId);
  const cleanEntryId = text(entryId);
  if (!cleanSessionId || !cleanEntryId) throw new Error("削除対象が不明です。");

  const db = await requireDb();
  const { doc, runTransaction, serverTimestamp } = await firestoreModule();
  const ref = doc(db, SESSION_COLLECTION, cleanSessionId);

  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) throw new Error("販売セッションが見つかりません。");
    const session = snapshot.data();
    if (session?.status !== "open") throw new Error("終了済みイベントは変更できません。");
    const existing = normalizeFlowEntries(session);
    const next = existing.filter(entry => entry.id !== cleanEntryId);
    if (next.length === existing.length) throw new Error("変更履歴が見つかりません。");
    transaction.update(ref, {
      "inventoryCount.flowEntries": next,
      "inventoryCount.flowUpdatedAt": serverTimestamp(),
      "inventoryCount.updatedAt": serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  });
}

export async function saveEventInventoryCheckpoint({
  sessionId,
  items,
  type = "checkpoint",
  label = "",
  capturedByEmail = ""
}) {
  const cleanSessionId = text(sessionId);
  const cleanType = ALLOWED_CHECKPOINT_TYPES.has(text(type)) ? text(type) : "checkpoint";
  const cleanItems = normalizeCheckpointItems(items);
  if (!cleanSessionId) throw new Error("販売セッションを選択してください。");
  if (!cleanItems.length) throw new Error("実在庫を1点以上入力してください。");

  const db = await requireDb();
  const { doc, runTransaction, serverTimestamp } = await firestoreModule();
  const ref = doc(db, SESSION_COLLECTION, cleanSessionId);
  let checkpoint = null;

  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) throw new Error("販売セッションが見つかりません。");
    const session = snapshot.data();
    if (session?.status !== "open") throw new Error("終了済みイベントではカウントを保存できません。");
    if (!session?.inventoryCount?.opening) throw new Error("先に開始在庫を保存してください。");

    const flowEntries = normalizeFlowEntries(session);
    const soldByVariant = normalizeSoldByVariant(session);
    const checkpoints = normalizeCheckpoints(session);

    checkpoint = {
      id: makeId("count"),
      type: cleanType,
      label: text(label),
      capturedAtIso: nowIso(),
      capturedByEmail: text(capturedByEmail),
      flowEntryCountAtCapture: flowEntries.length,
      soldByVariantSnapshot: soldByVariant,
      items: cleanItems
    };

    transaction.update(ref, {
      "inventoryCount.checkpoints": [...checkpoints, checkpoint],
      "inventoryCount.checkpointUpdatedAt": serverTimestamp(),
      "inventoryCount.updatedAt": serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  });

  return checkpoint;
}

export async function deleteEventInventoryCheckpoint({ sessionId, checkpointId }) {
  const cleanSessionId = text(sessionId);
  const cleanCheckpointId = text(checkpointId);
  if (!cleanSessionId || !cleanCheckpointId) throw new Error("削除対象が不明です。");

  const db = await requireDb();
  const { doc, runTransaction, serverTimestamp } = await firestoreModule();
  const ref = doc(db, SESSION_COLLECTION, cleanSessionId);

  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) throw new Error("販売セッションが見つかりません。");
    const session = snapshot.data();
    if (session?.status !== "open") throw new Error("終了済みイベントは変更できません。");
    const existing = normalizeCheckpoints(session);
    const next = existing.filter(row => row.id !== cleanCheckpointId);
    if (next.length === existing.length) throw new Error("在庫カウントが見つかりません。");
    transaction.update(ref, {
      "inventoryCount.checkpoints": next,
      "inventoryCount.checkpointUpdatedAt": serverTimestamp(),
      "inventoryCount.updatedAt": serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  });
}
