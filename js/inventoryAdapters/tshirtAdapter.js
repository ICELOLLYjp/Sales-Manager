import {
  getFirebaseState
} from "../firebase.js";


const MASTER_COLLECTION = "tshirtStock";
const MASTER_DOCUMENT = "master";

const LEGACY_BODY_ID =
  "body_unassigned";


async function getFirestoreModule() {

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
  } = await getFirestoreModule();


  const ref = doc(
    db,
    MASTER_COLLECTION,
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


function encodeStockTarget(
  bodyId,
  designId,
  colorId,
  sizeId
) {

  const values = [
    bodyId,
    designId,
    colorId,
    sizeId
  ].map(value =>
    encodeURIComponent(
      String(value || "")
    )
  );


  return (
    "tshirt:" +
    values.join("|")
  );
}


function decodeStockTarget(
  stockTargetId
) {

  const value =
    String(stockTargetId || "");


  if (!value.startsWith("tshirt:")) {

    return null;
  }


  const parts =
    value
      .slice(7)
      .split("|")
      .map(value =>
        decodeURIComponent(value)
      );


  if (parts.length !== 4) {

    return null;
  }


  return {
    bodyId: parts[0],
    designId: parts[1],
    colorId: parts[2],
    sizeId: parts[3]
  };
}


function masterName(
  map,
  id,
  fields
) {

  const item =
    map?.[id] || {};


  for (const field of fields) {

    const value =
      String(
        item?.[field] || ""
      ).trim();


    if (value) return value;
  }


  return id;
}


function getSizeOrder(
  sizes,
  sizeId
) {

  return Number(
    sizes?.[sizeId]?.order || 999
  );
}


export const tshirtAdapter = {

  async getMasterSummary() {

    const master =
      await loadMasterDocument();


    const inventory =
      master?.inventory_v2 || {};


    let total = 0;
    let skuCount = 0;


    Object.entries(inventory)
      .forEach(
        ([bodyId, designTree]) => {

          if (
            bodyId ===
            LEGACY_BODY_ID
          ) {
            return;
          }


          Object.values(
            designTree || {}
          ).forEach(
            colorTree => {

              Object.values(
                colorTree || {}
              ).forEach(
                sizeTree => {

                  Object.values(
                    sizeTree || {}
                  ).forEach(
                    cell => {

                      const qty =
                        Math.max(
                          0,
                          Number(
                            cell?.qty || 0
                          )
                        );


                      if (qty > 0) {

                        total += qty;
                        skuCount += 1;
                      }
                    }
                  );
                }
              );
            }
          );
        }
      );


    return {
      source:
        "tshirtStock/master",

      inventoryAuthority:
        master?.inventoryAuthority || "",

      schemaVersion:
        Number(
          master?.schemaVersion || 0
        ),

      total,

      skuCount,

      updatedAt:
        master?.updatedAt || null
    };
  },


  async listInventoryRows(
    options = {}
  ) {

    const includeZero =
      Boolean(
        options.includeZero
      );


    const master =
      await loadMasterDocument();


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


    const inventory =
      master?.inventory_v2 || {};


    const rows = [];


    Object.entries(
      inventory
    ).forEach(
      ([bodyId, designTree]) => {

        if (
          bodyId ===
          LEGACY_BODY_ID
        ) {
          return;
        }


        Object.entries(
          designTree || {}
        ).forEach(
          ([designId, colorTree]) => {


            Object.entries(
              colorTree || {}
            ).forEach(
              ([colorId, sizeTree]) => {


                Object.entries(
                  sizeTree || {}
                ).forEach(
                  ([sizeId, cell]) => {


                    const quantity =
                      Math.max(
                        0,
                        Number(
                          cell?.qty || 0
                        )
                      );


                    if (
                      !includeZero &&
                      quantity <= 0
                    ) {
                      return;
                    }


                    rows.push({

                      stockTargetId:
                        encodeStockTarget(
                          bodyId,
                          designId,
                          colorId,
                          sizeId
                        ),

                      bodyId,
                      designId,
                      colorId,
                      sizeId,

                      body:
                        masterName(
                          bodies,
                          bodyId,
                          [
                            "managementName",
                            "salesName"
                          ]
                        ),

                      design:
                        masterName(
                          designs,
                          designId,
                          [
                            "managementName",
                            "legacyKey",
                            "salesName"
                          ]
                        ),

                      color:
                        masterName(
                          colors,
                          colorId,
                          [
                            "managementName",
                            "legacyKey",
                            "pinkoiName"
                          ]
                        ),

                      size:
                        masterName(
                          sizes,
                          sizeId,
                          [
                            "managementName",
                            "salesName"
                          ]
                        ),

                      sizeOrder:
                        getSizeOrder(
                          sizes,
                          sizeId
                        ),

                      quantity,

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


    const quantity =
      Math.max(
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


    return quantity;
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
      "Tシャツ在庫は現在読み取り専用です。販売による在庫更新は次のPhaseで有効化します。"
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
      await loadMasterDocument();


    const cell =
      master
        ?.inventory_v2
        ?.[target.bodyId]
        ?.[target.designId]
        ?.[target.colorId]
        ?.[target.sizeId];


    return Boolean(cell);
  }
};
