import test from "node:test";
import assert from "node:assert/strict";
import { eventSkuBaseQuantities } from "../js/services/eventPosStock.mjs";

test("SKU POS includes late accessory registration and normal restock once", () => {
  const stock = eventSkuBaseQuantities(
    [{ variantId: "tshirt", openingQty: 3 }],
    [{ variantId: "accessory", type: "opening_correction", quantity: 7 },
      { variantId: "tshirt", type: "restock", quantity: 2 }]
  );
  assert.equal(stock.get("accessory"), 7);
  assert.equal(stock.get("tshirt"), 5);
  assert.equal(stock.get("accessory") - 2, 5);
});

test("ignores unrelated flow records and preserves zero opening", () => {
  const stock = eventSkuBaseQuantities([{ variantId: "zero", openingQty: 0 }],
    [{ variantId: "zero", type: "checkpoint", quantity: 20 }]);
  assert.equal(stock.get("zero"), 0);
});
