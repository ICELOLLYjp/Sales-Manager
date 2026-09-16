import { getFirebaseState } from "../firebase.js";

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
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
}

function encodePart(value) {
  return encodeURIComponent(text(value));
}

function categoryFor(sourceCategory, stockField) {
  if (text(sourceCategory) === "puraplara") {
    return stockField === "piercing" ? "drop_pierce" : "drop_earring";
  }
  return stockField === "piercing" ? "pierce" : "earring";
}

function categoryLabel(category) {
  const labels = {
    pierce: "ピアス",
    earring: "イヤリング",
    drop_pierce: "ドロップピアス",
    drop_earring: "ドロップイヤリング"
  };
  return labels[category] || category;
}

function variantId(category, sourceId) {
  return ["accessory", encodePart(category), encodePart(sourceId)].join("__");
}

function inventoryKey(sourceId, stockField) {
  return `accessory:${encodePart(sourceId)}|${encodePart(stockField)}`;
}

export async function loadAllAccessoryEventRows() {
  const db = await requireDb();
  const { doc, getDocFromServer } = await firestoreModule();
  const snapshot = await getDocFromServer(doc(db, "accessoryStock", "shared"));
  if (!snapshot.exists()) throw new Error("アクセサリー在庫マスターが見つかりません。");

  const designs = Array.isArray(snapshot.data()?.designs) ? snapshot.data().designs : [];
  const rows = [];

  designs.forEach(design => {
    const sourceId = text(design?.id);
    const label = text(design?.name);
    const sourceCategory = text(design?.category) || "standard";
    if (!sourceId || !label) return;

    ["piercing", "earring"].forEach(stockField => {
      const category = categoryFor(sourceCategory, stockField);
      rows.push({
        variantId: variantId(category, sourceId),
        category,
        inventorySource: "accessory",
        inventoryKey: inventoryKey(sourceId, stockField),
        sku: variantId(category, sourceId),
        label,
        detail: categoryLabel(category),
        sourceId,
        sourceCategory,
        stockField,
        priority: nonNegativeInt(design?.priority),
        companyStockQty: nonNegativeInt(design?.[stockField])
      });
    });
  });

  return rows;
}
