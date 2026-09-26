import test from "node:test";
import assert from "node:assert/strict";
import { missingAccessoryOpeningRows } from "../js/services/accessoryOpeningRegistration.mjs";

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
