const CATEGORY_LABELS = {
  tshirt: "Tシャツ",
  pierce: "ピアス",
  earring: "イヤリング",
  drop_pierce: "ドロップタイプピアス",
  drop_earring: "ドロップタイプイヤリング",
  sticker: "ステッカー",
  postcard: "ポストカード",
  art_print: "アートプリント",
  accessory: "アクセサリー",
  other: "その他"
};

const TSHIRT_CATEGORY_KEYS = new Set([
  "tshirt",
  "tshirts",
  "vintage",
  "organic",
  "mij",
  "pigmenttshirt",
  "organiccottontshirt",
  "madeinjapantshirt"
]);

const TSHIRT_BODY_LABELS = {
  Vintage: "Pigment T Shirt",
  Organic: "Organic Cotton T Shirt",
  MIJ: "Made in Japan T Shirt"
};

function text(value) {
  return String(value ?? "").trim();
}

function number(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function normalizedKey(value) {
  return text(value)
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[^a-z0-9]/g, "");
}

function canonicalCategory(value) {
  const raw = text(value);
  if (!raw) return "";
  if (CATEGORY_LABELS[raw]) return raw;

  const labelMatch = Object.entries(CATEGORY_LABELS)
    .find(([, label]) => label === raw);
  if (labelMatch) return labelMatch[0];

  const key = normalizedKey(raw);
  const aliases = {
    tshirts: "tshirt",
    tshirt: "tshirt",
    pierce: "pierce",
    earring: "earring",
    droppierce: "drop_pierce",
    droptypepierce: "drop_pierce",
    dropearring: "drop_earring",
    droptypeearring: "drop_earring",
    sticker: "sticker",
    postcard: "postcard",
    artprint: "art_print",
    accessory: "accessory",
    accessories: "accessory",
    other: "other",
    unclassified: "other",
    unknown: "other",
    misc: "other"
  };

  return aliases[key] || "";
}

function decodeParts(value, prefix, count) {
  const raw = text(value);
  if (!raw.startsWith(prefix)) return null;
  try {
    const parts = raw.slice(prefix.length).split(prefix === "tshirt__" ? "__" : "|").map(decodeURIComponent);
    if (parts.length !== count) return null;
    return parts;
  } catch {
    return null;
  }
}

function tshirtIds(item, variant) {
  const fromVariantId = decodeParts(item?.variantId || variant?.variantId || variant?.id, "tshirt__", 4);
  const fromInventoryKey = decodeParts(item?.inventoryKey || variant?.inventoryKey, "tshirt:", 4);
  const parts = fromVariantId || fromInventoryKey || [];
  return {
    bodyId: text(item?.bodyId || variant?.bodyId || parts[0]),
    designId: text(item?.designId || variant?.designId || parts[1]),
    colorId: text(item?.colorId || variant?.colorId || parts[2]),
    sizeId: text(item?.sizeId || variant?.sizeId || parts[3])
  };
}

function canonicalTshirtBody(value) {
  const raw = text(value);
  const key = normalizedKey(raw);
  if (!key) return { id: "", label: "" };
  if (key === "vintage" || key.includes("pigment")) return { id: "Vintage", label: TSHIRT_BODY_LABELS.Vintage };
  if (key === "organic" || key.includes("organic")) return { id: "Organic", label: TSHIRT_BODY_LABELS.Organic };
  if (key === "mij" || key.includes("madeinjapan") || key === "japan") return { id: "MIJ", label: TSHIRT_BODY_LABELS.MIJ };
  return { id: raw, label: raw };
}

function isTshirtItem(item, variant) {
  const itemCategoryKey = normalizedKey(item?.category);
  const variantCategoryKey = normalizedKey(variant?.category || variant?.productId);
  return TSHIRT_CATEGORY_KEYS.has(itemCategoryKey) ||
    TSHIRT_CATEGORY_KEYS.has(variantCategoryKey) ||
    text(item?.inventorySource || variant?.inventorySource) === "tshirt" ||
    text(item?.variantId || variant?.variantId || variant?.id).startsWith("tshirt__") ||
    text(item?.inventoryKey || variant?.inventoryKey).startsWith("tshirt:") ||
    Boolean(text(item?.tshirtBodyKey));
}

