export function missingAccessoryOpeningRows(openingItems, catalogRows, registeredVariants) {
  const selected = new Set((openingItems || [])
    .filter(item => item.inventorySource === "accessory" && Number(item.openingQty) > 0)
    .map(item => item.variantId));
  const registered = new Set((registeredVariants || []).map(item => item.variantId || item.id));
  return (catalogRows || []).filter(row => selected.has(row.variantId) && !registered.has(row.variantId));
}
