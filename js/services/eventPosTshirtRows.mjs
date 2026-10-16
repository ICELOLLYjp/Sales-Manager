// Event opening and flow records are the authority for the SKU list in an
// event. Global stock is only one possible source of catalog metadata.
function string(value) {
  return String(value ?? "").trim();
}

function tshirtIds(variantId) {
  const parts = string(variantId).split("__");
  if (parts.length !== 5 || parts[0] !== "tshirt" || parts.slice(1).some(part => !part)) {
    return null;
  }
  try {
    return parts.slice(1).map(part => decodeURIComponent(part));
  } catch {
    return null;
  }
}

function canonicalInventoryKey(ids) {
  return `tshirt:${ids.map(id => encodeURIComponent(id)).join("|")}`;
}

export function mergeEventTshirtPosRows(
  availableRows,
  openingItems,
  flowEntries,
  registeredVariants
) {
  const registry = new Map(
    (registeredVariants || [])
      .filter(row => row && (row.variantId || row.id))
      .map(row => [row.variantId || row.id, row])
  );
  const byId = new Map();

  for (const row of availableRows || []) {
    if (!row?.variantId || row.category !== "tshirt") continue;
    const registered = registry.has(row.variantId);
    byId.set(row.variantId, {
      ...row,
      eventSkuNotRegistered: !registered
    });
  }

  const candidates = [
    ...(openingItems || []),
    ...(flowEntries || [])
      .filter(entry =>
        entry?.item &&
        ["restock", "opening_correction"].includes(entry.type)
      )
      .map(entry => ({ ...entry.item, variantId: entry.variantId }))
  ];

  for (const source of candidates) {
    const id = string(source?.variantId);
    if (!id || source?.category !== "tshirt" || byId.has(id)) continue;
    const ids = tshirtIds(id);
    if (!ids) continue;

    const [bodyId, designId, colorId, sizeId] = ids;
    const registered = registry.get(id) || {};
    const detail = string(source.detail).split("/").map(part => part.trim());
    const expectedKey = canonicalInventoryKey(ids);
    const stockKey = string(source.inventoryKey || registered.inventoryKey);

    byId.set(id, {
      ...registered,
      variantId: id,
      category: "tshirt",
      inventorySource: "tshirt",
      inventoryKey: stockKey,
      stockTargetId: stockKey,
      bodyId,
      designId,
      colorId,
      sizeId,
      design: string(registered.design || source.label) || "Tシャツ",
      body: string(registered.body || detail[0]),
      color: string(registered.color || detail[1]),
      size: string(registered.size || detail[2]),
      sku: string(registered.sku || source.sku || id),
      quantity: 0,
      eventSkuRecoveredFromOpening: true,
      eventSkuNotRegistered: !registry.has(id),
      eventSkuInvalidStockKey:
        stockKey !== expectedKey ||
        (registered.inventoryKey && registered.inventoryKey !== expectedKey)
    });
  }

  return [...byId.values()];
}

export function filterTshirtRowsForPosContext(rows, hasSavedOpening) {
  return (rows || []).filter(row =>
    Boolean(hasSavedOpening) || Number(row?.quantity || 0) > 0
  );
}
