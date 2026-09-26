export function missingAccessoryOpeningRows(openingItems, catalogRows, registeredVariants) {
  const selected = new Set((openingItems || [])
    .filter(item => item.inventorySource === "accessory" && Number(item.openingQty) > 0)
    .map(item => item.variantId));
  const registered = new Set((registeredVariants || []).map(item => item.variantId || item.id));
  return (catalogRows || []).filter(row => selected.has(row.variantId) && !registered.has(row.variantId));
}

export function missingAccessoryEventRows(eventRows, catalogRows, registeredVariants) {
  const active = new Set((eventRows || [])
    .filter(row => Number(row.openingQty) > 0 || Number(row.restockQty) > 0 || Number(row.openingCorrection) !== 0)
    .map(row => row.variantId));
  const registered = new Set((registeredVariants || []).map(row => row.variantId || row.id));
  return (catalogRows || []).filter(row => active.has(row.variantId) && !registered.has(row.variantId));
}
