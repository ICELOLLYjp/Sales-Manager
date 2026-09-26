export function filterTshirtRowsForEventGroups(rows, openingItems, flowEntries, soldByVariant) {
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
  const groupKey = row => JSON.stringify([row.designId, row.bodyId, row.colorId]);
  const activeGroups = new Set((rows || [])
    .filter(row => activeIds.has(row.variantId) && row.designId && row.bodyId && row.colorId)
    .map(groupKey));
  return (rows || []).filter(row => activeGroups.has(groupKey(row)));
}
