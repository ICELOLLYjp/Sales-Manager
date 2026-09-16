import { getFirebaseState } from "../firebase.js";

const SESSION_COLLECTION = "salesSessions";
const ALLOWED_CATEGORIES = new Set([
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

function intOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : null;
}

function nowIso() {
  return new Date().toISOString();
}

function makeTempId() {
  if (globalThis.crypto?.randomUUID) return `event_tmp_${globalThis.crypto.randomUUID()}`;
  return `event_tmp_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeItem(item) {
  const category = text(item?.category);
  const openingQty = intOrNull(item?.openingQty);
  const countedQty = intOrNull(item?.countedQty ?? item?.closingQty);
  return {
    tempId: text(item?.tempId),
    source: text(item?.source || "sales_manager"),
    category,
    label: text(item?.label),
    detail: text(item?.detail),
    bodyName: text(item?.bodyName),
    colorName: text(item?.colorName),
    sizeName: text(item?.sizeName),
    openingKnown: Boolean(item?.openingKnown),
    openingQty: Boolean(item?.openingKnown) ? openingQty : null,
    countedQty,
    status: text(item?.status || "unregistered"),
    linkedVariantId: text(item?.linkedVariantId) || null,
    createdAtIso: text(item?.createdAtIso),
    createdByEmail: text(item?.createdByEmail),
    updatedAtIso: text(item?.updatedAtIso),
    updatedByEmail: text(item?.updatedByEmail)
  };
}

function normalizeItems(session) {
  return (Array.isArray(session?.inventoryCount?.unregisteredItems)
    ? session.inventoryCount.unregisteredItems
    : [])
    .map(normalizeItem)
    .filter(item => item.tempId && ALLOWED_CATEGORIES.has(item.category));
}

async function loadSession(sessionId) {
  const cleanId = text(sessionId);
  if (!cleanId) throw new Error("イベントSessionを選択してください。");
  const db = await requireDb();
  const { doc, getDocFromServer } = await firestoreModule();
  const ref = doc(db, SESSION_COLLECTION, cleanId);
  const snap = await getDocFromServer(ref);
  if (!snap.exists()) throw new Error("イベントSessionが見つかりません。");
  return { db, ref, session: snap.data() };
}

function assertEditable(session) {
  const status = text(session?.status);
  if (!["open", "pending_allocation"].includes(status)) {
    throw new Error("正式終了済みイベントでは未登録商品を変更できません。");
  }
}

export async function loadEventUnregisteredItems({ sessionId }) {
  const loaded = await loadSession(sessionId);
  return {
    sessionId: text(sessionId),
    sessionStatus: text(loaded.session?.status),
    items: normalizeItems(loaded.session)
  };
}

export async function addEventUnregisteredItem({
  sessionId,
  category,
  label,
  detail = "",
  bodyName = "",
  colorName = "",
  sizeName = "",
  openingKnown = false,
  openingQty = null,
  countedQty = null,
  source = "sales_manager",
  savedByEmail = ""
}) {
  const cleanCategory = text(category);
  const cleanLabel = text(label);
  if (!ALLOWED_CATEGORIES.has(cleanCategory)) throw new Error("商品カテゴリを選択してください。");
  if (!cleanLabel) throw new Error("商品名を入力してください。");

  const loaded = await loadSession(sessionId);
  const { runTransaction, serverTimestamp } = await firestoreModule();
  const tempId = makeTempId();
  const createdAtIso = nowIso();

  const item = normalizeItem({
    tempId,
    source,
    category: cleanCategory,
    label: cleanLabel,
    detail,
    bodyName,
    colorName,
    sizeName,
    openingKnown,
    openingQty,
    countedQty,
    status: "unregistered",
    linkedVariantId: null,
    createdAtIso,
    createdByEmail: savedByEmail,
    updatedAtIso: createdAtIso,
    updatedByEmail: savedByEmail
  });

  await runTransaction(loaded.db, async transaction => {
    const snap = await transaction.get(loaded.ref);
    if (!snap.exists()) throw new Error("イベントSessionが見つかりません。");
    const current = snap.data();
    assertEditable(current);
    const items = normalizeItems(current);
    transaction.update(loaded.ref, {
      "inventoryCount.unregisteredItems": [...items, item],
      "inventoryCount.unregisteredItemsUpdatedAt": serverTimestamp(),
      "inventoryCount.updatedAt": serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  });

  return item;
}

export async function updateEventUnregisteredItemCount({
  sessionId,
  tempId,
  countedQty,
  savedByEmail = ""
}) {
  const cleanTempId = text(tempId);
  const qty = intOrNull(countedQty);
  if (!cleanTempId) throw new Error("未登録商品が見つかりません。");
  if (qty === null) throw new Error("実数を入力してください。");

  const loaded = await loadSession(sessionId);
  const { runTransaction, serverTimestamp } = await firestoreModule();
  let updated = null;

  await runTransaction(loaded.db, async transaction => {
    const snap = await transaction.get(loaded.ref);
    if (!snap.exists()) throw new Error("イベントSessionが見つかりません。");
    const current = snap.data();
    assertEditable(current);
    const items = normalizeItems(current);
    const index = items.findIndex(item => item.tempId === cleanTempId);
    if (index < 0) throw new Error("未登録商品が見つかりません。");
    updated = {
      ...items[index],
      countedQty: qty,
      updatedAtIso: nowIso(),
      updatedByEmail: text(savedByEmail)
    };
    items[index] = updated;
    transaction.update(loaded.ref, {
      "inventoryCount.unregisteredItems": items,
      "inventoryCount.unregisteredItemsUpdatedAt": serverTimestamp(),
      "inventoryCount.updatedAt": serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  });

  return updated;
}

export async function removeEventUnregisteredItem({
  sessionId,
  tempId
}) {
  const cleanTempId = text(tempId);
  if (!cleanTempId) throw new Error("未登録商品が見つかりません。");
  const loaded = await loadSession(sessionId);
  const { runTransaction, serverTimestamp } = await firestoreModule();

  await runTransaction(loaded.db, async transaction => {
    const snap = await transaction.get(loaded.ref);
    if (!snap.exists()) throw new Error("イベントSessionが見つかりません。");
    const current = snap.data();
    assertEditable(current);
    const items = normalizeItems(current);
    const target = items.find(item => item.tempId === cleanTempId);
    if (!target) throw new Error("未登録商品が見つかりません。");
    if (target.linkedVariantId || target.status === "linked") {
      throw new Error("正式SKUへ紐付け済みの商品はここから削除できません。");
    }
    transaction.update(loaded.ref, {
      "inventoryCount.unregisteredItems": items.filter(item => item.tempId !== cleanTempId),
      "inventoryCount.unregisteredItemsUpdatedAt": serverTimestamp(),
      "inventoryCount.updatedAt": serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  });

  return { sessionId: text(sessionId), tempId: cleanTempId };
}
