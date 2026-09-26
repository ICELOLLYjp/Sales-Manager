export function filterTshirtRowsForEventDesigns(rows, openingItems, flowEntries, soldByVariant) {
  const activeIds = new Set();
  for (const item of openingItems || []) {
    if (Number(item?.openingQty) > 0 && item.variantId) activeIds.add(item.variantId);
  }
  for (const entry of flowEntries || []) {
    if (entry?.variantId && Number(entry.quantity) > 0 &&
      (entry.type === "restock" || entry.type === "opening_correction")) {
      activeIds.add(entry.variantId);
    }
  }
  for (const [variantId, quantity] of Object.entries(soldByVariant || {})) {
    if (Number(quantity) > 0) activeIds.add(variantId);
  }
  const activeDesigns = new Set((rows || [])
    .filter(row => activeIds.has(row.variantId) && row.designId)
    .map(row => row.designId));
  return (rows || []).filter(row => activeDesigns.has(row.designId));
}
