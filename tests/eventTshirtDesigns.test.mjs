import test from "node:test";
import assert from "node:assert/strict";
import { filterTshirtRowsForEventDesigns } from "../js/services/eventTshirtDesigns.mjs";

test("event SKU POS keeps zero opening sizes in a carried design and excludes uncarried designs", () => {
  const rows = [
    { variantId: "a_s", designId: "a" },
    { variantId: "a_m", designId: "a" },
    { variantId: "b_s", designId: "b" },
    { variantId: "c_s", designId: "c" },
    { variantId: "d_s", designId: "d" }
  ];
  const opening = [
    { variantId: "a_s", openingQty: 2 },
    { variantId: "a_m", openingQty: 0 },
    { variantId: "b_s", openingQty: 0 },
    { variantId: "c_s", openingQty: 0 },
    { variantId: "d_s", openingQty: 0 }
  ];
  const flow = [{ variantId: "c_s", type: "restock", quantity: 1 }];
  const sold = { d_s: 1 };
  assert.deepEqual(filterTshirtRowsForEventDesigns(rows, opening, flow, sold),
    [rows[0], rows[1], rows[3], rows[4]]);
  assert.deepEqual(filterTshirtRowsForEventDesigns(rows, opening, [], {}), rows.slice(0, 2));
});

test("zero-only opening for an uncarried design does not activate it", () => {
  assert.deepEqual(filterTshirtRowsForEventDesigns(
    [{ variantId: "b_s", designId: "b" }],
    [{ variantId: "b_s", openingQty: 0 }],
    [],
    {}
  ), []);
});
