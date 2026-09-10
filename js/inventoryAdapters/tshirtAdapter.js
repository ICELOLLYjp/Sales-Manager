import {
  getFirebaseState
} from "../firebase.js";


const COLLECTION = "tshirtStock";

const MASTER_DOCUMENT = "master";

const SHARED_DOCUMENT = "shared";

const LEGACY_BODY_ID =
  "body_unassigned";


async function firestoreModule() {

  return await import(
    "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js"
  );
}


async function loadDocument(
  documentId
) {

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


  const {
    doc,
    getDoc
  } = await firestoreModule();


  const ref =
    doc(
      db,
      COLLECTION,
      documentId
    );


  const snapshot =
    await getDoc(ref);


  if (
    !snapshot.exists()
  ) {

    throw new Error(
      `tshirtStock/${documentId} was not found.`
    );
  }


  return snapshot.data();
}


async function loadDocuments() {

  const [
    master,
    shared
  ] = await Promise.all([
    loadDocument(
      MASTER_DOCUMENT
    ),

    loadDocument(
      SHARED_DOCUMENT
    )
  ]);


  return {
    master,
    shared
  };
}


function normalize(
  value
) {

  return String(
    value ?? ""
  )
    .trim()
    .toLocaleLowerCase(
      "en-US"
    );
}


function findByName(
  map,
  name,
  fields
) {

  const key =
    normalize(name);


  if (!key) {
    return null;
  }


  return (
    Object
      .values(
        map || {}
      )
      .find(
        item => {

          return fields.some(
            field => {

              return (
                normalize(
                  item?.[field]
                ) === key
              );
            }
          );
        }
      ) || null
  );
}


function displayName(
  map,
  id,
  fields
) {

  const item =
    map?.[id] || {};


  for (
    const field of fields
  ) {

    const value =
      String(
        item?.[field] || ""
      ).trim();


    if (value) {
      return value;
    }
  }


  return id || "";
}


function encodePart(
  value
) {

  return encodeURIComponent(
    String(value || "")
  );
}


