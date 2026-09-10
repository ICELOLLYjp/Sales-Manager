import { getFirebaseState } from "../firebase.js";

const COLLECTION = "accessoryStock";
const DOCUMENT = "shared";
const LOCAL_STORAGE_KEY = "accessory-inventory-designs-v1";

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

function normalizeDesigns(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items.map(item => ({
    ...item,
    id: String(item?.id || "").trim(),
    name: String(item?.name || "").trim(),
    category: String(item?.category || "standard").trim(),
    piercing: Math.max(0, Number(item?.piercing || 0)),
    earring: Math.max(0, Number(item?.earring || 0)),
    priority: Math.max(0, Number(item?.priority || 0))
  }));
}

function loadLocalDesigns() {
  try {
    const saved = localStorage.getItem(
      LOCAL_STORAGE_KEY
    );

    if (!saved) {
      return [];
    }

    return normalizeDesigns(
      JSON.parse(saved)
    );
  } catch (error) {
    console.warn(
      "Accessory local stock could not be read.",
      error
    );

    return [];
  }
}

function encodePart(value) {
  return encodeURIComponent(
    String(value || "")
  );
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

function buildVariantId(
  category,
  sourceId
) {
  return [
    "accessory",
    encodePart(category),
    encodePart(sourceId)
  ].join("__");
}

function buildInventoryKey(
  sourceId,
  stockField
) {
  return [
    "accessory:",
    encodePart(sourceId),
    "|",
    encodePart(stockField)
  ].join("");
}

function buildRows(
  designs,
  options = {}
) {
  const onlyPositive =
    Boolean(options.onlyPositive);

  const rows = [];

  normalizeDesigns(designs).forEach(
    item => {
      if (
        !item.id ||
        !item.name
      ) {
        return;
      }

      [
        "piercing",
        "earring"
      ].forEach(
        stockField => {
          const quantity =
            Math.max(
              0,
              Number(
                item?.[stockField] || 0
              )
            );

          if (
            onlyPositive &&
            quantity <= 0
          ) {
            return;
          }

          const category =
            categoryFor(
              item.category,
              stockField
            );

          rows.push({
            variantId:
              buildVariantId(
                category,
                item.id
              ),

            productId:
              category,

            category,

            categoryLabel:
              categoryLabel(
                category
              ),

            displayName:
              item.name,

            design:
              item.name,

            sourceId:
              item.id,

            sourceCategory:
              item.category,

            stockField,

            quantity,

            inventorySource:
              "accessory",

            inventoryKey:
              buildInventoryKey(
                item.id,
                stockField
              ),

            inventoryStatus:
              "tracked",

            saleStatus:
              "active",

            active:
              true,

            priority:
              item.priority,

            source:
              "accessoryStock/shared"
          });
        }
      );
    }
  );

  return rows;
}

function stockSummary(
  designs
) {
  const rows =
    buildRows(
      designs,
      {
        onlyPositive:
          true
      }
    );

  return {
    designCount:
      normalizeDesigns(
        designs
      ).length,

    inStockSkuCount:
      rows.length,

    totalStock:
      rows.reduce(
        (
          sum,
          row
        ) =>
          sum +
          row.quantity,
        0
      ),

    rows
  };
}

export const accessoryAdapter = {
  async getCatalogSnapshot() {
    const shared =
      await loadSharedDocument();

    const cloudDesigns =
      normalizeDesigns(
        shared?.designs
      );

    const localDesigns =
      loadLocalDesigns();

    const cloud =
      stockSummary(
        cloudDesigns
      );

    const local =
      stockSummary(
        localDesigns
      );

    let sourceState =
      "empty";

    if (
      cloud.totalStock > 0
    ) {
      sourceState =
        "cloud_ready";
    } else if (
      local.totalStock > 0
    ) {
      sourceState =
        "local_only";
    }

    return {
      summary: {
        source:
          "accessoryStock/shared",

        designCount:
          cloud.designCount,

        currentStockSkuCount:
          cloud.inStockSkuCount,

        totalStock:
          cloud.totalStock,

        localDesignCount:
          local.designCount,

        localInStockSkuCount:
          local.inStockSkuCount,

        localTotalStock:
          local.totalStock,

        sourceState
      },

      rows:
        cloud.rows
    };
  },

  async getStock(
    inventoryKey
  ) {
    const value =
      String(
        inventoryKey || ""
      );

    if (
      !value.startsWith(
        "accessory:"
      )
    ) {
      return null;
    }

    const parts =
      value
        .slice(10)
        .split("|")
        .map(
          part =>
            decodeURIComponent(
              part
            )
        );

    if (
      parts.length !== 2
    ) {
      return null;
    }

    const [
      sourceId,
      stockField
    ] = parts;

    const shared =
      await loadSharedDocument();

    const item =
      normalizeDesigns(
        shared?.designs
      ).find(
        design =>
          design.id ===
          sourceId
      );

    if (!item) {
      return 0;
    }

    return Math.max(
      0,
      Number(
        item?.[stockField] || 0
      )
    );
  },

  async changeStock(
    inventoryKey,
    quantityChange,
    operationId
  ) {
    console.warn(
      "Read only phase",
      {
        inventoryKey,
        quantityChange,
        operationId
      }
    );

    throw new Error(
      "アクセサリー在庫は現在読み取り専用です。"
    );
  },

  async canTrack(
    inventoryKey
  ) {
    return String(
      inventoryKey || ""
    ).startsWith(
      "accessory:"
    );
  }
};
