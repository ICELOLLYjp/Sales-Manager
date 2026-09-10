import { getFirebaseState } from "../firebase.js";

const COLLECTION = "salesSessions";

async function firestoreModule() {
  return await import(
    "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js"
  );
}

async function requireDb() {
  const { db, enabled } =
    getFirebaseState();

  if (!enabled || !db) {
    throw new Error(
      "Firebase is not connected."
    );
  }

  return db;
}

function text(value) {
  return String(
    value ?? ""
  ).trim();
}

function nonNegativeInt(value) {
  const number =
    Number(value);

  if (
    !Number.isFinite(number)
  ) {
    return 0;
  }

  return Math.max(
    0,
    Math.floor(number)
  );
}

function signedInt(value) {
  const number =
    Number(value);

  if (
    !Number.isFinite(number)
  ) {
    return 0;
  }

  return Math.trunc(number);
}

function normalizeOpeningItem(
  item
) {
  return {
    variantId:
      text(item?.variantId),

    category:
      text(item?.category),

    inventorySource:
      text(
        item?.inventorySource
      ),

    inventoryKey:
      text(
        item?.inventoryKey
      ),

    sku:
      text(item?.sku),

    label:
      text(item?.label),

    detail:
      text(item?.detail),

    openingQty:
      nonNegativeInt(
        item?.openingQty
      )
  };
}

function normalizeClosingItem(
  item
) {
  const closingQty =
    item?.closingQty ===
      null ||
    item?.closingQty ===
      undefined ||
    item?.closingQty ===
      ""
      ? null
      : nonNegativeInt(
          item.closingQty
        );

  return {
    variantId:
      text(item?.variantId),

    closingQty,

    loss:
      nonNegativeInt(
        item?.loss
      ),

    theft:
      nonNegativeInt(
        item?.theft
      ),

    damage:
      nonNegativeInt(
        item?.damage
      ),

    gift:
      nonNegativeInt(
        item?.gift
      ),

    sample:
      nonNegativeInt(
        item?.sample
      ),

    stockAdjustment:
      signedInt(
        item?.stockAdjustment
      )
  };
}

function normalizeSoldByVariant(
  value
) {
  const source =
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
      ? value
      : {};

  const result = {};

  Object.entries(
    source
  ).forEach(
    ([
      variantId,
      quantity
    ]) => {
      const cleanVariantId =
        text(
          variantId
        );

      if (!cleanVariantId) {
        return;
      }

      result[
        cleanVariantId
      ] =
        nonNegativeInt(
          quantity
        );
    }
  );

  return result;
}

function normalizeCount(
  value
) {
  const source =
    value || {};

  return {
    soldByVariant:
      normalizeSoldByVariant(
        source?.soldByVariant
      ),

    opening:
      source?.opening
        ? {
            capturedAt:
              source.opening
                ?.capturedAt ||
              null,

            capturedByEmail:
              text(
                source.opening
                  ?.capturedByEmail
              ),

            items:
              (
                Array.isArray(
                  source.opening
                    ?.items
                )
                  ? source.opening
                      .items
                  : []
              )
                .map(
                  normalizeOpeningItem
                )
                .filter(
                  item =>
                    item.variantId &&
                    item.openingQty >
                      0
                )
          }
        : null,

    closing:
      source?.closing
        ? {
            savedAt:
              source.closing
                ?.savedAt ||
              null,

            savedByEmail:
              text(
                source.closing
                  ?.savedByEmail
              ),

            items:
              (
                Array.isArray(
                  source.closing
                    ?.items
                )
                  ? source.closing
                      .items
                  : []
              )
                .map(
                  normalizeClosingItem
                )
                .filter(
                  item =>
                    item.variantId
                )
          }
        : null
  };
}

async function hasActiveSessionSales(
  db,
  sessionId
) {
  const {
    collection,
    query,
    where,
    getDocsFromServer
  } =
    await firestoreModule();

  const snapshot =
    await getDocsFromServer(
      query(
        collection(
          db,
          "salesTransactions"
        ),
        where(
          "sessionId",
          "==",
          sessionId
        )
      )
    );

  return snapshot.docs.some(
    item =>
      item.data()
        ?.status !==
      "voided"
  );
}


export async function loadEventInventoryCount(
  sessionId
) {
  const cleanSessionId =
    text(sessionId);

  if (!cleanSessionId) {
    return {
      opening: null,
      closing: null,
      soldByVariant: {}
    };
  }

  const db =
    await requireDb();

  const {
    doc,
    getDocFromServer
  } =
    await firestoreModule();

  const ref =
    doc(
      db,
      COLLECTION,
      cleanSessionId
    );

  const snapshot =
    await getDocFromServer(
      ref
    );

  if (!snapshot.exists()) {
    throw new Error(
      "販売セッションが見つかりません。"
    );
  }

  return normalizeCount(
    snapshot.data()
      ?.inventoryCount
  );
}

