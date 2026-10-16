import test from "node:test";
import assert from "node:assert/strict";
import { buildInventoryRows } from "../js/inventoryAdapters/tshirtAdapter.js";
import { buildRows as buildAccessoryRows } from "../js/inventoryAdapters/accessoryAdapter.js";
import { filterTshirtRowsForEventGroups } from "../js/services/eventTshirtDesigns.mjs";
import { eventSkuBaseQuantities } from "../js/services/eventPosStock.mjs";

test("event SKU POS can display DEEP carried stock when company quantity is zero", () => {
  const master = {
    masters: {
      bodies: { organic: { managementName: "Organic" } },
      designs: { deep: { managementName: "DEEP" } },
      colors: { black: { managementName: "Black" } },
      sizes: { S: { managementName: "S" }, M: { managementName: "M" } }
    },
    inventory_v2: {
      organic: { deep: { black: { S: { qty: 0 }, M: { qty: 4 } } } }
    }
  };
  const carriedId = "tshirt__organic__deep__black__S";
  const defaultRows = buildInventoryRows(master);
  assert.equal(defaultRows.some(row => row.variantId === carriedId), false);

  const eventCatalog = buildInventoryRows(master, { includeZero: true });
  assert.equal(eventCatalog.find(row => row.variantId === carriedId)?.quantity, 0);

  const opening = [{ variantId: carriedId, openingQty: 3 }];
  const visible = filterTshirtRowsForEventGroups(eventCatalog, opening, [], {});
  assert.equal(visible.find(row => row.variantId === carriedId)?.design, "DEEP");

  const quantities = eventSkuBaseQuantities(opening, []);
  assert.equal(quantities.get(carriedId) - 1, 2);
});

test("normal accessory catalog keeps zero stock excluded, event catalog may include it", () => {
  const designs = [{ id: "deep", name: "DEEP", category: "standard", piercing: 0, earring: 2 }];
  const positiveRows = buildAccessoryRows(designs, { onlyPositive: true });
  const allRows = buildAccessoryRows(designs);
  const zeroRow = allRows.find(row => row.stockField === "piercing");
  assert.equal(positiveRows.some(row => row.variantId === zeroRow.variantId), false);
  assert.equal(zeroRow.quantity, 0);
  assert.equal(allRows.find(row => row.stockField === "earring")?.quantity, 2);
});