function createStockTargetId(
  bodyId,
  designId,
  colorId,
  sizeId
) {

  if (
    !bodyId ||
    !designId ||
    !colorId ||
    !sizeId
  ) {

    return null;
  }


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


function createVariantId(
  bodyId,
  designId,
  colorId,
  sizeId
) {

  return [
    "tshirt",
    encodePart(
      bodyId || "unassigned"
    ),
    encodePart(designId),
    encodePart(colorId),
    encodePart(sizeId)
  ].join("__");
}


function decodeStockTarget(
  stockTargetId
) {

  const value =
    String(
      stockTargetId || ""
    );


  if (
    !value.startsWith(
      "tshirt:"
    )
  ) {

    return null;
  }


  const parts =
    value
      .slice(7)
      .split("|")
      .map(
        part =>
          decodeURIComponent(
            part
          )
      );


  if (
    parts.length !== 4
  ) {

    return null;
  }


  return {
    bodyId: parts[0],
    designId: parts[1],
    colorId: parts[2],
    sizeId: parts[3]
  };
}


function currentQuantity(
  master,
  bodyId,
  designId,
  colorId,
  sizeId
) {

  if (!bodyId) {
    return null;
  }


  return Math.max(
    0,
    Number(
      master
        ?.inventory_v2
        ?.[bodyId]
        ?.[designId]
        ?.[colorId]
        ?.[sizeId]
        ?.qty || 0
    )
  );
}


function variantKey(
  bodyId,
  designId,
  colorId,
  sizeId
) {

  return [
    bodyId || "",
    designId || "",
    colorId || "",
    sizeId || ""
  ].join("\u241f");
}


function buildVariant({
  master,
  bodyId,
  designId,
  colorId,
  sizeId
}) {

  const masters =
    master?.masters || {};


  const bodies =
    masters?.bodies || {};


  const designs =
    masters?.designs || {};


  const colors =
    masters?.colors || {};


  const sizes =
    masters?.sizes || {};


  const quantity =
    currentQuantity(
      master,
      bodyId,
      designId,
      colorId,
      sizeId
    );


  let inventoryStatus =
    "tracked";


  let catalogStatus =
    "out_of_stock";


  if (!bodyId) {

    inventoryStatus =
      "not_initialized";

    catalogStatus =
      "not_initialized";

  } else if (
    quantity > 0
  ) {

    catalogStatus =
      "in_stock";
  }


  return {

    variantId:
      createVariantId(
        bodyId,
        designId,
        colorId,
        sizeId
      ),

    productId:
      "tshirt",

    category:
      "tshirt",

    sku:
      createVariantId(
        bodyId,
        designId,
        colorId,
        sizeId
      ),

    bodyId:
      bodyId || null,

    designId:
      designId || null,

    colorId:
      colorId || null,

    sizeId:
      sizeId || null,

    body:
      bodyId
        ? displayName(
            bodies,
            bodyId,
            [
              "managementName",
              "salesName"
            ]
          )
        : "Body未設定",

    design:
      displayName(
        designs,
        designId,
        [
          "managementName",
          "legacyKey",
          "salesName"
        ]
      ),

    color:
      displayName(
        colors,
        colorId,
        [
          "managementName",
          "legacyKey",
          "pinkoiName"
        ]
      ),

    size:
      displayName(
        sizes,
        sizeId,
        [
          "managementName",
          "salesName"
        ]
      ),

    sizeOrder:
      Number(
        sizes?.[sizeId]
          ?.order || 999
      ),

    quantity,

    stockTargetId:
      createStockTargetId(
        bodyId,
        designId,
        colorId,
        sizeId
      ),

    inventorySource:
      "tshirt",

    inventoryStatus,

    catalogStatus,

    active:
      true,

    source:
      "tshirtStock"
  };
}


function buildCatalog(
  master,
  shared
) {

  const masters =
    master?.masters || {};


  const designs =
    masters?.designs || {};


  const colors =
    masters?.colors || {};


  const sizes =
    masters?.sizes || {};


  const variants =
    new Map();


  const sortedSizes =
    Object
      .values(
        sizes
      )
      .sort(
        (a, b) =>
          Number(
            a?.order || 999
          ) -
          Number(
            b?.order || 999
          )
      );


  const sharedDesigns =
    shared?.designs || {};


  Object.entries(
    sharedDesigns
  ).forEach(
    ([
      designName,
      sharedDesign
    ]) => {

      const design =
        findByName(
          designs,
          designName,
          [
            "legacyKey",
            "managementName",
            "salesName"
          ]
        );


      if (!design) {
        return;
      }


      const sharedColors =
        Array.isArray(
          sharedDesign?.colors
        )
          ? sharedDesign.colors
          : [];


      sharedColors.forEach(
        colorName => {

          const color =
            findByName(
              colors,
              colorName,
              [
                "legacyKey",
                "managementName",
                "pinkoiName"
              ]
            );


          if (!color) {
            return;
          }


          const bodyId =
            color?.bodyId || null;


          sortedSizes.forEach(
            size => {

              const item =
                buildVariant({
                  master,
                  bodyId,
                  designId:
                    design.id,
                  colorId:
                    color.id,
                  sizeId:
                    size.id
                });


              const key =
                variantKey(
                  item.bodyId,
                  item.designId,
                  item.colorId,
                  item.sizeId
                );


              variants.set(
                key,
                item
              );
            }
          );
        }
      );
    }
  );


  Object.entries(
    master?.inventory_v2 || {}
  ).forEach(
    ([
      bodyId,
      designTree
    ]) => {

      if (
        bodyId ===
        LEGACY_BODY_ID
      ) {

        return;
      }


      Object.entries(
        designTree || {}
      ).forEach(
        ([
          designId,
          colorTree
        ]) => {


          Object.entries(
            colorTree || {}
          ).forEach(
            ([
              colorId,
              sizeTree
            ]) => {


              Object.entries(
                sizeTree || {}
              ).forEach(
                ([
                  sizeId
                ]) => {


                  const item =
                    buildVariant({
                      master,
                      bodyId,
                      designId,
                      colorId,
                      sizeId
                    });


                  const key =
                    variantKey(
                      bodyId,
                      designId,
                      colorId,
                      sizeId
                    );


                  variants.set(
                    key,
                    item
                  );
                }
              );
            }
          );
        }
      );
    }
  );


  const rows =
    Array.from(
      variants.values()
    );


  rows.sort(
    (a, b) => {

      return (
        a.body.localeCompare(
          b.body,
          "ja"
        ) ||

        a.design.localeCompare(
          b.design,
          "ja"
        ) ||

        a.color.localeCompare(
          b.color,
          "ja"
        ) ||

        a.sizeOrder -
          b.sizeOrder
      );
    }
  );


  return rows;
}


function buildSummary(
  master,
  rows
) {

  const totalStock =
    rows.reduce(
      (
        total,
        item
      ) => {

        return (
          total +
          Math.max(
            0,
            Number(
              item.quantity || 0
            )
          )
        );
      },
      0
    );


  const inStockSkuCount =
    rows.filter(
      item =>
        item.catalogStatus ===
        "in_stock"
    ).length;


  const outOfStockSkuCount =
    rows.filter(
      item =>
        item.catalogStatus ===
        "out_of_stock"
    ).length;


  const notInitializedCount =
    rows.filter(
      item =>
        item.catalogStatus ===
        "not_initialized"
    ).length;


  return {

    source:
      "tshirtStock/master",

    catalogSource:
      "tshirtStock/master + tshirtStock/shared",

    schemaVersion:
      Number(
        master?.schemaVersion || 0
      ),

    inventoryAuthority:
      master?.inventoryAuthority ||
      "",

    totalStock,

    catalogSkuCount:
      rows.length,

    inStockSkuCount,

    outOfStockSkuCount,

    notInitializedCount,

    updatedAt:
      master?.updatedAt ||
      null
  };
}


export const tshirtAdapter = {

  async getCatalogSnapshot() {

    const {
      master,
      shared
    } =
      await loadDocuments();


    const rows =
      buildCatalog(
        master,
        shared
      );


    return {

      summary:
        buildSummary(
          master,
          rows
        ),

      rows
    };
  },


  async listCatalogRows() {

    const snapshot =
      await this
        .getCatalogSnapshot();


    return snapshot.rows;
  },


  async listInventoryRows() {

    const rows =
      await this
        .listCatalogRows();


    return rows.filter(
      item =>
        item.catalogStatus ===
        "in_stock"
    );
  },


  async getMasterSummary() {

    const snapshot =
      await this
        .getCatalogSnapshot();


    return snapshot.summary;
  },


  async getStock(
    stockTargetId
  ) {

    const target =
      decodeStockTarget(
        stockTargetId
      );


    if (!target) {
      return null;
    }


    const master =
      await loadDocument(
        MASTER_DOCUMENT
      );


    return currentQuantity(
      master,
      target.bodyId,
      target.designId,
      target.colorId,
      target.sizeId
    );
  },


  async changeStock(
    stockTargetId,
    quantityChange,
    operationId
  ) {

    console.warn(
      "Read only Phase",
      {
        stockTargetId,
        quantityChange,
        operationId
      }
    );


    throw new Error(
      "Tシャツ在庫は現在読み取り専用です。"
    );
  },


  async canTrack(
    stockTargetId
  ) {

    const target =
      decodeStockTarget(
        stockTargetId
      );


    if (!target) {
      return false;
    }


    const master =
      await loadDocument(
        MASTER_DOCUMENT
      );


    return Boolean(
      master
        ?.masters
        ?.bodies
        ?.[target.bodyId] &&

      master
        ?.masters
        ?.designs
        ?.[target.designId] &&

      master
        ?.masters
        ?.colors
        ?.[target.colorId] &&

      master
        ?.masters
        ?.sizes
        ?.[target.sizeId]
    );
  }
};