export async function saveEventOpeningInventory({
  sessionId,
  items,
  capturedByEmail = "",
  overwrite = false
}) {
  const cleanSessionId =
    text(sessionId);

  if (!cleanSessionId) {
    throw new Error(
      "販売セッションが見つかりません。"
    );
  }

  const normalizedItems =
    (
      Array.isArray(items)
        ? items
        : []
    )
      .map(
        normalizeOpeningItem
      )
      .filter(
        item =>
          item.variantId &&
          item.openingQty > 0
      );

  if (!normalizedItems.length) {
    throw new Error(
      "開始在庫として保存できる商品がありません。"
    );
  }

  const db =
    await requireDb();

  const {
    doc,
    getDocFromServer,
    updateDoc,
    serverTimestamp
  } =
    await firestoreModule();

  const ref =
    doc(
      db,
      COLLECTION,
      cleanSessionId
    );

  const snapshot =
    await getDocFromServer(
      ref
    );

  if (!snapshot.exists()) {
    throw new Error(
      "販売セッションが見つかりません。"
    );
  }

  const sessionData =
    snapshot.data() || {};

  if (
    sessionData?.status !==
    "open"
  ) {
    const error =
      new Error(
        "終了済みのイベントでは開始在庫を変更できません。"
      );

    error.code =
      "session-not-open";

    throw error;
  }

  if (
    await hasActiveSessionSales(
      db,
      cleanSessionId
    )
  ) {
    const error =
      new Error(
        "有効な売上があるため開始在庫は変更できません。必要な場合は売上を取消してから編集してください。"
      );

    error.code =
      "opening-inventory-locked-by-sales";

    throw error;
  }

  const current =
    normalizeCount(
      sessionData
        ?.inventoryCount
    );

  if (
    current.opening &&
    !overwrite
  ) {
    throw new Error(
      "開始在庫はすでに保存されています。"
    );
  }

  await updateDoc(
    ref,
    {
      "inventoryCount.opening": {
        capturedAt:
          serverTimestamp(),

        capturedByEmail:
          text(
            capturedByEmail
          ),

        items:
          normalizedItems
      },

      /*
       * Re-taking the opening snapshot invalidates an old closing count.
       */
      "inventoryCount.closing":
        null,

      "inventoryCount.soldByVariant":
        {},

      "inventoryCount.updatedAt":
        serverTimestamp(),

      updatedAt:
        serverTimestamp()
    }
  );

  return {
    itemCount:
      normalizedItems.length,

    totalQty:
      normalizedItems.reduce(
        (sum, item) =>
          sum +
          item.openingQty,
        0
      )
  };
}

export async function saveEventClosingInventory({
  sessionId,
  items,
  savedByEmail = ""
}) {
  const cleanSessionId =
    text(sessionId);

  if (!cleanSessionId) {
    throw new Error(
      "販売セッションが見つかりません。"
    );
  }

  const normalizedItems =
    (
      Array.isArray(items)
        ? items
        : []
    )
      .map(
        normalizeClosingItem
      )
      .filter(
        item =>
          item.variantId
      );

  if (!normalizedItems.length) {
    throw new Error(
      "終了在庫の入力内容がありません。"
    );
  }

  const db =
    await requireDb();

  const {
    doc,
    getDocFromServer,
    updateDoc,
    serverTimestamp
  } =
    await firestoreModule();

  const ref =
    doc(
      db,
      COLLECTION,
      cleanSessionId
    );

  const snapshot =
    await getDocFromServer(
      ref
    );

  if (!snapshot.exists()) {
    throw new Error(
      "販売セッションが見つかりません。"
    );
  }

  const sessionData =
    snapshot.data() || {};

  if (
    sessionData?.status !==
    "open"
  ) {
    const error =
      new Error(
        "終了済みのイベントでは終了在庫を変更できません。"
      );

    error.code =
      "session-not-open";

    throw error;
  }

  const current =
    normalizeCount(
      sessionData
        ?.inventoryCount
    );

  if (!current.opening) {
    throw new Error(
      "先に開始在庫を保存してください。"
    );
  }

  const openingIds =
    new Set(
      current.opening.items.map(
        item =>
          item.variantId
      )
    );

  const safeItems =
    normalizedItems.filter(
      item =>
        openingIds.has(
          item.variantId
        )
    );

  await updateDoc(
    ref,
    {
      "inventoryCount.closing": {
        savedAt:
          serverTimestamp(),

        savedByEmail:
          text(savedByEmail),

        items:
          safeItems
      },

      "inventoryCount.updatedAt":
        serverTimestamp(),

      updatedAt:
        serverTimestamp()
    }
  );

  return {
    itemCount:
      safeItems.length,

    countedCount:
      safeItems.filter(
        item =>
          item.closingQty !==
          null
      ).length
  };
}


export async function resetEventOpeningInventory({
  sessionId,
  resetByEmail = ""
}) {
  const cleanSessionId =
    text(sessionId);

  if (!cleanSessionId) {
    throw new Error(
      "販売セッションが見つかりません。"
    );
  }

  const db =
    await requireDb();

  const {
    doc,
    getDocFromServer,
    updateDoc,
    serverTimestamp
  } =
    await firestoreModule();

  const ref =
    doc(
      db,
      COLLECTION,
      cleanSessionId
    );

  const snapshot =
    await getDocFromServer(
      ref
    );

  if (!snapshot.exists()) {
    throw new Error(
      "販売セッションが見つかりません。"
    );
  }

  const sessionData =
    snapshot.data() || {};

  if (
    sessionData?.status !==
    "open"
  ) {
    const error =
      new Error(
        "終了済みのイベントでは開始在庫をリセットできません。"
      );

    error.code =
      "session-not-open";

    throw error;
  }

  if (
    await hasActiveSessionSales(
      db,
      cleanSessionId
    )
  ) {
    const error =
      new Error(
        "有効な売上があるため開始在庫をリセットできません。必要な場合は売上を取消してから操作してください。"
      );

    error.code =
      "opening-inventory-locked-by-sales";

    throw error;
  }

  await updateDoc(
    ref,
    {
      "inventoryCount.opening":
        null,

      "inventoryCount.closing":
        null,

      "inventoryCount.soldByVariant":
        {},

      "inventoryCount.resetAt":
        serverTimestamp(),

      "inventoryCount.resetByEmail":
        text(
          resetByEmail
        ),

      "inventoryCount.updatedAt":
        serverTimestamp(),

      updatedAt:
        serverTimestamp()
    }
  );

  return {
    sessionId:
      cleanSessionId,

    action:
      "reset"
  };
}
