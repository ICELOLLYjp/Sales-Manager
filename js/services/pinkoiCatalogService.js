import { getFirebaseState } from "../firebase.js";

const COLLECTIONS = {
  bodies: "pinkoi_bodies",
  designs: "pinkoi_designs",
  colors: "pinkoi_colors",
  inventory: "pinkoi_inventory",
  products: "pinkoi_products"
};

const MATCHED = "matched";
const AMBIGUOUS = "ambiguous";
const UNMATCHED = "unmatched";


async function firestoreModule() {
  return await import(
    "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js"
  );
}

async function requireDb() {
  const { db, enabled } = getFirebaseState();

  if (!enabled || !db) {
    throw new Error("Firebase is not connected.");
  }

  return db;
}

function text(value) {
  return String(value ?? "").trim();
}

function normalizeValue(value) {
  return text(value)
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/grey/g, "gray")
    .replace(/\s+/gu, "");
}

function encodePart(value) {
  return encodeURIComponent(text(value));
}

function createVariantId(bodyId, designId, colorId, sizeId) {
  return [
    "tshirt",
    encodePart(bodyId),
    encodePart(designId),
    encodePart(colorId),
    encodePart(sizeId)
  ].join("__");
}

function createStockTargetId(bodyId, designId, colorId, sizeId) {
  return [
    "tshirt:",
    encodePart(bodyId),
    "|",
    encodePart(designId),
    "|",
    encodePart(colorId),
    "|",
    encodePart(sizeId)
  ].join("");
}

function candidateValues(item, id = "") {
  const displayName = item?.displayName || {};

  return [
    id,
    item?.id,
    item?.internalName,
    item?.managementName,
    item?.salesName,
    item?.legacyKey,
    item?.pinkoiName,
    item?.code,
    item?.name,
    displayName?.ja,
    displayName?.en,
    displayName?.zhTW,
    displayName?.zh
  ]
    .map(text)
    .filter(Boolean);
}

function buildCandidateIndex(masterMap) {
  const index = new Map();

  Object.entries(masterMap || {}).forEach(([id, item]) => {
    candidateValues(item, id).forEach(value => {
      const key = normalizeValue(value);
      if (!key) return;

      if (!index.has(key)) {
        index.set(key, new Set());
      }

      index.get(key).add(id);
    });
  });

  return index;
}

function diagnoseMasterMatch({
  sourceId,
  sourceItem,
  masterMap,
  candidateIndex,
  extraCandidates = []
}) {
  if (
    sourceId &&
    masterMap?.[sourceId]
  ) {
    return {
      status: MATCHED,
      masterId: sourceId,
      candidates: [sourceId],
      method: "id"
    };
  }

  const candidates = new Set();

  [
    ...candidateValues(
      sourceItem,
      sourceId
    ),
    ...extraCandidates
  ].forEach(value => {
    const key =
      normalizeValue(
        value
      );

    if (!key) {
      return;
    }

    const ids =
      candidateIndex.get(
        key
      );

    if (!ids) {
      return;
    }

    ids.forEach(
      id =>
        candidates.add(
          id
        )
    );
  });

  if (
    candidates.size ===
    1
  ) {
    const [masterId] =
      Array.from(
        candidates
      );

    return {
      status: MATCHED,
      masterId,
      candidates: [masterId],
      method: "name"
    };
  }

  if (
    candidates.size > 1
  ) {
    return {
      status: AMBIGUOUS,
      masterId: "",
      candidates:
        Array.from(
          candidates
        ).sort(),
      method: "name"
    };
  }

  return {
    status: UNMATCHED,
    masterId: "",
    candidates: [],
    method: "none"
  };
}

function diagnoseDesignMatch({
  sourceId,
  sourceItem,
  masterMap,
  candidateIndex
}) {
  const explicitMasterDesignId =
    text(
      sourceItem
        ?.masterDesignId
    );

  if (
    explicitMasterDesignId
  ) {
    if (
      masterMap?.[
        explicitMasterDesignId
      ]
    ) {
      return {
        status: MATCHED,
        masterId:
          explicitMasterDesignId,
        candidates: [
          explicitMasterDesignId
        ],
        method:
          "masterDesignId",
        configuredMasterDesignId:
          explicitMasterDesignId
      };
    }

    return {
      status: UNMATCHED,
      masterId: "",
      candidates: [],
      method:
        "none",
      linkError:
        "design_link_invalid",
      configuredMasterDesignId:
        explicitMasterDesignId
    };
  }

  return diagnoseMasterMatch({
    sourceId,
    sourceItem,
    masterMap,
    candidateIndex
  });
}

