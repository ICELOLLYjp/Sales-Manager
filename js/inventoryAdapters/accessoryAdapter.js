import { getFirebaseState } from "../firebase.js";

const COLLECTION = "accessoryStock";
const DOCUMENT = "shared";

async function firestoreModule() {
  return await import(
    "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js"
  );
}

async function loadSharedDocument() {
  const { db, enabled } = getFirebaseState();

  if (!enabled || !db) {
    throw new Error("Firebase is not connected.");
  }

  const { doc, getDoc } = await firestoreModule();

  const snapshot = await getDoc(
    doc(db, COLLECTION, DOCUMENT)
  );

  if (!snapshot.exists()) {
    throw new Error("accessoryStock/shared was not found.");
  }

  return snapshot.data();
}

function encodePart(value) {
  return encodeURIComponent(String(value || ""));
}

function buildVariantId(category, sourceId) {
  return [
    "accessory",
    encodePart(category),
    encodePart(sourceId)
  ].join("__");
}

function buildInventoryKey(sourceId, stockField) {
  return [
    "accessory:",
    encodePart(sourceId),
    "|",
    encodePart(stockField)
  ].join("");
}

function categoryFor(sourceCategory, stockField) {
  if (sourceCategory === "puraplara") {
    return stockField === "piercing"
      ? "drop_pierce"
      : "drop_earring";
  }

  return stockField === "piercing"
    ? "pierce"
    : "earring";
}

function categoryLabel(category) {
  const labels = {
    pierce: "ピアス",
    earring: "イヤリング",
    drop_pierce: "ドロップタイプピアス",
    drop_earring: "ドロップタイプイヤリング"
  };

  return labels[category] || category;
}

function buildRows(designs) {
  const rows = [];

  (Array.isArray(designs) ? designs : []).forEach(item => {
    const sourceId = String(item?.id || "").trim();
    const name = String(item?.name || "").trim();
    const sourceCategory = String(item?.category || "standard").trim();

    if (!sourceId || !name) return;

    ["piercing", "earring"].forEach(stockField => {
      const category = categoryFor(sourceCategory, stockField);
      const quantity = Math.max(
        0,
        Number(item?.[stockField] || 0)
      );

      rows.push({
        variantId: buildVariantId(category, sourceId),
        productId: category,
        category,
        categoryLabel: categoryLabel(category),
        displayName: name,
        design: name,
        sourceId,
        sourceCategory,
        stockField,
        quantity,
        inventorySource: "accessory",
        inventoryKey: buildInventoryKey(sourceId, stockField),
        inventoryStatus: "tracked",
        saleStatus: "active",
        active: true,
        priority: Math.max(0, Number(item?.priority || 0)),
        source: "accessoryStock/shared"
      });
    });
  });

  return rows;
}

export const accessoryAdapter = {
  async getCatalogSnapshot() {
    const shared = await loadSharedDocument();
    const rows = buildRows(shared?.designs);

    const counts = {
      pierce: 0,
      earring: 0,
      drop_pierce: 0,
      drop_earring: 0
    };

    let totalStock = 0;

    rows.forEach(row => {
      totalStock += row.quantity;
      counts[row.category] += 1;
    });

    return {
      summary: {
        source: "accessoryStock/shared",
        designCount: Array.isArray(shared?.designs)
          ? shared.designs.length
          : 0,
        skuCount: rows.length,
        totalStock,
        counts
      },
      rows
    };
  },

  async getStock(inventoryKey) {
    const value = String(inventoryKey || "");

    if (!value.startsWith("accessory:")) {
      return null;
    }

    const parts = value
      .slice(10)
      .split("|")
      .map(part => decodeURIComponent(part));

    if (parts.length !== 2) {
      return null;
    }

    const [sourceId, stockField] = parts;
    const shared = await loadSharedDocument();
    const item = (shared?.designs || []).find(
      design => String(design?.id || "") === sourceId
    );

    if (!item) {
      return 0;
    }

    return Math.max(
      0,
      Number(item?.[stockField] || 0)
    );
  },

  async changeStock(inventoryKey, quantityChange, operationId) {
    console.warn("Read only phase", {
      inventoryKey,
      quantityChange,
      operationId
    });

    throw new Error(
      "アクセサリー在庫は現在読み取り専用です。"
    );
  },

  async canTrack(inventoryKey) {
    return String(inventoryKey || "").startsWith(
      "accessory:"
    );
  }
};
