import { CATEGORY_TEMPLATES, getCategoryTemplate } from "../data/categoryTemplates.js";
import { slugify } from "../utils/ids.js";

export function listCategoryTemplates() {
  return CATEGORY_TEMPLATES;
}

export function buildProductDraft(categoryId, overrides = {}) {
  const template = getCategoryTemplate(categoryId);
  if (!template) throw new Error(`Unknown category: ${categoryId}`);

  return {
    name: overrides.name ?? template.labelJa,
    category: categoryId,
    posLabel: overrides.posLabel ?? template.posLabel,
    inventoryMode: overrides.inventoryMode ?? template.inventoryMode,
    inventorySource: overrides.inventorySource ?? template.inventorySource,
    inventoryStatus: overrides.inventoryStatus ?? "not_initialized",
    saleStatus: overrides.saleStatus ?? "active",
    defaultTrackingMode: overrides.defaultTrackingMode ?? template.defaultTrackingMode,
    semiFields: overrides.semiFields ?? template.semiFields ?? [],
    active: true
  };
}

export function buildVariantId(categoryId, attributes = {}) {
  const parts = [categoryId];

  ["body", "design", "color", "size", "variant"].forEach(key => {
    if (attributes[key]) parts.push(slugify(String(attributes[key])));
  });

  return parts.filter(Boolean).join("_");
}

export function buildVariantDraft(productId, attributes = {}, overrides = {}) {
  const categoryId = overrides.category ?? productId;
  const variantId = overrides.variantId ?? buildVariantId(categoryId, attributes);

  return {
    id: variantId,
    productId,
    sku: overrides.sku ?? variantId,
    category: categoryId,
    displayName: overrides.displayName ?? attributes.design ?? productId,
    ...attributes,
    inventorySource: overrides.inventorySource ?? "sales_app",
    inventoryKey: overrides.inventoryKey ?? variantId,
    active: overrides.active ?? true
  };
}