function diagnoseSizeMatch({
  sourceValue,
  masterSizes,
  candidateIndex
}) {
  const sourceItem = {
    id: sourceValue,
    managementName: sourceValue,
    salesName: sourceValue,
    name: sourceValue
  };

  return diagnoseMasterMatch({
    sourceId: sourceValue,
    sourceItem,
    masterMap: masterSizes,
    candidateIndex
  });
}

function displayName(item, fallback = "") {
  return (
    item?.internalName ||
    item?.managementName ||
    item?.displayName?.en ||
    item?.displayName?.ja ||
    item?.salesName ||
    fallback ||
    ""
  );
}

function masterDisplayName(source, id) {
  return displayName(source?.[id], id);
}

function productKey(bodyId, designId) {
  return `${bodyId}__${designId}`;
}

function positiveNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0
    ? number
    : 0;
}

function diagnosePrice(product, inventoryRow) {
  const productPriceJpy = positiveNumber(product?.priceJpy);
  const inventoryPriceJpy = positiveNumber(inventoryRow?.priceJpy);

  if (productPriceJpy > 0 && inventoryPriceJpy > 0) {
    if (productPriceJpy === inventoryPriceJpy) {
      return {
        priceJpy: productPriceJpy,
        priceSource: "pinkoi_products",
        priceStatus: "ok",
        productPriceJpy,
        inventoryPriceJpy
      };
    }

    return {
      priceJpy: null,
      priceSource: "conflict",
      priceStatus: "price_conflict",
      productPriceJpy,
      inventoryPriceJpy
    };
  }

  if (productPriceJpy > 0) {
    return {
      priceJpy: productPriceJpy,
      priceSource: "pinkoi_products",
      priceStatus: "ok",
      productPriceJpy,
      inventoryPriceJpy
    };
  }

  if (inventoryPriceJpy > 0) {
    return {
      priceJpy: inventoryPriceJpy,
      priceSource: "pinkoi_inventory",
      priceStatus: "ok",
      productPriceJpy,
      inventoryPriceJpy
    };
  }

  return {
    priceJpy: null,
    priceSource: "missing",
    priceStatus: "price_missing",
    productPriceJpy,
    inventoryPriceJpy
  };
}

function readMasterStock(master, bodyId, designId, colorId, sizeId) {
  const raw =
    master?.inventory_v2
      ?.[bodyId]
      ?.[designId]
      ?.[colorId]
      ?.[sizeId];

  if (raw === undefined || raw === null) {
    return 0;
  }

  if (typeof raw === "number") {
    return Math.max(0, Number(raw || 0));
  }

  if (typeof raw === "object") {
    return Math.max(
      0,
      Number(
        raw.qty ??
        raw.stock ??
        raw.quantity ??
        0
      )
    );
  }

  return Math.max(0, Number(raw || 0));
}

function buildSkuDiagnostics(inventoryRows) {
  const groups = new Map();

  inventoryRows.forEach(row => {
    const sku = text(row?.sku);
    if (!sku) return;

    if (!groups.has(sku)) {
      groups.set(sku, []);
    }

    groups.get(sku).push(row);
  });

  const duplicates = new Map();

  groups.forEach((rows, sku) => {
    if (rows.length <= 1) return;

    const combinations = new Set(
      rows.map(row =>
        [
          text(row.bodyId),
          text(row.designId),
          text(row.colorId),
          text(row.size)
        ].join("|")
      )
    );

    duplicates.set(sku, {
      count: rows.length,
      majorConflict: combinations.size > 1
    });
  });

  return duplicates;
}

function reasonForMatch(field, result) {
  if (
    result?.linkError
  ) {
    return result.linkError;
  }

  if (
    result.status ===
    UNMATCHED
  ) {
    return field;
  }

  if (
    result.status ===
    AMBIGUOUS
  ) {
    return `ambiguous_${field}`;
  }

  return null;
}

