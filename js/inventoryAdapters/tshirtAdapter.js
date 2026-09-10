// Phase 1 adapter interface.
// Firebase接続後、このファイルだけを既存 tshirtStock/master / inventory_v2 に合わせて実装します。
// Sales Manager本体から既存在庫構造を直接参照しないための境界です。

export const tshirtAdapter = {
  async getStock(stockTargetId) {
    console.warn("tshirtAdapter.getStock is not connected yet", stockTargetId);
    return null;
  },

  async changeStock(stockTargetId, quantityChange, operationId) {
    throw new Error("T-shirt inventory adapter is not connected yet.");
  },

  async canTrack(stockTargetId) {
    return Boolean(stockTargetId);
  }
};
