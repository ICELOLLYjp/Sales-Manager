// Create product catalog metadata for event-carried T-shirt SKUs only.
// No inventory quantity or event count is written here.
function clean(value) {
  return String(value ?? "").trim();
}

function readVariantId(value) {
  const parts = clean(value).split("__");
  if (parts.length !== 5 || parts[0] !== "tshirt" || parts.slice(1).some(part => !part)) return null;
  try {
    const ids = parts.slice(1).map(decodeURIComponent);
    if (ids.some(id => !id) ||
        ["tshirt", ...ids.map(encodeURIComponent)].join("__") !== clean(value)) return null;
    return ids;
  } catch {
    return null;
  }
}

function namedMap(values) {
  return new Map((values || []).filter(v => v && clean(v.id)).map(v => [v.id, v]));
}

/**
 * Select missing metadata by exact canonical SKU identity and event stock key.
 * Event inventory may be nonzero even when company stock is zero or absent.
 */
export function planEventTshirtSkuRegistration({
  openingItems = [], flowEntries = [], soldByVariant = {},
  registeredVariants = [], masterOptions = {}
} = {}) {
  const registered = new Set(registeredVariants.map(v => clean(v.variantId || v.id)));
  const bodies = namedMap(masterOptions.bodies);
  const designs = namedMap(masterOptions.designs);
  const colors = namedMap(masterOptions.colors);
  const sizes = namedMap(masterOptions.sizes);
  const stock = new Map();
  const source = new Map();

  for (const item of openingItems || []) {
    if (item?.category !== "tshirt" || !clean(item.variantId)) continue;
    const id = clean(item.variantId);
    const value = Number(item.openingQty);
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) continue;
    stock.set(id, value);
    source.set(id, item);
  }
  for (const entry of flowEntries || []) {
    if (entry?.type !== "restock" && entry?.type !== "opening_correction") continue;
    const id = clean(entry.variantId);
    const change = Number(entry.quantity);
    if (!id || !Number.isInteger(change) ||
        (entry.type === "restock" && change < 0)) continue;
    stock.set(id, (stock.get(id) || 0) + change);
    if (!source.has(id) && entry.item?.category === "tshirt") source.set(id, entry.item);
  }

  const rows = [];
  const excluded = [];
  for (const [variantId, count] of stock) {
    const sold = Number(soldByVariant?.[variantId] || 0);
    if (!Number.isInteger(sold) || sold < 0 || count - sold <= 0 || registered.has(variantId)) continue;
    const ids = readVariantId(variantId);
    const eventRow = source.get(variantId);
    if (!ids || !eventRow || eventRow.category !== "tshirt") {
      excluded.push({variantId, reason: "invalid_event_sku"});
      continue;
    }
    const [bodyId, designId, colorId, sizeId] = ids;
    const stockTargetId = "tshirt:" + ids.map(encodeURIComponent).join("|");
    if (clean(eventRow.inventoryKey) !== stockTargetId) {
      excluded.push({variantId, reason: "stock_key_mismatch"});
      continue;
    }
    const body = bodies.get(bodyId);
    const design = designs.get(designId);
    const color = colors.get(colorId);
    const size = sizes.get(sizeId);
    if (!body || !design || !color || !size ||
        (clean(color.bodyId) && color.bodyId !== bodyId)) {
      excluded.push({variantId, reason: "master_metadata_missing"});
      continue;
    }
    rows.push({
      variantId, category: "tshirt", productId: "tshirt",
      bodyId, designId, colorId, sizeId, stockTargetId,
      body: clean(body.name) || bodyId,
      design: clean(design.name) || designId,
      color: clean(color.name) || colorId,
      size: clean(size.name) || sizeId,
      sizeOrder: Number(size.order) || 999,
      quantity: 0
    });
  }
  return {rows, excluded};
}