function stockStatus({
  masterStock,
  pinkoiInventoryStock,
  pinkoiStock
}) {
  const result = [];

  if (masterStock === pinkoiInventoryStock) {
    result.push("master_match");
  } else {
    result.push("pinkoi_inventory_stock_diff");
  }

  if (masterStock !== pinkoiStock) {
    result.push("pinkoi_stock_diff");
  }

  if (masterStock === 0) {
    result.push("master_stock_zero");
  }

  return result;
}

async function loadCollection(db, name) {
  const {
    collection,
    getDocsFromServer
  } = await firestoreModule();

  const snapshot = await getDocsFromServer(
    collection(db, COLLECTIONS[name])
  );

  return snapshot.docs.map(docItem => ({
    id: docItem.id,
    ...docItem.data()
  }));
}

async function loadMaster(db) {
  const {
    doc,
    getDocFromServer
  } = await firestoreModule();

  const snapshot = await getDocFromServer(
    doc(db, "tshirtStock", "master")
  );

  if (!snapshot.exists()) {
    throw new Error("tshirtStock/master was not found.");
  }

  return snapshot.data();
}

export function emptyPinkoiTshirtCatalog(error = null) {
  return {
    error,
    summary: {
      inventoryCount: 0,
      inventoryDocuments: 0,
      skuCount: 0,
      missingSkuCount: 0,
      duplicateSkuCount: 0,
      matchedCount: 0,
      mappedVariants: 0,
      unmatchedCount: 0,
      unmappedVariants: 0,
      ambiguousCount: 0,
      priceCount: 0,
      pricedCount: 0,
      missingPriceCount: 0,
      priceConflictCount: 0,
      masterStockCount: 0,
      masterStockZeroCount: 0,
      explicitDesignLinkCount: 0,
      syncEligibleCount: 0,
      zeroStockCatalogCount: 0
    },
    items: [],
    variants: [],
    unmapped: [],
    ambiguous: [],
    byVariantId: new Map()
  };
}

