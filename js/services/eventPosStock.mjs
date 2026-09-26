export function eventSkuBaseQuantities(openingItems, flowEntries) {
  const quantities = new Map();
  for (const item of openingItems || []) {
    if (item?.variantId) quantities.set(item.variantId, Math.max(0, Math.trunc(Number(item.openingQty) || 0)));
  }
  for (const entry of flowEntries || []) {
    if (!entry?.variantId || !["restock", "opening_correction"].includes(entry.type)) continue;
    const raw = Number(entry.quantity);
    if (!Number.isFinite(raw)) continue;
    const quantity = entry.type === "restock" ? Math.max(0, Math.trunc(raw)) : Math.trunc(raw);
    quantities.set(entry.variantId, (quantities.get(entry.variantId) || 0) + quantity);
  }
  return quantities;
}
