import {
  getFirebaseState
} from "../firebase.js";


async function firestoreModule() {

  return await import(
    "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js"
  );
}


export async function loadTshirtProductVariants() {

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
    collection,
    getDocs,
    query,
    where
  } = await firestoreModule();


  const ref =
    collection(
      db,
      "productVariants"
    );


  const q =
    query(
      ref,
      where(
        "productId",
        "==",
        "tshirt"
      )
    );


  const snapshot =
    await getDocs(q);


  return snapshot.docs.map(
    item => ({
      id: item.id,
      ...item.data()
    })
  );
}


export async function syncTshirtCurrentStockRows(
  rows
) {

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
    writeBatch,
    serverTimestamp
  } = await firestoreModule();


  const productRef =
    doc(
      db,
      "products",
      "tshirt"
    );


  const productData = {

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

    active:
      true,

    updatedAt:
      serverTimestamp()
  };


  const validRows =
    rows.filter(
      row =>
        Number(
          row.quantity || 0
        ) > 0
    );


  const chunkSize =
    400;


  let processed =
    0;


  for (
    let start = 0;
    start < validRows.length;
    start += chunkSize
  ) {

    const batch =
      writeBatch(db);


    if (start === 0) {

      batch.set(
        productRef,
        productData,
        {
          merge: true
        }
      );
    }


    const chunk =
      validRows.slice(
        start,
        start + chunkSize
      );


    chunk.forEach(
      row => {

        const variantRef =
          doc(
            db,
            "productVariants",
            row.variantId
          );


        batch.set(
          variantRef,
          {

            variantId:
              row.variantId,

            productId:
              "tshirt",

            category:
              "tshirt",

            sku:
              row.variantId,

            bodyId:
              row.bodyId,

            designId:
              row.designId,

            colorId:
              row.colorId,

            sizeId:
              row.sizeId,

            body:
              row.body,

            design:
              row.design,

            color:
              row.color,

            size:
              row.size,

            sizeOrder:
              row.sizeOrder,

            inventorySource:
              "tshirt",

            inventoryKey:
              row.stockTargetId,

            inventoryStatus:
              "tracked",

            saleStatus:
              "active",

            active:
              true,

            discoveredFromStock:
              true,

            source:
              "tshirtStock/master",

            updatedAt:
              serverTimestamp()

          },
          {
            merge: true
          }
        );
      }
    );


    await batch.commit();


    processed +=
      chunk.length;
  }


  return {
    processed
  };
}
