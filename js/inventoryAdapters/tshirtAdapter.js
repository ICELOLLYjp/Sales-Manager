import {
  getFirebaseState
} from "../firebase.js";


const COLLECTION =
  "tshirtStock";

const MASTER_DOCUMENT =
  "master";

const LEGACY_BODY_ID =
  "body_unassigned";


async function firestoreModule() {

  return await import(
    "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js"
  );
}


async function loadMasterDocument() {

  const {
    db,
    enabled
  } = getFirebaseState();


  if (!enabled || !db) {

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
      MASTER_DOCUMENT
    );


  const snapshot =
    await getDoc(ref);


  if (!snapshot.exists()) {

    throw new Error(
      "tshirtStock/master was not found."
    );
  }


  return snapshot.data();
}


function encodePart(
  value
) {

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


function decodeStockTarget(
  value
) {

  const text =
    String(
      value || ""
    );


  if (
    !text.startsWith(
      "tshirt:"
    )
  ) {

    return null;
  }


  const parts =
    text
      .slice(7)
      .split("|")
      .map(
        value =>
          decodeURIComponent(
            value
          )
      );


  if (
    parts.length !== 4
  ) {

    return null;
  }


  return {

    bodyId:
      parts[0],

    designId:
      parts[1],

    colorId:
      parts[2],

    sizeId:
      parts[3]
  };
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


function buildInventoryRows(
  master
) {

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


  const rows = [];


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
                  sizeId,
                  cell
                ]) => {


                  const quantity =
                    Math.max(
                      0,
                      Number(
                        cell?.qty || 0
                      )
                    );


                  if (
                    quantity <= 0
                  ) {

                    return;
                  }


                  const variantId =
                    createVariantId(
                      bodyId,
                      designId,
                      colorId,
                      sizeId
                    );


                  rows.push({

                    variantId,

                    productId:
                      "tshirt",

                    category:
                      "tshirt",

                    bodyId,

                    designId,

                    colorId,

                    sizeId,

                    body:
                      displayName(
                        bodies,
                        bodyId,
                        [
                          "managementName",
                          "salesName"
                        ]
                      ),

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
                        sizes
                          ?.[sizeId]
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
                      "tshirt"
                  });
                }
              );
            }
          );
        }
      );
    }
  );


  rows.sort(
    (
      a,
      b
    ) => {

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


export const tshirtAdapter = {

  async getInventorySnapshot() {

    const master =
      await loadMasterDocument();


    const rows =
      buildInventoryRows(
        master
      );


    const totalStock =
      rows.reduce(
        (
          sum,
          row
        ) =>
          sum +
          Number(
            row.quantity || 0
          ),
        0
      );


    return {

      summary: {

        source:
          "tshirtStock/master",

        schemaVersion:
          Number(
            master
              ?.schemaVersion || 0
          ),

        inventoryAuthority:
          master
            ?.inventoryAuthority ||
          "",

        totalStock,

        activeSkuCount:
          rows.length
      },

      rows
    };
  },


  async listInventoryRows() {

    const snapshot =
      await this
        .getInventorySnapshot();


    return snapshot.rows;
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
      await loadMasterDocument();


    return Math.max(
      0,
      Number(
        master
          ?.inventory_v2
          ?.[target.bodyId]
          ?.[target.designId]
          ?.[target.colorId]
          ?.[target.sizeId]
          ?.qty || 0
      )
    );
  },


  async changeStock(
    stockTargetId,
    quantityChange,
    operationId
  ) {

    console.warn(
      "Read only phase",
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


    return Boolean(
      target
    );
  }
};
