import test from "node:test";
import assert from "node:assert/strict";
import { missingAccessoryOpeningRows, missingAccessoryEventRows } from "../js/services/accessoryOpeningRegistration.mjs";

test("a positive event opening registers only missing accessory SKU metadata", () => {
  const opening = [
    { variantId: "accessory__pierce__new", inventorySource: "accessory", openingQty: 2 },
    { variantId: "accessory__earring__known", inventorySource: "accessory", openingQty: 1 },
    { variantId: "accessory__pierce__zero", inventorySource: "accessory", openingQty: 0 },
    { variantId: "tshirt__one", inventorySource: "tshirt", openingQty: 1 }
  ];
  const catalog = opening.map(item => ({ variantId: item.variantId, inventoryKey: item.variantId }));
  const registered = [{ variantId: "accessory__earring__known" }];
  assert.deepEqual(missingAccessoryOpeningRows(opening, catalog, registered), [catalog[0]]);
  assert.deepEqual(missingAccessoryOpeningRows(opening, catalog, [...registered, catalog[0]]), []);
});

test("does not invent a product for an event row absent from canonical stock", () => {
  assert.deepEqual(missingAccessoryOpeningRows(
    [{ variantId: "accessory__pierce__missing", inventorySource: "accessory", openingQty: 4 }],
    [], []
  ), []);
});

test("late SKU metadata repair covers existing event stock without adding quantities", () => {
  const eventRows = [
    { variantId: "opening", openingQty: 4, restockQty: 0, openingCorrection: 0 },
    { variantId: "late", openingQty: 0, restockQty: 0, openingCorrection: 6 },
    { variantId: "registered", openingQty: 3, restockQty: 0, openingCorrection: 0 },
    { variantId: "not-carried", openingQty: 0, restockQty: 0, openingCorrection: 0 }
  ];
  const catalog = eventRows.map(row => ({ variantId: row.variantId, label: row.variantId }));
  assert.deepEqual(missingAccessoryEventRows(eventRows, catalog, [{ variantId: "registered" }]), catalog.slice(0, 2));
  assert.deepEqual(missingAccessoryEventRows(eventRows, catalog, catalog), []);
});
