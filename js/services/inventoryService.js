import { tshirtAdapter } from "../inventoryAdapters/tshirtAdapter.js";
import { accessoryAdapter } from "../inventoryAdapters/accessoryAdapter.js";
import { defaultAdapter } from "../inventoryAdapters/defaultAdapter.js";

const adapters = {
  tshirt: tshirtAdapter,
  accessory: accessoryAdapter,
  sales_app: defaultAdapter
};

export function getInventoryAdapter(inventorySource) {
  const adapter = adapters[inventorySource];
  if (!adapter) throw new Error(`Unknown inventory source: ${inventorySource}`);
  return adapter;
}

export async function getStock({ inventorySource, stockTargetId }) {
  if (!inventorySource || !stockTargetId) return null;
  return getInventoryAdapter(inventorySource).getStock(stockTargetId);
}

export async function changeStock({
  inventorySource,
  stockTargetId,
  quantityChange,
  operationId
}) {
  if (!inventorySource || !stockTargetId) {
    return {
      skipped: true,
      reason: "inventory_not_tracked"
    };
  }

  return getInventoryAdapter(inventorySource).changeStock(
    stockTargetId,
    quantityChange,
    operationId
  );
}
