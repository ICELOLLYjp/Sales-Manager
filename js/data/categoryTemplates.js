export const CATEGORY_TEMPLATES = [
  {
    id: "tshirt",
    labelJa: "Tシャツ",
    posLabel: "T Shirt",
    inventoryMode: "variant",
    inventorySource: "tshirt",
    defaultTrackingMode: "semi",
    semiFields: ["size"],
    fields: ["body", "design", "color", "size"]
  },
  {
    id: "pierce",
    labelJa: "ピアス",
    posLabel: "Pierce",
    inventoryMode: "variant",
    inventorySource: "accessory",
    defaultTrackingMode: "quick",
    fields: ["design", "variant"]
  },
  {
    id: "earring",
    labelJa: "イヤリング",
    posLabel: "Earring",
    inventoryMode: "variant",
    inventorySource: "accessory",
    defaultTrackingMode: "quick",
    fields: ["design", "variant"]
  },
  {
    id: "drop_pierce",
    labelJa: "ドロップタイプピアス",
    posLabel: "Drop Pierce",
    inventoryMode: "variant",
    inventorySource: "accessory",
    defaultTrackingMode: "quick",
    fields: ["design", "variant"]
  },
  {
    id: "drop_earring",
    labelJa: "ドロップタイプイヤリング",
    posLabel: "Drop Earring",
    inventoryMode: "variant",
    inventorySource: "accessory",
    defaultTrackingMode: "quick",
    fields: ["design", "variant"]
  },
  {
    id: "sticker",
    labelJa: "ステッカー",
    posLabel: "Sticker",
    inventoryMode: "variant",
    inventorySource: "sales_app",
    defaultTrackingMode: "quick",
    fields: ["design", "size"]
  },
  {
    id: "postcard",
    labelJa: "ポストカード",
    posLabel: "Postcard",
    inventoryMode: "product",
    inventorySource: "sales_app",
    defaultTrackingMode: "quick",
    fields: ["design"]
  },
  {
    id: "art_print",
    labelJa: "アートプリント",
    posLabel: "Art Print",
    inventoryMode: "variant",
    inventorySource: "sales_app",
    defaultTrackingMode: "quick",
    fields: ["design", "size"]
  }
];

export function getCategoryTemplate(id) {
  return CATEGORY_TEMPLATES.find(item => item.id === id) ?? null;
}
