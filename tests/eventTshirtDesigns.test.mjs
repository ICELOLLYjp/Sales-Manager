import test from "node:test";
import assert from "node:assert/strict";
import { filterTshirtRowsForEventGroups } from "../js/services/eventTshirtDesigns.mjs";

test("POS hides zero-only design, body and color groups while keeping zero sizes of a carried group", () => {
  const rows = [
    { variantId: "big_organic_black_s", designId: "bigwave", bodyId: "organic", colorId: "black" },
    { variantId: "big_organic_natural_m", designId: "bigwave", bodyId: "organic", colorId: "natural" },
    { variantId: "big_vintage_navy_s", designId: "bigwave", bodyId: "vintage", colorId: "navy" },
    { variantId: "big_vintage_navy_m", designId: "bigwave", bodyId: "vintage", colorId: "navy" },
    { variantId: "share_organic_black_m", designId: "share", bodyId: "organic", colorId: "black" },
    { variantId: "share_vintage_grey_l", designId: "share", bodyId: "vintage", colorId: "grey" }
  ];
  const opening = rows.map(row => ({ variantId: row.variantId, openingQty:
    row.variantId === "big_vintage_navy_s" || row.variantId === "share_vintage_grey_l" ? 2 : 0 }));
  assert.deepEqual(filterTshirtRowsForEventGroups(rows, opening, [], {}),
    [rows[2], rows[3], rows[5]]);
});

test("later restock and exact sale retain their specific color groups", () => {
  const rows = [
    { variantId: "green_s", designId: "salty", bodyId: "organic", colorId: "green" },
    { variantId: "green_m", designId: "salty", bodyId: "organic", colorId: "green" },
    { variantId: "pink_m", designId: "salty", bodyId: "organic", colorId: "pink" },
    { variantId: "black_l", designId: "salty", bodyId: "organic", colorId: "black" }
  ];
  const opening = rows.map(row => ({ variantId: row.variantId, openingQty: 0 }));
  assert.deepEqual(filterTshirtRowsForEventGroups(rows, opening,
    [{ variantId: "green_s", type: "restock", quantity: 1 }], { pink_m: 1 }),
  rows.slice(0, 3));
  assert.deepEqual(filterTshirtRowsForEventGroups(rows, opening, [], {}), []);
});
