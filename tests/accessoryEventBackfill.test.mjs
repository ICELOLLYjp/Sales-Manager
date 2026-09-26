import test from "node:test";
import assert from "node:assert/strict";
import { planAccessoryEventBackfill } from "../js/services/accessoryEventBackfill.mjs";

test("late import keeps counted, adjusted and sold SKUs unchanged", () => {
  const ids = ["new", "counted", "adjusted", "sold"];
  const rows = ids.map(id => ({ variantId: id, sourceId: id, stockField: "piercing", companyStockQty: 8 }));
  const session = { inventoryCount: {
    opening: { items: [{ variantId: "counted", openingQty: 2 }] },
    flowEntries: [{ variantId: "adjusted", type: "restock", quantity: 1 }],
    soldByVariant: { sold: 1 }
  } };
  const stock = new Map(ids.map(id => [`${id}|piercing`, id === "new" ? 5 : 8]));
  assert.deepEqual(planAccessoryEventBackfill(session, rows, stock), [{ ...rows[0], quantity: 5 }]);
  assert.deepEqual(planAccessoryEventBackfill(session, rows, stock, []), []);
  const after = structuredClone(session);
  after.inventoryCount.flowEntries.push({ variantId: "new", type: "opening_correction", quantity: 5 });
  assert.deepEqual(planAccessoryEventBackfill(after, rows, stock), []);
});

test("ignores absent, zero and invalid canonical stock", () => {
  const rows = ["absent", "zero", "invalid"].map(id => ({ variantId: id, sourceId: id, stockField: "earring", companyStockQty: 0 }));
  rows[0].companyStockQty = 7;
  const stock = new Map([["zero|earring", 0], ["invalid|earring", NaN]]);
  assert.deepEqual(planAccessoryEventBackfill({ inventoryCount: { opening: { items: [] } } }, rows, stock), []);
});
