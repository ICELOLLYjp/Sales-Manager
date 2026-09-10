const localInventory = new Map();

export const defaultAdapter = {
  async getStock(stockTargetId) {
    return localInventory.get(stockTargetId) ?? null;
  },

  async changeStock(stockTargetId, quantityChange, operationId) {
    const current = localInventory.get(stockTargetId) ?? 0;
    const next = current + quantityChange;
    localInventory.set(stockTargetId, next);

    return {
      stockTargetId,
      previousQuantity: current,
      quantity: next,
      operationId,
      source: "local_demo"
    };
  },

  async canTrack(stockTargetId) {
    return localInventory.has(stockTargetId);
  },

  seed(stockTargetId, quantity) {
    localInventory.set(stockTargetId, quantity);
  }
};
