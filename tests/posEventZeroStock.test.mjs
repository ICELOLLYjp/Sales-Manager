import test from "node:test";
import assert from "node:assert/strict";
import { buildInventoryRows } from "../js/inventoryAdapters/tshirtAdapter.js";
import { eventSkuBaseQuantities } from "../js/services/eventPosStock.mjs";

const master = {
  masters: {
    bodies: { organic: { managementName: "Organic" } },
    designs: {
      deep: { managementName: "DEEP" },
      other: { managementName: "OTHER" }
    },
    colors: { black: { managementName: "Black" } },
    sizes: {
      m: { managementName: "M", order: 2 },
      l: { managementName: "L", order: 3 }
    }
  },
  inventory_v2: {
    organic: {
      deep: { black: { m: { qty: 0 }, l: { qty: 2 } } },
      other: { black: { m: { qty: 0 } } }
    }
  }
};

test("normal inventory lists only positive stock and does not change existing behavior", () => {
  const rows = buildInventoryRows(master);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].design, "DEEP");
  assert.equal(rows[0].size, "L");
  assert.equal(rows[0].quantity, 2);
});

test("event POS can include a carried DEEP size even when company stock is zero", () => {
  const rows = buildInventoryRows(master, { includeZero: true });
  const deepM = rows.find(row => row.design === "DEEP" && row.size === "M");
  assert.ok(deepM);
  assert.equal(deepM.quantity, 0);

  const opening = eventSkuBaseQuantities([
    { variantId: deepM.variantId, openingQty: 3 }
  ], []);
  const soldByVariant = { [deepM.variantId]: 1 };
  assert.equal(opening.get(deepM.variantId) - soldByVariant[deepM.variantId], 2);
});

test("event mode preserves zero stock metadata without changing quantities", () => {
  const rows = buildInventoryRows(master, { includeZero: true });
  assert.equal(rows.length, 3);
  assert.equal(rows.filter(row => row.quantity > 0).length, 1);
  assert.equal(rows.reduce((sum, row) => sum + row.quantity, 0), 2);
});
