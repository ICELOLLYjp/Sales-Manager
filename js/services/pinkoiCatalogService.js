import { getFirebaseState } from "../firebase.js";

const COLLECTIONS = {
  bodies:
    "pinkoi_bodies",
  designs:
    "pinkoi_designs",
  colors:
    "pinkoi_colors",
  inventory:
    "pinkoi_inventory",
  products:
    "pinkoi_products"
};

async function firestoreModule() {
  return await import(
    "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js"
  );
}

async function requireDb() {
  const {
    db,
    enabled
  } = getFirebaseState();

  if (
    !enabled ||
    !db
  ) {
    throw new Error(
      "Firebase is not connected."
    );
  }

  return db;
}

function encodePart(value) {
  return encodeURIComponent(
    String(
      value || ""
    )
  );
}

function createVariantId(
  bodyId,
  designId,
  colorId,
  sizeId
) {
  return [
    "tshirt",
    encodePart(bodyId),
    encodePart(designId),
    encodePart(colorId),
    encodePart(sizeId)
  ].join("__");
}

function createStockTargetId(
  bodyId,
  designId,
  colorId,
  sizeId
) {
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

function text(value) {
  return String(
    value || ""
  ).trim();
}

function normalizedName(value) {
  return text(value)
    .toLocaleLowerCase("en-US")
    .replace(/grey/g, "gray")
    .replace(/[^a-z0-9]+/g, "");
}

function candidateValues(item, id = "") {
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
    item?.displayName?.ja,
    item?.displayName?.en,
    item?.displayName?.zhTW
  ]
    .map(text)
    .filter(Boolean);
}

function buildMasterMatcher(masterMap) {
  const direct =
    new Map();

  Object.entries(
    masterMap || {}
  ).forEach(
    ([id, item]) => {
      candidateValues(
        item,
        id
      ).forEach(
        value => {
          const key =
            normalizedName(
              value
            );

          if (
            key &&
            !direct.has(key)
          ) {
            direct.set(
              key,
              id
            );
          }
        }
      );
    }
  );

  return direct;
}

function resolveMasterId({
  pinkoiId,
  pinkoiItem,
  masterMap,
  matcher
}) {
  if (
    pinkoiId &&
    masterMap?.[pinkoiId]
  ) {
    return pinkoiId;
  }

  const candidates =
    candidateValues(
      pinkoiItem,
      pinkoiId
    );

  for (
    const value
    of candidates
  ) {
    const key =
      normalizedName(
        value
      );

    if (
      key &&
      matcher.has(key)
    ) {
      return matcher.get(
        key
      );
    }
  }

  return "";
}

function buildSizeMatcher(
  master
) {
  const sizes =
    master?.masters
      ?.sizes ||
    {};

  return buildMasterMatcher(
    sizes
  );
}

function resolveSizeId(
  master,
  sizeValue,
  sizeMatcher
) {
  const sizes =
    master?.masters
      ?.sizes ||
    {};

  const raw =
    text(
      sizeValue
    );

  if (
    raw &&
    sizes?.[raw]
  ) {
    return raw;
  }

  const key =
    normalizedName(
      raw
    );

  return (
    sizeMatcher.get(
      key
    ) ||
    ""
  );
}

