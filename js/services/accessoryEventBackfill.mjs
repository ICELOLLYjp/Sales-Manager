export function planAccessoryEventBackfill(session, catalogRows, stockBySource) {
  const opening = session?.inventoryCount?.opening?.items || [];
  const existing = new Set(opening.filter(item => Number(item.openingQty) > 0).map(item => item.variantId));
  for (const entry of session?.inventoryCount?.flowEntries || []) existing.add(entry.variantId);
  for (const [variantId, sold] of Object.entries(session?.inventoryCount?.soldByVariant || {})) {
    if (Number(sold) > 0) existing.add(variantId);
  }
  return (catalogRows || []).flatMap(row => {
    const quantity = Number(stockBySource ? stockBySource.get(`${row.sourceId}|${row.stockField}`) : row.companyStockQty);
    if (existing.has(row.variantId) || !Number.isSafeInteger(quantity) || quantity <= 0) return [];
    return [{ ...row, quantity }];
  });
}
