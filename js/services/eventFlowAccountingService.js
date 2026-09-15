const FLOW_TYPES = new Set([
  "restock",
  "opening_correction"
]);

function text(value) {
  return String(value ?? "").trim();
}

function int(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : 0;
}

function nonNegativeInt(value) {
  return Math.max(0, int(value));
}

function openingItems(session) {
  return Array.isArray(session?.inventoryCount?.opening?.items)
    ? session.inventoryCount.opening.items
    : [];
}

function flowEntries(session) {
  return (Array.isArray(session?.inventoryCount?.flowEntries)
    ? session.inventoryCount.flowEntries
    : [])
    .map(entry => ({
      id: text(entry?.id),
      type: text(entry?.type),
      variantId: text(entry?.variantId),
      quantity: int(entry?.quantity),
      item: entry?.item && typeof entry.item === "object"
        ? { ...entry.item }
        : null
    }))
    .filter(entry =>
      entry.variantId &&
      FLOW_TYPES.has(entry.type) &&
      entry.quantity !== 0
    );
}

function metadataFromEntry(entry) {
  const item = entry?.item || {};
  return {
    variantId: text(entry?.variantId || item?.variantId),
    category: text(item?.category),
    inventorySource: text(item?.inventorySource),
    inventoryKey: text(item?.inventoryKey),
    sku: text(item?.sku),
    label: text(item?.label),
    detail: text(item?.detail),
    bodyId: text(item?.bodyId),
    designId: text(item?.designId),
    colorId: text(item?.colorId),
    sizeId: text(item?.sizeId)
  };
}

export function summarizeEventFlow(session) {
  const originalOpeningItems = openingItems(session).map(item => ({ ...item }));
  const entries = flowEntries(session);
  const byVariant = new Map();

  originalOpeningItems.forEach(item => {
    const variantId = text(item?.variantId);
    if (!variantId) return;
    byVariant.set(variantId, {
      variantId,
      original: { ...item },
      restockQty: 0,
      openingCorrection: 0,
      entries: []
    });
  });

  entries.forEach(entry => {
    let row = byVariant.get(entry.variantId);
    if (!row) {
      const meta = metadataFromEntry(entry);
      row = {
        variantId: entry.variantId,
        original: {
          ...meta,
          variantId: entry.variantId,
          openingQty: 0,
          addedDuringEvent: true,
          source: "event_flow_entry"
        },
        restockQty: 0,
        openingCorrection: 0,
        entries: []
      };
      byVariant.set(entry.variantId, row);
    }

    if (entry.type === "restock") {
      row.restockQty += Math.max(0, entry.quantity);
    } else if (entry.type === "opening_correction") {
      row.openingCorrection += entry.quantity;
    }
    row.entries.push(entry);
  });

  const adjustedOpeningItems = [];
  const flowOnlyVariantIds = [];

  byVariant.forEach(row => {
    const originalQty = nonNegativeInt(row.original?.openingQty);
    const effectiveOpeningQty = originalQty + row.restockQty + row.openingCorrection;

    if (effectiveOpeningQty < 0) {
      const label = text(row.original?.label || row.original?.sku || row.variantId);
      const error = new Error(
        `${label} の開始在庫修正によりイベント在庫がマイナスになります。開始在庫修正を確認してください。`
      );
      error.code = "event-flow-negative-opening";
      error.variantId = row.variantId;
      throw error;
    }

    if (!originalOpeningItems.some(item => text(item?.variantId) === row.variantId)) {
      flowOnlyVariantIds.push(row.variantId);
    }

    adjustedOpeningItems.push({
      ...row.original,
      variantId: row.variantId,
      openingQty: effectiveOpeningQty,
      originalOpeningQty: originalQty,
      eventRestockQty: row.restockQty,
      eventOpeningCorrection: row.openingCorrection,
      eventFlowAdjusted: row.restockQty !== 0 || row.openingCorrection !== 0
    });
  });

  const openingTotal = originalOpeningItems.reduce(
    (sum, item) => sum + nonNegativeInt(item?.openingQty),
    0
  );
  const restockTotal = Array.from(byVariant.values()).reduce(
    (sum, row) => sum + nonNegativeInt(row.restockQty),
    0
  );
  const openingCorrectionTotal = Array.from(byVariant.values()).reduce(
    (sum, row) => sum + int(row.openingCorrection),
    0
  );
  const adjustedOpeningTotal = adjustedOpeningItems.reduce(
    (sum, item) => sum + nonNegativeInt(item?.openingQty),
    0
  );

  return {
    hasFlow: entries.length > 0,
    entries,
    flowEntryCount: entries.length,
    originalOpeningItems,
    adjustedOpeningItems,
    openingTotal,
    restockTotal,
    openingCorrectionTotal,
    adjustedOpeningTotal,
    flowOnlyVariantIds,
    flowOnlySkuCount: flowOnlyVariantIds.length,
    byVariant
  };
}