export async function loadPinkoiTshirtCatalog() {
  const db = await requireDb();

  const [
    master,
    bodies,
    designs,
    colors,
    inventory,
    products
  ] = await Promise.all([
    loadMaster(db),
    loadCollection(db, "bodies"),
    loadCollection(db, "designs"),
    loadCollection(db, "colors"),
    loadCollection(db, "inventory"),
    loadCollection(db, "products")
  ]);

  const bodyMap = new Map(bodies.map(item => [item.id, item]));
  const designMap = new Map(designs.map(item => [item.id, item]));
  const colorMap = new Map(colors.map(item => [item.id, item]));

  const productMap = new Map();

  products.forEach(item => {
    if (item.id) {
      productMap.set(item.id, item);
    }

    if (item.bodyId && item.designId) {
      productMap.set(
        productKey(item.bodyId, item.designId),
        item
      );
    }
  });

  const masters = master?.masters || {};
  const masterBodies = masters?.bodies || {};
  const masterDesigns = masters?.designs || {};
  const masterColors = masters?.colors || {};
  const masterSizes = masters?.sizes || {};

  const bodyIndex = buildCandidateIndex(masterBodies);
  const designIndex = buildCandidateIndex(masterDesigns);
  const colorIndex = buildCandidateIndex(masterColors);
  const sizeIndex = buildCandidateIndex(masterSizes);

  const duplicateSkuMap = buildSkuDiagnostics(inventory);

  const items = inventory.map(row => {
    const pinkoiBodyId = text(row.bodyId);
    const pinkoiDesignId = text(row.designId);
    const pinkoiColorId = text(row.colorId);
    const sizeValue = text(row.size);
    const sku = text(row.sku);

    const pinkoiBody = bodyMap.get(pinkoiBodyId) || null;
    const pinkoiDesign = designMap.get(pinkoiDesignId) || null;
    const pinkoiColor = colorMap.get(pinkoiColorId) || null;

    const bodyMatch = diagnoseMasterMatch({
      sourceId: pinkoiBodyId,
      sourceItem: pinkoiBody,
      masterMap: masterBodies,
      candidateIndex: bodyIndex
    });

    const designMatch = diagnoseDesignMatch({
      sourceId: pinkoiDesignId,
      sourceItem: pinkoiDesign,
      masterMap: masterDesigns,
      candidateIndex: designIndex
    });

    const colorMatch = diagnoseMasterMatch({
      sourceId: pinkoiColorId,
      sourceItem: pinkoiColor,
      masterMap: masterColors,
      candidateIndex: colorIndex
    });

    const sizeMatch = diagnoseSizeMatch({
      sourceValue: sizeValue,
      masterSizes,
      candidateIndex: sizeIndex
    });

    const matchResults = {
      body: bodyMatch,
      design: designMatch,
      color: colorMatch,
      size: sizeMatch
    };

    const reasons = [
      reasonForMatch("body", bodyMatch),
      reasonForMatch("design", designMatch),
      reasonForMatch("color", colorMatch),
      reasonForMatch("size", sizeMatch)
    ].filter(Boolean);

    const allMatched = Object.values(matchResults).every(
      result => result.status === MATCHED
    );

    const anyAmbiguous = Object.values(matchResults).some(
      result => result.status === AMBIGUOUS
    );

    const overallMatchStatus = allMatched
      ? MATCHED
      : anyAmbiguous
        ? AMBIGUOUS
        : UNMATCHED;

    const duplicate = sku
      ? duplicateSkuMap.get(sku) || null
      : null;

    const skuStatus = !sku
      ? "missing"
      : duplicate
        ? "duplicate"
        : "ok";

    if (!sku) {
      reasons.push("sku_missing");
    }

    if (duplicate) {
      reasons.push(
        duplicate.majorConflict
          ? "duplicate_sku_conflict"
          : "duplicate_sku"
      );
    }

    const product =
      productMap.get(
        productKey(
          pinkoiBodyId,
          pinkoiDesignId
        )
      ) || null;

    const price = diagnosePrice(product, row);

    const bodyId = bodyMatch.masterId;
    const designId = designMatch.masterId;
    const colorId = colorMatch.masterId;
    const sizeId = sizeMatch.masterId;

    const masterStock = allMatched
      ? readMasterStock(
          master,
          bodyId,
          designId,
          colorId,
          sizeId
        )
      : null;

    const pinkoiInventoryStock = Math.max(
      0,
      Number(row?.stock || 0)
    );

    const pinkoiStock = Math.max(
      0,
      Number(row?.pinkoiStock || 0)
    );

    const stockReasons = allMatched
      ? stockStatus({
          masterStock,
          pinkoiInventoryStock,
          pinkoiStock
        })
      : [];

    const syncEligible =
      skuStatus === "ok" &&
      allMatched;

    const variantId = syncEligible
      ? createVariantId(
          bodyId,
          designId,
          colorId,
          sizeId
        )
      : "";

    return {
      inventoryId: row.id,
      sku,
      skuStatus,
      duplicateSkuCount: duplicate?.count || 0,
      duplicateSkuMajorConflict:
        Boolean(duplicate?.majorConflict),

      pinkoi: {
        bodyId: pinkoiBodyId,
        designId: pinkoiDesignId,
        colorId: pinkoiColorId,
        size: sizeValue,
        stock: pinkoiInventoryStock,
        pinkoiStock,
        priceJpy: positiveNumber(row?.priceJpy),
        pinkoiProductId: text(row?.pinkoiProductId)
      },

      names: {
        body: displayName(pinkoiBody, pinkoiBodyId),
        design: displayName(pinkoiDesign, pinkoiDesignId),
        color: displayName(pinkoiColor, pinkoiColorId)
      },

      sourceMasters: {
        body: pinkoiBody,
        design: pinkoiDesign,
        color: pinkoiColor
      },

      explicitLinks: {
        masterDesignId:
          text(
            pinkoiDesign
              ?.masterDesignId
          )
      },

      masterMatch: {
        status: overallMatchStatus,
        reasons,
        body: bodyMatch,
        design: designMatch,
        color: colorMatch,
        size: sizeMatch,
        bodyId,
        designId,
        colorId,
        sizeId
      },

      masterStock,
      pinkoiInventoryStock,
      pinkoiStock,
      stockStatus: stockReasons,

      price,

      product: product
        ? {
            id: product.id || "",
            priceJpy: positiveNumber(product?.priceJpy),
            status: product?.status || "",
            pinkoiProductId:
              text(product?.pinkoiProductId)
          }
        : null,

      syncEligible,
      variantId,

      inventoryKey: syncEligible
        ? createStockTargetId(
            bodyId,
            designId,
            colorId,
            sizeId
          )
        : "",

      display: {
        body: allMatched
          ? masterDisplayName(masterBodies, bodyId)
          : displayName(pinkoiBody, pinkoiBodyId),
        design: allMatched
          ? masterDisplayName(masterDesigns, designId)
          : displayName(pinkoiDesign, pinkoiDesignId),
        color: allMatched
          ? masterDisplayName(masterColors, colorId)
          : displayName(pinkoiColor, pinkoiColorId),
        size: allMatched
          ? masterDisplayName(masterSizes, sizeId)
          : sizeValue
      }
    };
  });

  const variants = items
    .filter(item => item.syncEligible)
    .map(item => ({
      variantId: item.variantId,
      productId: "tshirt",
      category: "tshirt",

      bodyId: item.masterMatch.bodyId,
      designId: item.masterMatch.designId,
      colorId: item.masterMatch.colorId,
      sizeId: item.masterMatch.sizeId,

      pinkoiBodyId: item.pinkoi.bodyId,
      pinkoiDesignId: item.pinkoi.designId,
      pinkoiColorId: item.pinkoi.colorId,

      masterDesignId:
        item.explicitLinks
          ?.masterDesignId ||
        "",

      designMatchMethod:
        item.masterMatch
          ?.design
          ?.method ||
        "none",

      body: item.display.body,
      design: item.display.design,
      color: item.display.color,
      size: item.display.size,

      sku: item.sku,
      pinkoiSku: item.sku,

      pinkoiInventoryId: item.inventoryId,
      pinkoiProductId:
        item.product?.pinkoiProductId ||
        item.pinkoi.pinkoiProductId ||
        "",
      pinkoiProductStatus:
        item.product?.status || "",

      defaultPriceJPY:
        item.price.priceStatus === "ok"
          ? item.price.priceJpy
          : 0,

      pinkoiPriceJPY:
        item.price.priceStatus === "ok"
          ? item.price.priceJpy
          : 0,

      priceSource: item.price.priceSource,
      priceStatus: item.price.priceStatus,
      productPriceJpy: item.price.productPriceJpy,
      inventoryPriceJpy: item.price.inventoryPriceJpy,

      masterStock: item.masterStock,
      pinkoiInventoryStock: item.pinkoiInventoryStock,
      pinkoiStock: item.pinkoiStock,
      stockStatus: item.stockStatus,

      inventorySource: "tshirt",
      inventoryKey: item.inventoryKey,
      inventoryStatus: "tracked",
      saleStatus: "active",
      active: true,
      catalogAuthority: "pinkoi",
      source: "pinkoi_inventory"
    }));

  const unmatched = items.filter(
    item =>
      item.masterMatch.status === UNMATCHED ||
      item.skuStatus === "missing" ||
      item.skuStatus === "duplicate"
  );

  const ambiguous = items.filter(
    item =>
      item.masterMatch.status === AMBIGUOUS
  );

  const summary = {
    inventoryCount: items.length,
    inventoryDocuments: items.length,

    skuCount: items.filter(item => item.skuStatus !== "missing").length,
    missingSkuCount: items.filter(item => item.skuStatus === "missing").length,
    duplicateSkuCount: items.filter(item => item.skuStatus === "duplicate").length,

    matchedCount: items.filter(
      item => item.masterMatch.status === MATCHED
    ).length,
    mappedVariants: items.filter(
      item => item.masterMatch.status === MATCHED
    ).length,

    unmatchedCount: items.filter(
      item => item.masterMatch.status === UNMATCHED
    ).length,
    unmappedVariants: items.filter(
      item => item.masterMatch.status !== MATCHED
    ).length,

    ambiguousCount: items.filter(
      item => item.masterMatch.status === AMBIGUOUS
    ).length,

    priceCount: items.filter(
      item => item.price.priceStatus === "ok"
    ).length,
    pricedCount: items.filter(
      item => item.price.priceStatus === "ok"
    ).length,

    missingPriceCount: items.filter(
      item => item.price.priceStatus === "price_missing"
    ).length,

    priceConflictCount: items.filter(
      item => item.price.priceStatus === "price_conflict"
    ).length,

    masterStockCount: items.filter(
      item =>
        item.masterMatch.status === MATCHED &&
        Number(item.masterStock || 0) > 0
    ).length,

    masterStockZeroCount: items.filter(
      item =>
        item.masterMatch.status === MATCHED &&
        Number(item.masterStock || 0) === 0
    ).length,

    explicitDesignLinkCount: items.filter(
      item =>
        item.masterMatch
          ?.design
          ?.status === MATCHED &&
        item.masterMatch
          ?.design
          ?.method === "masterDesignId"
    ).length,

    zeroStockCatalogCount: items.filter(
      item =>
        item.masterMatch.status === MATCHED &&
        Number(item.masterStock || 0) === 0
    ).length,

    syncEligibleCount: variants.length
  };

  return {
    error: null,
    summary,
    items,
    variants,
    unmapped: unmatched,
    ambiguous,
    byVariantId: new Map(
      variants.map(item => [item.variantId, item])
    )
  };
}