function displayName(
  item,
  fallback = ""
) {
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

function masterDisplayName(
  source,
  id,
  fields
) {
  const item =
    source?.[id] ||
    {};

  for (
    const field
    of fields
  ) {
    const value =
      text(
        item?.[field]
      );

    if (value) {
      return value;
    }
  }

  return id || "";
}

function pinkoiProductKey(
  bodyId,
  designId
) {
  return `${bodyId}__${designId}`;
}

function productPriceJpy(
  product,
  inventoryRow
) {
  const productPrice =
    Number(
      product?.priceJpy ||
      0
    );

  if (
    productPrice > 0
  ) {
    return {
      priceJPY:
        productPrice,
      priceSource:
        "pinkoi_products"
    };
  }

  const variantPrice =
    Number(
      inventoryRow?.priceJpy ||
      0
    );

  if (
    variantPrice > 0
  ) {
    return {
      priceJPY:
        variantPrice,
      priceSource:
        "pinkoi_inventory"
    };
  }

  return {
    priceJPY:
      0,
    priceSource:
      "none"
  };
}

async function loadCollection(
  db,
  name
) {
  const {
    collection,
    getDocsFromServer
  } =
    await firestoreModule();

  const snapshot =
    await getDocsFromServer(
      collection(
        db,
        COLLECTIONS[
          name
        ]
      )
    );

  return snapshot.docs.map(
    item => ({
      id:
        item.id,
      ...item.data()
    })
  );
}

async function loadTshirtMaster(
  db
) {
  const {
    doc,
    getDocFromServer
  } =
    await firestoreModule();

  const snapshot =
    await getDocFromServer(
      doc(
        db,
        "tshirtStock",
        "master"
      )
    );

  if (
    !snapshot.exists()
  ) {
    throw new Error(
      "tshirtStock/master was not found."
    );
  }

  return snapshot.data();
}

export async function loadPinkoiTshirtCatalog() {
  const db =
    await requireDb();

  const [
    master,
    bodies,
    designs,
    colors,
    inventory,
    products
  ] =
    await Promise.all([
      loadTshirtMaster(
        db
      ),
      loadCollection(
        db,
        "bodies"
      ),
      loadCollection(
        db,
        "designs"
      ),
      loadCollection(
        db,
        "colors"
      ),
      loadCollection(
        db,
        "inventory"
      ),
      loadCollection(
        db,
        "products"
      )
    ]);

  const bodyMap =
    new Map(
      bodies.map(
        item => [
          item.id,
          item
        ]
      )
    );

  const designMap =
    new Map(
      designs.map(
        item => [
          item.id,
          item
        ]
      )
    );

  const colorMap =
    new Map(
      colors.map(
        item => [
          item.id,
          item
        ]
      )
    );

  const productMap =
    new Map();

  products.forEach(
    item => {
      const key =
        item.id ||
        pinkoiProductKey(
          item.bodyId,
          item.designId
        );

      productMap.set(
        key,
        item
      );

      if (
        item.bodyId &&
        item.designId
      ) {
        productMap.set(
          pinkoiProductKey(
            item.bodyId,
            item.designId
          ),
          item
        );
      }
    }
  );

  const masters =
    master?.masters ||
    {};

  const masterBodies =
    masters?.bodies ||
    {};

  const masterDesigns =
    masters?.designs ||
    {};

  const masterColors =
    masters?.colors ||
    {};

  const bodyMatcher =
    buildMasterMatcher(
      masterBodies
    );

  const designMatcher =
    buildMasterMatcher(
      masterDesigns
    );

  const colorMatcher =
    buildMasterMatcher(
      masterColors
    );

  const sizeMatcher =
    buildSizeMatcher(
      master
    );

  const variants = [];
  const unmapped = [];

  inventory.forEach(
    row => {
      const pinkoiBodyId =
        text(
          row.bodyId
        );

      const pinkoiDesignId =
        text(
          row.designId
        );

      const pinkoiColorId =
        text(
          row.colorId
        );

      const sizeText =
        text(
          row.size
        );

      const pinkoiBody =
        bodyMap.get(
          pinkoiBodyId
        ) ||
        null;

      const pinkoiDesign =
        designMap.get(
          pinkoiDesignId
        ) ||
        null;

      const pinkoiColor =
        colorMap.get(
          pinkoiColorId
        ) ||
        null;

      const bodyId =
        resolveMasterId({
          pinkoiId:
            pinkoiBodyId,
          pinkoiItem:
            pinkoiBody,
          masterMap:
            masterBodies,
          matcher:
            bodyMatcher
        });

      const designId =
        resolveMasterId({
          pinkoiId:
            pinkoiDesignId,
          pinkoiItem:
            pinkoiDesign,
          masterMap:
            masterDesigns,
          matcher:
            designMatcher
        });

      const colorId =
        resolveMasterId({
          pinkoiId:
            pinkoiColorId,
          pinkoiItem:
            pinkoiColor,
          masterMap:
            masterColors,
          matcher:
            colorMatcher
        });

      const sizeId =
        resolveSizeId(
          master,
          sizeText,
          sizeMatcher
        );

      const reasons = [];

      if (!bodyId) {
        reasons.push(
          "body"
        );
      }

      if (!designId) {
        reasons.push(
          "design"
        );
      }

      if (!colorId) {
        reasons.push(
          "color"
        );
      }

      if (!sizeId) {
        reasons.push(
          "size"
        );
      }

      if (
        reasons.length
      ) {
        unmapped.push({
          id:
            row.id,

          sku:
            text(
              row.sku
            ),

          pinkoiBodyId,
          pinkoiDesignId,
          pinkoiColorId,

          bodyName:
            displayName(
              pinkoiBody,
              pinkoiBodyId
            ),

          designName:
            displayName(
              pinkoiDesign,
              pinkoiDesignId
            ),

          colorName:
            displayName(
              pinkoiColor,
              pinkoiColorId
            ),

          size:
            sizeText,

          reasons
        });

        return;
      }

      /*
       * Product lookup must use Pinkoi IDs.
       * Inventory linkage must use tshirtStock/master IDs.
       */
      const product =
        productMap.get(
          pinkoiProductKey(
            pinkoiBodyId,
            pinkoiDesignId
          )
        ) ||
        null;

      const price =
        productPriceJpy(
          product,
          row
        );

      const variantId =
        createVariantId(
          bodyId,
          designId,
          colorId,
          sizeId
        );

      variants.push({
        variantId,

        productId:
          "tshirt",

        category:
          "tshirt",

        bodyId,
        designId,
        colorId,
        sizeId,

        pinkoiBodyId,
        pinkoiDesignId,
        pinkoiColorId,

        body:
          masterDisplayName(
            masterBodies,
            bodyId,
            [
              "managementName",
              "salesName"
            ]
          ),

        design:
          masterDisplayName(
            masterDesigns,
            designId,
            [
              "managementName",
              "legacyKey",
              "salesName"
            ]
          ),

        color:
          masterDisplayName(
            masterColors,
            colorId,
            [
              "managementName",
              "legacyKey",
              "pinkoiName"
            ]
          ),

        size:
          masterDisplayName(
            masters?.sizes ||
            {},
            sizeId,
            [
              "managementName",
              "salesName"
            ]
          ) ||
          sizeText,

        sku:
          text(
            row.sku
          ),

        pinkoiSku:
          text(
            row.sku
          ),

        pinkoiInventoryId:
          row.id,

        pinkoiProductId:
          text(
            product?.pinkoiProductId ||
            row?.pinkoiProductId
          ),

        pinkoiProductKey:
          pinkoiProductKey(
            pinkoiBodyId,
            pinkoiDesignId
          ),

        pinkoiProductStatus:
          product?.status ||
          "",

        titleJa:
          product?.titleJa ||
          "",

        titleEn:
          product?.titleEn ||
          product?.customTitle ||
          "",

        titleZh:
          product?.titleZh ||
          "",

        defaultPriceJPY:
          price.priceJPY,

        pinkoiPriceJPY:
          price.priceJPY,

        priceSource:
          price.priceSource,

        pinkoiStock:
          Math.max(
            0,
            Number(
              row?.pinkoiStock ||
              0
            )
          ),

        pinkoiSyncedStock:
          Math.max(
            0,
            Number(
              row?.stock ||
              0
            )
          ),

        inventorySource:
          "tshirt",

        inventoryKey:
          createStockTargetId(
            bodyId,
            designId,
            colorId,
            sizeId
          ),

        inventoryStatus:
          "tracked",

        saleStatus:
          "active",

        active:
          true,

        catalogAuthority:
          "pinkoi",

        source:
          "pinkoi_inventory"
      });
    }
  );

  const pricedCount =
    variants.filter(
      item =>
        Number(
          item.defaultPriceJPY ||
          0
        ) > 0
    ).length;

  const skuCount =
    variants.filter(
      item =>
        Boolean(
          text(
            item.pinkoiSku
          )
        )
    ).length;

  return {
    summary: {
      inventoryDocuments:
        inventory.length,

      mappedVariants:
        variants.length,

      unmappedVariants:
        unmapped.length,

      products:
        products.length,

      skuCount,

      pricedCount,

      zeroStockCatalogCount:
        variants.filter(
          item =>
            Number(
              item.pinkoiSyncedStock ||
              0
            ) === 0
        ).length
    },

    variants,

    unmapped,

    byVariantId:
      new Map(
        variants.map(
          item => [
            item.variantId,
            item
          ]
        )
      )
  };
}

export async function syncPinkoiTshirtCatalog() {
  const db =
    await requireDb();

  const catalog =
    await loadPinkoiTshirtCatalog();

  const {
    doc,
    writeBatch,
    serverTimestamp
  } =
    await firestoreModule();

  {
    const batch =
      writeBatch(
        db
      );

    batch.set(
      doc(
        db,
        "products",
        "tshirt"
      ),
      {
        name:
          "T Shirt",

        category:
          "tshirt",

        inventoryMode:
          "variant",

        inventorySource:
          "tshirt",

        inventoryStatus:
          "tracked",

        saleStatus:
          "active",

        defaultTrackingMode:
          "semi",

        semiFields: [
          "size"
        ],

        catalogAuthority:
          "pinkoi",

        priceAuthorityJPY:
          "pinkoi",

        active:
          true,

        updatedAt:
          serverTimestamp()
      },
      {
        merge:
          true
      }
    );

    await batch.commit();
  }

  const CHUNK =
    350;

  let processed =
    0;

  for (
    let start = 0;
    start <
      catalog.variants.length;
    start +=
      CHUNK
  ) {
    const batch =
      writeBatch(
        db
      );

    const chunk =
      catalog.variants.slice(
        start,
        start +
          CHUNK
      );

    chunk.forEach(
      row => {
        const data = {
          variantId:
            row.variantId,

          productId:
            "tshirt",

          category:
            "tshirt",

          sku:
            row.pinkoiSku ||
            row.variantId,

          pinkoiSku:
            row.pinkoiSku ||
            "",

          pinkoiInventoryId:
            row.pinkoiInventoryId ||
            "",

          pinkoiProductId:
            row.pinkoiProductId ||
            "",

          pinkoiProductKey:
            row.pinkoiProductKey ||
            "",

          pinkoiProductStatus:
            row.pinkoiProductStatus ||
            "",

          titleJa:
            row.titleJa ||
            "",

          titleEn:
            row.titleEn ||
            "",

          titleZh:
            row.titleZh ||
            "",

          bodyId:
            row.bodyId,

          designId:
            row.designId,

          colorId:
            row.colorId,

          sizeId:
            row.sizeId,

          pinkoiBodyId:
            row.pinkoiBodyId ||
            "",

          pinkoiDesignId:
            row.pinkoiDesignId ||
            "",

          pinkoiColorId:
            row.pinkoiColorId ||
            "",

          body:
            row.body,

          design:
            row.design,

          color:
            row.color,

          size:
            row.size,

          inventorySource:
            "tshirt",

          inventoryKey:
            row.inventoryKey,

          inventoryStatus:
            "tracked",

          saleStatus:
            "active",

          active:
            true,

          catalogAuthority:
            "pinkoi",

          priceAuthorityJPY:
            row.priceSource,

          defaultPriceJPY:
            Number(
              row.defaultPriceJPY ||
              0
            ),

          pinkoiPriceJPY:
            Number(
              row.pinkoiPriceJPY ||
              0
            ),

          pinkoiStock:
            Number(
              row.pinkoiStock ||
              0
            ),

          pinkoiSyncedStock:
            Number(
              row.pinkoiSyncedStock ||
              0
            ),

          source:
            "pinkoi_inventory",

          updatedAt:
            serverTimestamp()
        };

        batch.set(
          doc(
            db,
            "productVariants",
            row.variantId
          ),
          data,
          {
            merge:
              true
          }
        );
      }
    );

    await batch.commit();

    processed +=
      chunk.length;
  }

  return {
    processed,

    mapped:
      catalog.summary
        .mappedVariants,

    unmapped:
      catalog.summary
        .unmappedVariants,

    skuCount:
      catalog.summary
        .skuCount,

    pricedCount:
      catalog.summary
        .pricedCount
  };
}
