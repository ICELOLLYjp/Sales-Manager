import test from "node:test";
import assert from "node:assert/strict";
import { mergeEventTshirtPosRows } from "../js/services/eventPosTshirtRows.mjs";
import { eventSkuBaseQuantities } from "../js/services/eventPosStock.mjs";
import { filterTshirtRowsForEventGroups } from "../js/services/eventTshirtDesigns.mjs";

const sizes = ["s", "m", "l", "xl"];
const qty = [3, 4, 4, 2];
const id = size => `tshirt__vintage__deep__vintage_purple__${size}`;
const key = size => `tshirt:vintage|deep|vintage_purple|${size}`;
const opening = sizes.map((size, index) => ({
  variantId: id(size),
  category: "tshirt",
  inventorySource: "tshirt",
  inventoryKey: key(size),
  label: "DEEP",
  detail: `Vintage / Vintage Purple / ${size.toUpperCase()}`,
  openingQty: qty[index]
}));
const registered = sizes.map(size => ({
  variantId: id(size),
  category: "tshirt",
  inventorySource: "tshirt",
  inventoryKey: key(size),
  design: "DEEP",
  body: "Vintage",
  color: "Vintage Purple",
  size: size.toUpperCase()
}));
const globalRows = [{
  ...registered[3],
  bodyId: "vintage",
  designId: "deep",
  colorId: "vintage_purple",
  sizeId: "xl",
  quantity: 2
}];

test("DEEP S M L return from saved opening even if global stock only includes XL", () => {
  const merged = mergeEventTshirtPosRows(globalRows, opening, [], registered);
  const filtered = filterTshirtRowsForEventGroups(merged, opening, [], {});
  assert.equal(filtered.length, 4);
  assert.deepEqual(filtered.map(row => row.size), ["XL", "S", "M", "L"]);
  const base = eventSkuBaseQuantities(opening, []);
  assert.deepEqual(sizes.map(size => base.get(id(size))), [3, 4, 4, 2]);
  assert.equal(filtered.filter(row => row.eventSkuRecoveredFromOpening).length, 3);
  assert.equal(filtered.filter(row => row.eventSkuNotRegistered).length, 0);
  assert.equal(filtered.filter(row => row.eventSkuInvalidStockKey).length, 0);
});

test("event stock count is reduced only by actual exact SKU sales", () => {
  const base = eventSkuBaseQuantities(opening, [
    { variantId: id("m"), type: "restock", quantity: 1 }
  ]);
  const sold = { [id("m")]: 2 };
  assert.equal(base.get(id("m")) - sold[id("m")], 3);
  assert.equal(base.get(id("s")), 3);
});

test("missing registered product metadata remains visible but blocked", () => {
  const merged = mergeEventTshirtPosRows(globalRows, opening, [], [registered[3]]);
  assert.equal(merged.length, 4);
  assert.equal(merged.filter(row => row.eventSkuNotRegistered).length, 3);
  assert.equal(merged.find(row => row.size === "XL").eventSkuNotRegistered, false);
});

test("bad recorded stock key is detectable and must not be sellable", () => {
  const bad = { ...opening[0], inventoryKey: "tshirt:other|other|black|s" };
  const merged = mergeEventTshirtPosRows([], [bad], [], [registered[0]]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].eventSkuInvalidStockKey, true);
});

test("late stock correction can recover a missing SKU from preserved entry metadata", () => {
  const flow = [{
    variantId: id("m"),
    type: "opening_correction",
    quantity: 4,
    item: { ...opening[1] }
  }];
  const merged = mergeEventTshirtPosRows([], [], flow, [registered[1]]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].size, "M");
  assert.equal(merged[0].eventSkuNotRegistered, false);
});

test("unrelated categories or malformed event identities never create T-shirt sale rows", () => {
  const merged = mergeEventTshirtPosRows([], [
    { ...opening[0], category: "earring" },
    { ...opening[0], variantId: "tshirt__invalid" }
  ], [], registered);
  assert.deepEqual(merged, []);
});
