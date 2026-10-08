(function (root) {
  "use strict";
  const object = x => x !== null && typeof x === "object" && !Array.isArray(x);
  const text = x => typeof x === "string" && x.length > 0 && x.length <= 256 && !/[\x00-\x1f\x7f<>]/.test(x);
  const own = (o, k) => object(o) && Object.hasOwn(o, k);
  function resolve(master, bodyId, colorId) {
    const store = master?.manufacturer_color_links;
    if (!text(bodyId) || !text(colorId) || store?.schemaVersion !== 1 || !Number.isSafeInteger(store.revision) || store.revision < 1) return null;
    if (!own(master?.masters?.bodies, bodyId) || !object(master.masters.bodies[bodyId]) || !own(master?.masters?.colors, colorId) || !object(master.masters.colors[colorId])) return null;
    const key = bodyId + "|" + colorId;
    if (!own(store.items, key)) return null;
    const row = store.items[key];
    if (!object(row) || row.bodyId !== bodyId || row.colorId !== colorId || !["felic", "sloth"].includes(row.supplierId) || !["productCode", "colorCode", "officialName"].every(k => text(row[k])) || !Number.isSafeInteger(row.version) || row.version < 1) return null;
    if (!["confirmedDate", "sourceCheckedDate"].every(k => typeof row[k] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row[k]))) return null;
    if (typeof row.colorSymbol !== "string" || (row.colorSymbol !== "" && !text(row.colorSymbol))) return null;
    return Object.freeze({ bodyId, colorId, supplierId: row.supplierId, productCode: row.productCode, colorCode: row.colorCode, officialName: row.officialName, colorSymbol: row.colorSymbol, confirmedDate: row.confirmedDate, sourceCheckedDate: row.sourceCheckedDate, version: row.version, metadataRevision: store.revision });
  }
  function list(master) {
    const items = master?.manufacturer_color_links?.items;
    if (!object(items) || Object.keys(items).length > 20000) return [];
    return Object.values(items).flatMap(row => {
      const item = resolve(master, row?.bodyId, row?.colorId);
      return item && items[item.bodyId + "|" + item.colorId] === row ? [item] : [];
    });
  }
  const api = Object.freeze({ resolve, list });
  root.IcelollyManufacturerColors = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(globalThis);
