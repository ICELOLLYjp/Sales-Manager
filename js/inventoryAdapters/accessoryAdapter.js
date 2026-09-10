// 既存アクセサリー在庫アプリとの接続専用。
// Firestoreの実際のCollection構造が確定したら、このファイル内だけを変更します。

export const accessoryAdapter = {
  async getStock(stockTargetId) {
    console.warn("accessoryAdapter.getStock is not connected yet", stockTargetId);
    return null;
  },

  async changeStock(stockTargetId, quantityChange, operationId) {
    throw new Error("Accessory inventory adapter is not connected yet.");
  },

  async canTrack(stockTargetId) {
    return Boolean(stockTargetId);
  }
};
