import { getFirebaseState } from "../firebase.js";

const COLLECTION = "tshirtStock";
const MASTER_DOCUMENT = "master";

async function firestoreModule() {
  return await import("https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js");
}

function text(value) {
  return String(value ?? "").trim();
}

function nonNegativeInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

function decodePart(value) {
  try {
    return decodeURIComponent(String(value || ""));
  } catch {
    return String(value || "");
  }
}

function parseVariantId(variantId) {
  const raw = text(variantId);
  const parts = raw.split("__");
  if (parts.length !== 5 || parts[0] !== "tshirt") return null;
  return {
    bodyId: decodePart(parts[1]),
    designId: decodePart(parts[2]),
    colorId: decodePart(parts[3]),
    sizeId: decodePart(parts[4])
  };
}

function cloneInventory(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function normalizeRows(rows) {
  const map = new Map();
  (Array.isArray(rows) ? rows : []).forEach(row => {
    const variantId = text(row?.variantId);
    const target = parseVariantId(variantId);
    if (!variantId || !target) return;
    map.set(variantId, {
      variantId,
      quantity: nonNegativeInt(row?.quantity),
      ...target
    });
  });
  return [...map.values()];
}

export async function saveTshirtPhysicalStock({
  rows,
  sessionId = "",
  savedByEmail = "",
  source = "inventory_flow_physical_count"
}) {
  const normalized = normalizeRows(rows);
  if (!normalized.length) {
    throw new Error("Tシャツの実数がありません。");
  }

  const { db, enabled } = getFirebaseState();
  if (!enabled || !db) {
    throw new Error("Firebase is not connected.");
  }

  const { doc, runTransaction, serverTimestamp } = await firestoreModule();
  const ref = doc(db, COLLECTION, MASTER_DOCUMENT);
  let result = null;

  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) {
      throw new Error("tshirtStock/master が見つかりません。");
    }

    const master = snapshot.data();
    const inventory = cloneInventory(master?.inventory_v2);
    let changedCount = 0;
    let totalBefore = 0;
    let totalAfter = 0;

    normalized.forEach(row => {
      inventory[row.bodyId] ||= {};
      inventory[row.bodyId][row.designId] ||= {};
      inventory[row.bodyId][row.designId][row.colorId] ||= {};

      const sizeTree = inventory[row.bodyId][row.designId][row.colorId];
      const previousCell = sizeTree[row.sizeId] && typeof sizeTree[row.sizeId] === "object"
        ? sizeTree[row.sizeId]
        : {};
      const before = nonNegativeInt(previousCell?.qty);
      const after = row.quantity;

      totalBefore += before;
      totalAfter += after;
      if (before !== after) changedCount += 1;

      sizeTree[row.sizeId] = {
        ...previousCell,
        qty: after
      };
    });

    const savedAtIso = new Date().toISOString();
    transaction.set(ref, {
      inventory_v2: inventory,
      physicalCountUpdatedAt: serverTimestamp(),
      physicalCountUpdatedAtIso: savedAtIso,
      physicalCountUpdatedByEmail: text(savedByEmail),
      physicalCountSessionId: text(sessionId),
      physicalCountSource: text(source),
      updatedAt: serverTimestamp()
    }, { merge: true });

    result = {
      savedCount: normalized.length,
      changedCount,
      totalBefore,
      totalAfter,
      savedAtIso
    };
  });

  return result;
}
