import { getFirebaseState } from "../firebase.js";

async function firestoreModule() {
  return await import("https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js");
}

function safePart(value) {
  return encodeURIComponent(
    String(value || "")
      .trim()
      .toLocaleLowerCase("en-US")
  );
}

function buildGeneralVariantId({ category, name, size, variant }) {
  return [category, name, size, variant]
    .filter(value => String(value || "").trim())
    .map(safePart)
    .join("__");
}

async function requireDb() {
  const { db, enabled } = getFirebaseState();
  if (!enabled || !db) throw new Error("Firebase is not connected.");
  return db;
}

export async function listAllProductVariants() {
  const db = await requireDb();
  const {
    collection,
    getDocsFromServer
  } = await firestoreModule();

  const snapshot =
    await getDocsFromServer(
      collection(
        db,
        "productVariants"
      )
    );

  return snapshot.docs.map(item => ({
    id: item.id,
    ...item.data()
  }));
}

export async function registerTshirtVariant(row) {
  const db = await requireDb();
  const { doc, setDoc, serverTimestamp } = await firestoreModule();

  await setDoc(
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
      active: true,
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );

  await setDoc(
    doc(db, "productVariants", row.variantId),
    {
      variantId: row.variantId,
      productId: "tshirt",
      category: "tshirt",
      sku: row.variantId,
      bodyId: row.bodyId,
      designId: row.designId,
      colorId: row.colorId,
      sizeId: row.sizeId,
      body: row.body,
      design: row.design,
      color: row.color,
      size: row.size,
      sizeOrder: row.sizeOrder,
      inventorySource: "tshirt",
      inventoryKey: row.stockTargetId,
      inventoryStatus: "tracked",
      saleStatus: "active",
      active: true,
      discoveredFromStock: Number(row.quantity || 0) > 0,
      manuallyRegistered: true,
      source: "tshirtStock/master",
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );

  return { variantId: row.variantId };
}

export async function registerGeneralProduct({
  category,
  categoryLabel,
  posLabel,
  name,
  size = "",
  variant = "",
  inventoryMode = "variant",
  inventorySource = "sales_app",
  defaultTrackingMode = "quick",
  defaultPriceJPY = null
}) {
  const db = await requireDb();
  const { doc, setDoc, serverTimestamp } = await firestoreModule();

  const cleanName = String(name || "").trim();
  if (!category || !cleanName) {
    throw new Error("カテゴリと商品名を入力してください。");
  }

  const variantId = buildGeneralVariantId({
    category,
    name: cleanName,
    size,
    variant
  });

  if (!variantId) throw new Error("商品IDを作成できませんでした。");

  const tracked = inventoryMode !== "none";

  await setDoc(
    doc(db, "products", category),
    {
      name: categoryLabel || category,
      posLabel: posLabel || categoryLabel || category,
      category,
      inventoryMode,
      inventorySource: tracked ? inventorySource : null,
      inventoryStatus: tracked ? "not_initialized" : "not_tracked",
      saleStatus: "active",
      defaultTrackingMode,
      active: true,
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );

  const data = {
    variantId,
    productId: category,
    category,
    sku: variantId,
    displayName: cleanName,
    design: cleanName,
    size: String(size || "").trim(),
    variant: String(variant || "").trim(),
    inventoryMode,
    inventorySource: tracked ? inventorySource : null,
    inventoryStatus: tracked ? "not_initialized" : "not_tracked",
    saleStatus: "active",
    active: true,
    source: "sales_manager",
    updatedAt: serverTimestamp()
  };

  if (defaultPriceJPY !== null && defaultPriceJPY !== "") {
    data.defaultPriceJPY = Number(defaultPriceJPY);
  }

  await setDoc(
    doc(db, "productVariants", variantId),
    data,
    { merge: true }
  );

  return { variantId };
}