export async function syncPinkoiTshirtCatalog() {
  const db = await requireDb();
  const catalog = await loadPinkoiTshirtCatalog();

  const {
    doc,
    writeBatch,
    serverTimestamp
  } = await firestoreModule();

  {
    const batch = writeBatch(db);

    batch.set(
      doc(db, "products", "tshirt"),
      {
        name: "T Shirt",
        category: "tshirt",
        inventoryMode: "variant",
        inventorySource: "tshirt",
        inventoryStatus: "tracked",
        saleStatus: "active",
        defaultTrackingMode: "semi",
        semiFields: ["size"],
        catalogAuthority: "pinkoi",
        priceAuthorityJPY: "pinkoi",
        active: true,
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );

    await batch.commit();
  }

  const CHUNK = 350;
  let processed = 0;

  for (
    let start = 0;
    start < catalog.variants.length;
    start += CHUNK
  ) {
    const batch = writeBatch(db);
    const chunk = catalog.variants.slice(start, start + CHUNK);

    chunk.forEach(row => {
      batch.set(
        doc(db, "productVariants", row.variantId),
        {
          variantId: row.variantId,
          productId: "tshirt",
          category: "tshirt",

          sku: row.pinkoiSku || row.variantId,
          pinkoiSku: row.pinkoiSku || "",

          pinkoiInventoryId: row.pinkoiInventoryId || "",
          pinkoiProductId: row.pinkoiProductId || "",
          pinkoiProductStatus: row.pinkoiProductStatus || "",

          bodyId: row.bodyId,
          designId: row.designId,
          colorId: row.colorId,
          sizeId: row.sizeId,

          pinkoiBodyId: row.pinkoiBodyId || "",
          pinkoiDesignId: row.pinkoiDesignId || "",
          pinkoiColorId: row.pinkoiColorId || "",

          masterDesignId:
            row.masterDesignId ||
            "",

          resolvedMasterDesignId:
            row.designId,

          designMatchMethod:
            row.designMatchMethod ||
            "none",

          body: row.body,
          design: row.design,
          color: row.color,
          size: row.size,

          inventorySource: "tshirt",
          inventoryKey: row.inventoryKey,
          inventoryStatus: "tracked",

          saleStatus: "active",
          active: true,
          catalogAuthority: "pinkoi",

          priceAuthorityJPY: row.priceSource,
          priceStatus: row.priceStatus,
          defaultPriceJPY: Number(row.defaultPriceJPY || 0),
          pinkoiPriceJPY: Number(row.pinkoiPriceJPY || 0),
          productPriceJpy: Number(row.productPriceJpy || 0),
          inventoryPriceJpy: Number(row.inventoryPriceJpy || 0),

          masterStock: Number(row.masterStock || 0),
          pinkoiInventoryStock: Number(row.pinkoiInventoryStock || 0),
          pinkoiStock: Number(row.pinkoiStock || 0),
          stockStatus: row.stockStatus || [],

          source: "pinkoi_inventory",
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );
    });

    await batch.commit();
    processed += chunk.length;
  }

  return {
    processed,
    mapped: catalog.summary.matchedCount,
    unmatched: catalog.summary.unmatchedCount,
    ambiguous: catalog.summary.ambiguousCount,
    skuCount: catalog.summary.skuCount,
    missingSkuCount: catalog.summary.missingSkuCount,
    duplicateSkuCount: catalog.summary.duplicateSkuCount,
    pricedCount: catalog.summary.priceCount,
    missingPriceCount: catalog.summary.missingPriceCount,
    priceConflictCount: catalog.summary.priceConflictCount,
    explicitDesignLinkCount:
      catalog.summary.explicitDesignLinkCount
  };
}