export function normalizeSalesCategory(item, variant = {}) {
  if (isTshirtItem(item, variant)) return "tshirt";

  const itemCategory = canonicalCategory(item?.category);
  if (itemCategory) return itemCategory;

  const variantCategory = canonicalCategory(variant?.category || variant?.productId);
  if (variantCategory) return variantCategory;

  return "other";
}

function lineSales(item) {
  if (item?.netLineTotal !== null && item?.netLineTotal !== undefined) return number(item.netLineTotal);
  if (item?.grossLineTotal !== null && item?.grossLineTotal !== undefined) return number(item.grossLineTotal);
  return number(item?.unitPrice) * number(item?.quantity);
}

function dimensionValue({ item, variant, dimension, ids }) {
  if (dimension === "body") {
    const explicitBody = text(
      item?.body || variant?.body || item?.tshirtBodyKey || ids.bodyId
    );
    if (explicitBody) {
      const body = canonicalTshirtBody(explicitBody);
      return {
        key: body.id || "unknown",
        label: body.label || "未特定"
      };
    }

    const inferredBody = canonicalTshirtBody(item?.label || item?.category);
    if (["Vintage", "Organic", "MIJ"].includes(inferredBody.id)) {
      return {
        key: inferredBody.id,
        label: inferredBody.label
      };
    }
    return {
      key: "unknown",
      label: "未特定"
    };
  }

  const idField = `${dimension}Id`;
  let label = text(item?.[dimension] || variant?.[dimension]);
  const id = text(item?.[idField] || variant?.[idField] || ids[idField]);
  if (!label && dimension === "design" && text(item?.variantId) && text(item?.label)) {
    label = text(item.label);
  }
  return {
    key: id || label || "unknown",
    label: label || id || "未特定"
  };
}

function addDimension(map, value, quantity, sales) {
  const current = map.get(value.key) || {
    key: value.key,
    label: value.label,
    quantity: 0,
    sales: 0
  };
  current.quantity += quantity;
  current.sales += sales;
  map.set(value.key, current);
}

function sortedRows(map) {
  return Array.from(map.values()).sort((a, b) =>
    b.sales - a.sales ||
    b.quantity - a.quantity ||
    a.label.localeCompare(b.label, "ja")
  );
}

export function buildSalesAggregation({ transactions, variantsById = new Map() }) {
  const categoryMap = new Map();
  const dimensionMaps = {
    design: new Map(),
    body: new Map(),
    color: new Map(),
    size: new Map()
  };
  let tshirtExactQuantity = 0;
  let tshirtUnresolvedQuantity = 0;

  (Array.isArray(transactions) ? transactions : [])
    .filter(transaction => transaction?.status !== "voided")
    .forEach(transaction => {
      (Array.isArray(transaction?.items) ? transaction.items : []).forEach(item => {
        const variantId = text(item?.variantId);
        const variant = variantId && variantsById?.get ? (variantsById.get(variantId) || {}) : {};
        const category = normalizeSalesCategory(item, variant);
        const quantity = Math.max(0, number(item?.quantity));
        const sales = lineSales(item);
        const current = categoryMap.get(category) || {
          category,
          label: CATEGORY_LABELS[category] || CATEGORY_LABELS.other,
          quantity: 0,
          sales: 0
        };
        current.quantity += quantity;
        current.sales += sales;
        categoryMap.set(category, current);

        if (category !== "tshirt") return;
        const ids = tshirtIds(item, variant);
        ["design", "body", "color", "size"].forEach(dimension => {
          addDimension(
            dimensionMaps[dimension],
            dimensionValue({ item, variant, dimension, ids }),
            quantity,
            sales
          );
        });
        if (variantId) tshirtExactQuantity += quantity;
        else tshirtUnresolvedQuantity += quantity;
      });
    });

  const categories = Array.from(categoryMap.values()).sort((a, b) =>
    b.sales - a.sales || b.quantity - a.quantity || a.label.localeCompare(b.label, "ja")
  );
  const tshirtCategory = categoryMap.get("tshirt") || { quantity: 0, sales: 0 };
  return {
    categories,
    tshirt: {
      quantity: tshirtCategory.quantity,
      sales: tshirtCategory.sales,
      exactQuantity: tshirtExactQuantity,
      unresolvedQuantity: tshirtUnresolvedQuantity,
      dimensions: {
        design: sortedRows(dimensionMaps.design),
        body: sortedRows(dimensionMaps.body),
        color: sortedRows(dimensionMaps.color),
        size: sortedRows(dimensionMaps.size)
      }
    }
  };
}
