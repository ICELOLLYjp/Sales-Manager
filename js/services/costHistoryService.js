import { getFirebaseState } from "../firebase.js";

export const COST_CATEGORY_IDS = [
  "tshirt",
  "pierce",
  "earring",
  "drop_pierce",
  "drop_earring",
  "sticker",
  "postcard",
  "art_print"
];

async function firestoreModule() {
  return await import(
    "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js"
  );
}

async function requireDb() {
  const { db, enabled } = getFirebaseState();

  if (!enabled || !db) {
    throw new Error(
      "Firebase is not connected."
    );
  }

  return db;
}

function cleanDate(value) {
  const text =
    String(value || "").trim();

  return /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? text
    : "";
}

function cleanAmount(value) {
  const number =
    Number(value);

  if (
    !Number.isFinite(number) ||
    number < 0
  ) {
    return null;
  }

  return number;
}

function safeId(value) {
  return encodeURIComponent(
    String(value || "").trim()
  );
}

function timestampMs(value) {
  if (!value) {
    return 0;
  }

  try {
    if (
      typeof value.toMillis ===
      "function"
    ) {
      return value.toMillis();
    }

    if (
      typeof value.toDate ===
      "function"
    ) {
      return value.toDate().getTime();
    }

    if (value.seconds) {
      return (
        Number(value.seconds) *
        1000
      );
    }
  } catch (error) {
    console.warn(
      "Cost timestamp conversion failed.",
      error
    );
  }

  return 0;
}

function scheduleRows(
  rows
) {
  return (
    Array.isArray(
      rows
    )
      ? rows
      : []
  )
    .map(
      row => ({
        amountJPY:
          Number(
            row?.amountJPY || 0
          ),

        effectiveFrom:
          cleanDate(
            row?.effectiveFrom
          ),

        note:
          String(
            row?.note || ""
          ).trim()
      })
    )
    .filter(
      row =>
        row.effectiveFrom &&
        Number.isFinite(
          row.amountJPY
        ) &&
        row.amountJPY >=
          0
    )
    .sort(
      (a, b) =>
        b.effectiveFrom
          .localeCompare(
            a.effectiveFrom
          )
    );
}


async function cacheCategorySchedule(
  category
) {
  const db =
    await requireDb();

  const {
    doc,
    setDoc,
    serverTimestamp
  } = await firestoreModule();

  const rows =
    await loadCategoryCostHistory(
      category
    );

  await setDoc(
    doc(
      db,
      "products",
      category
    ),
    {
      costSchedule:
        scheduleRows(
          rows
        ),

      costScheduleUpdatedAt:
        serverTimestamp()
    },
    {
      merge: true
    }
  );
}


async function cacheTshirtBodySchedules() {
  const db =
    await requireDb();

  const {
    doc,
    setDoc,
    serverTimestamp
  } = await firestoreModule();

  const histories =
    await loadTshirtBodyCostHistories();

  const schedules =
    Object.fromEntries(
      Object.entries(
        histories
      ).map(
        ([bodyId, rows]) => [
          bodyId,
          scheduleRows(
            rows
          )
        ]
      )
    );

  await setDoc(
    doc(
      db,
      "products",
      "tshirt"
    ),
    {
      bodyCostSchedules:
        schedules,

      bodyCostSchedulesUpdatedAt:
        serverTimestamp()
    },
    {
      merge: true
    }
  );
}


async function cacheVariantSchedule(
  variantId
) {
  const db =
    await requireDb();

  const {
    doc,
    setDoc,
    serverTimestamp
  } = await firestoreModule();

  const rows =
    await loadVariantCostHistory(
      variantId
    );

  await setDoc(
    doc(
      db,
      "productVariants",
      variantId
    ),
    {
      costSchedule:
        scheduleRows(
          rows
        ),

      costScheduleUpdatedAt:
        serverTimestamp()
    },
    {
      merge: true
    }
  );
}


function normalizeHistoryRow(
  scope,
  key,
  id,
  data
) {
  return {
    id,

    scope,

    key,

    category:
      data?.category || "",

    bodyId:
      data?.bodyId || "",

    variantId:
      data?.variantId || "",

    costType:
      data?.costType || "",

    bulkScope:
      data?.bulkScope || "",

    bulkBodyId:
      data?.bulkBodyId || "",

    bulkDesignId:
      data?.bulkDesignId || "",

    amountJPY:
      Number(
        data?.amountJPY || 0
      ),

    effectiveFrom:
      data?.effectiveFrom ||
      id,

    note:
      data?.note || "",

    createdAt:
      data?.createdAt || null,

    updatedAt:
      data?.updatedAt || null,

    updatedAtMs:
      timestampMs(
        data?.updatedAt
      )
  };
}

async function saveHistoryDoc({
  ref,
  data
}) {
  const {
    getDocFromServer,
    setDoc,
    serverTimestamp
  } = await firestoreModule();

  const existing =
    await getDocFromServer(
      ref
    );

  await setDoc(
    ref,
    {
      ...data,

      createdAt:
        existing.exists()
          ? (
              existing.data()
                ?.createdAt ||
              serverTimestamp()
            )
          : serverTimestamp(),

      updatedAt:
        serverTimestamp()
    },
    {
      merge: true
    }
  );
}

export async function saveCategoryCost({
  category,
  amountJPY,
  effectiveFrom,
  note = ""
}) {
  const db =
    await requireDb();

  if (
    !COST_CATEGORY_IDS.includes(
      category
    )
  ) {
    throw new Error(
      "商品カテゴリを確認してください。"
    );
  }

  const amount =
    cleanAmount(
      amountJPY
    );

  if (amount === null) {
    throw new Error(
      "原価を0以上の数値で入力してください。"
    );
  }

  const date =
    cleanDate(
      effectiveFrom
    );

  if (!date) {
    throw new Error(
      "適用開始日を入力してください。"
    );
  }

  const {
    doc
  } = await firestoreModule();

  const ref =
    doc(
      db,
      "products",
      category,
      "costHistory",
      date
    );

  await saveHistoryDoc({
    ref,
    data: {
      scope:
        "category",

      category,

      amountJPY:
        amount,

      currency:
        "JPY",

      effectiveFrom:
        date,

      note:
        String(
          note || ""
        ).trim()
    }
  });

  await cacheCategorySchedule(
    category
  );

  return {
    category,
    amountJPY:
      amount,
    effectiveFrom:
      date
  };
}

export async function loadCategoryCostHistory(
  category
) {
  const db =
    await requireDb();

  const {
    collection,
    getDocsFromServer
  } = await firestoreModule();

  const snapshot =
    await getDocsFromServer(
      collection(
        db,
        "products",
        category,
        "costHistory"
      )
    );

  const rows =
    snapshot.docs.map(
      item =>
        normalizeHistoryRow(
          "category",
          category,
          item.id,
          item.data()
        )
    );

  rows.sort(
    (
      a,
      b
    ) => {
      if (
        a.effectiveFrom !==
        b.effectiveFrom
      ) {
        return (
          b.effectiveFrom
            .localeCompare(
              a.effectiveFrom
            )
        );
      }

      return (
        b.updatedAtMs -
        a.updatedAtMs
      );
    }
  );

  return rows;
}

export async function loadAllCategoryCostHistories() {
  const entries =
    await Promise.all(
      COST_CATEGORY_IDS.map(
        async category => [
          category,
          await loadCategoryCostHistory(
            category
          )
        ]
      )
    );

  return Object.fromEntries(
    entries
  );
}

export async function saveTshirtBodyCost({
  bodyId,
  amountJPY,
  effectiveFrom,
  note = ""
}) {
  const db =
    await requireDb();

  const cleanBodyId =
    String(
      bodyId || ""
    ).trim();

  if (!cleanBodyId) {
    throw new Error(
      "TシャツBodyを選択してください。"
    );
  }

  const amount =
    cleanAmount(
      amountJPY
    );

  if (amount === null) {
    throw new Error(
      "原価を0以上の数値で入力してください。"
    );
  }

  const date =
    cleanDate(
      effectiveFrom
    );

  if (!date) {
    throw new Error(
      "適用開始日を入力してください。"
    );
  }

  const {
    doc
  } = await firestoreModule();

  const id =
    `${safeId(
      cleanBodyId
    )}__${date}`;

  const ref =
    doc(
      db,
      "products",
      "tshirt",
      "bodyCostHistory",
      id
    );

  await saveHistoryDoc({
    ref,
    data: {
      scope:
        "body",

      category:
        "tshirt",

      bodyId:
        cleanBodyId,

      amountJPY:
        amount,

      currency:
        "JPY",

      effectiveFrom:
        date,

      note:
        String(
          note || ""
        ).trim()
    }
  });

  await cacheTshirtBodySchedules();

  return {
    bodyId:
      cleanBodyId,
    amountJPY:
      amount,
    effectiveFrom:
      date
  };
}

export async function loadTshirtCostCache() {
  const db =
    await requireDb();

  const {
    doc,
    getDocFromServer
  } = await firestoreModule();

  const snapshot =
    await getDocFromServer(
      doc(
        db,
        "products",
        "tshirt"
      )
    );

  if (!snapshot.exists()) {
    return {
      bodyCostSchedules:
        {}
    };
  }

  const data =
    snapshot.data() || {};

  return {
    bodyCostSchedules:
      data.bodyCostSchedules &&
      typeof data.bodyCostSchedules ===
        "object"
        ? data.bodyCostSchedules
        : {},

    bodyCostSchedulesUpdatedAt:
      data.bodyCostSchedulesUpdatedAt ||
      null
  };
}


export async function loadTshirtBodyCostHistories() {
  const db =
    await requireDb();

  const {
    collection,
    getDocsFromServer
  } = await firestoreModule();

  const snapshot =
    await getDocsFromServer(
      collection(
        db,
        "products",
        "tshirt",
        "bodyCostHistory"
      )
    );

  const result = {};

  snapshot.docs.forEach(
    item => {
      const data =
        item.data();

      const bodyId =
        String(
          data?.bodyId || ""
        );

      if (!bodyId) {
        return;
      }

      if (!result[bodyId]) {
        result[bodyId] = [];
      }

      result[bodyId].push(
        normalizeHistoryRow(
          "body",
          bodyId,
          item.id,
          data
        )
      );
    }
  );

  Object.values(
    result
  ).forEach(
    rows => {
      rows.sort(
        (
          a,
          b
        ) => {
          if (
            a.effectiveFrom !==
            b.effectiveFrom
          ) {
            return (
              b.effectiveFrom
                .localeCompare(
                  a.effectiveFrom
                )
            );
          }

          return (
            b.updatedAtMs -
            a.updatedAtMs
          );
        }
      );
    }
  );

  return result;
}

export async function saveVariantCost({
  variantId,
  amountJPY,
  effectiveFrom,
  note = ""
}) {
  const db =
    await requireDb();

  const cleanVariantId =
    String(
      variantId || ""
    ).trim();

  if (!cleanVariantId) {
    throw new Error(
      "SKUを選択してください。"
    );
  }

  const amount =
    cleanAmount(
      amountJPY
    );

  if (amount === null) {
    throw new Error(
      "原価を0以上の数値で入力してください。"
    );
  }

  const date =
    cleanDate(
      effectiveFrom
    );

  if (!date) {
    throw new Error(
      "適用開始日を入力してください。"
    );
  }

  const {
    doc,
    setDoc,
    serverTimestamp
  } = await firestoreModule();

  const historyRef =
    doc(
      db,
      "productVariants",
      cleanVariantId,
      "costHistory",
      date
    );

  await saveHistoryDoc({
    ref:
      historyRef,

    data: {
      scope:
        "sku",

      variantId:
        cleanVariantId,

      amountJPY:
        amount,

      currency:
        "JPY",

      effectiveFrom:
        date,

      note:
        String(
          note || ""
        ).trim()
    }
  });

  await setDoc(
    doc(
      db,
      "productVariants",
      cleanVariantId
    ),
    {
      latestCostJPY:
        amount,

      latestCostEffectiveFrom:
        date,

      updatedAt:
        serverTimestamp()
    },
    {
      merge: true
    }
  );

  await cacheVariantSchedule(
    cleanVariantId
  );

  return {
    variantId:
      cleanVariantId,
    amountJPY:
      amount,
    effectiveFrom:
      date
  };
}

export async function loadVariantCostHistory(
  variantId
) {
  const db =
    await requireDb();

  const cleanVariantId =
    String(
      variantId || ""
    ).trim();

  if (!cleanVariantId) {
    return [];
  }

  const {
    collection,
    getDocsFromServer
  } = await firestoreModule();

  const snapshot =
    await getDocsFromServer(
      collection(
        db,
        "productVariants",
        cleanVariantId,
        "costHistory"
      )
    );

  const rows =
    snapshot.docs.map(
      item =>
        normalizeHistoryRow(
          "sku",
          cleanVariantId,
          item.id,
          item.data()
        )
    );

  rows.sort(
    (
      a,
      b
    ) => {
      if (
        a.effectiveFrom !==
        b.effectiveFrom
      ) {
        return (
          b.effectiveFrom
            .localeCompare(
              a.effectiveFrom
            )
        );
      }

      return (
        b.updatedAtMs -
        a.updatedAtMs
      );
    }
  );

  return rows;
}

export async function loadVariantCostHistories(
  variantIds
) {
  const unique =
    Array.from(
      new Set(
        (
          Array.isArray(
            variantIds
          )
            ? variantIds
            : []
        )
          .map(
            value =>
              String(
                value || ""
              ).trim()
          )
          .filter(Boolean)
      )
    );

  const entries =
    await Promise.all(
      unique.map(
        async variantId => [
          variantId,
          await loadVariantCostHistory(
            variantId
          )
        ]
      )
    );

  return Object.fromEntries(
    entries
  );
}

function resolveHistoryRows(
  rows,
  saleDate
) {
  const date =
    cleanDate(
      saleDate
    ) ||
    "9999-12-31";

  const match =
    (
      Array.isArray(
        rows
      )
        ? rows
        : []
    ).find(
      row =>
        row.effectiveFrom <=
        date
    );

  return match
    ? Number(
        match.amountJPY || 0
      )
    : null;
}

function resolveHistoryRowsByCostType(
  rows,
  costType,
  saleDate
) {
  const date =
    cleanDate(
      saleDate
    ) ||
    "9999-12-31";

  const match =
    (
      Array.isArray(
        rows
      )
        ? rows
        : []
    ).find(
      row =>
        row.costType ===
          costType &&
        row.effectiveFrom <=
          date
    );

  return match
    ? Number(
        match.amountJPY || 0
      )
    : null;
}


export function resolveCategoryUnitCost(
  histories,
  category,
  saleDate
) {
  return resolveHistoryRows(
    histories?.[category],
    saleDate
  );
}

export function resolveBodyUnitCost(
  histories,
  bodyId,
  saleDate
) {
  if (!bodyId) {
    return null;
  }

  return resolveHistoryRows(
    histories?.[bodyId],
    saleDate
  );
}

export function resolveVariantUnitCost(
  histories,
  variantId,
  saleDate
) {
  if (!variantId) {
    return null;
  }

  return resolveHistoryRows(
    histories?.[variantId],
    saleDate
  );
}

export function resolveSaleItemUnitCost({
  item,
  saleDate,
  categoryHistories,
  bodyHistories,
  variantHistories,
  variantsById
}) {
  const variantId =
    String(
      item?.variantId || ""
    ).trim();

  const variant =
    variantId
      ? variantsById
          ?.get(
            variantId
          )
      : null;

  const isTshirt =
    item?.category ===
    "tshirt";

  if (
    isTshirt
  ) {
    const rows =
      variantId
        ? (
            variantHistories
              ?.[variantId] ||
            []
          )
        : [];

    const skuOverrideCost =
      resolveHistoryRowsByCostType(
        rows,
        "sku_override",
        saleDate
      );

    if (
      skuOverrideCost !==
      null
    ) {
      return {
        unitCostJPY:
          skuOverrideCost,
        source:
          "sku_override"
      };
    }

    const outsourcedCost =
      resolveHistoryRowsByCostType(
        rows,
        "outsourced_all_in",
        saleDate
      );

    if (
      outsourcedCost !==
      null
    ) {
      return {
        unitCostJPY:
          outsourcedCost,
        source:
          "outsourced_all_in"
      };
    }

    const bodyId =
      String(
        item?.bodyId ||
        variant?.bodyId ||
        ""
      ).trim();

    if (
      bodyId
    ) {
      const bodyCost =
        resolveBodyUnitCost(
          bodyHistories,
          bodyId,
          saleDate
        );

      if (
        bodyCost !==
        null
      ) {
        return {
          unitCostJPY:
            bodyCost,
          source:
            "body"
        };
      }
    }

    /*
     * For T-shirts, do not fall back to the old generic
     * costSchedule/latestCost or category standard cost.
     * If none of the three official sources exists, mark missing.
     */
    return {
      unitCostJPY:
        null,
      source:
        "missing"
    };
  }

  /*
   * Existing non-T-shirt behavior is preserved.
   */
  if (variantId) {
    const variantCost =
      resolveVariantUnitCost(
        variantHistories,
        variantId,
        saleDate
      );

    if (
      variantCost !==
      null
    ) {
      return {
        unitCostJPY:
          variantCost,
        source:
          "sku"
      };
    }
  }

  const categoryCost =
    resolveCategoryUnitCost(
      categoryHistories,
      item?.category,
      saleDate
    );

  if (
    categoryCost !==
    null
  ) {
    return {
      unitCostJPY:
        categoryCost,
      source:
        "category"
    };
  }

  return {
    unitCostJPY:
      null,
    source:
      "missing"
  };
}

export function calculateResolvedCogs({
  transactions,
  categoryHistories,
  bodyHistories,
  variantHistories,
  variantsById,
  fallbackDate = ""
}) {
  let totalCostJPY = 0;
  let coveredQuantity = 0;
  let missingQuantity = 0;

  const missingCategories =
    new Set();

  const sourceCounts = {
    sku_override:
      0,
    outsourced_all_in:
      0,
    sku:
      0,
    body:
      0,
    category:
      0
  };

  (
    Array.isArray(
      transactions
    )
      ? transactions
      : []
  ).forEach(
    transaction => {
      const saleDate =
        transaction?.createdAtMs
          ? new Date(
              transaction.createdAtMs
            )
              .toISOString()
              .slice(
                0,
                10
              )
          : (
              cleanDate(
                fallbackDate
              ) ||
              "9999-12-31"
            );

      (
        Array.isArray(
          transaction?.items
        )
          ? transaction.items
          : []
      ).forEach(
        item => {
          const quantity =
            Math.max(
              0,
              Number(
                item?.quantity || 0
              )
            );

          if (
            quantity <= 0
          ) {
            return;
          }

          const saleCostSnapshot =
            item?.costSnapshot;

          const hasSaleSnapshot =
            saleCostSnapshot
              ?.captured ===
              true ||
            item?.costSnapshotCaptured ===
              true;

          const snapshotUnitCost =
            saleCostSnapshot
              ?.unitCostJPY ??
            item?.unitCostJPY;

          const snapshotSource =
            String(
              saleCostSnapshot
                ?.source ||
              item?.costSource ||
              "missing"
            );

          const snapshotCostValid =
            snapshotUnitCost !==
              null &&
            snapshotUnitCost !==
              undefined &&
            Number.isFinite(
              Number(
                snapshotUnitCost
              )
            ) &&
            Number(
              snapshotUnitCost
            ) >=
              0;

          const resolved =
            hasSaleSnapshot
              ? {
                  unitCostJPY:
                    snapshotCostValid
                      ? Number(
                          snapshotUnitCost
                        )
                      : null,

                  source:
                    snapshotSource
                }
              : resolveSaleItemUnitCost({
                  item,
                  saleDate,
                  categoryHistories,
                  bodyHistories,
                  variantHistories,
                  variantsById
                });

          if (
            resolved.unitCostJPY ===
            null
          ) {
            missingQuantity +=
              quantity;

            missingCategories.add(
              String(
                item?.category ||
                "other"
              )
            );

            return;
          }

          totalCostJPY +=
            resolved.unitCostJPY *
            quantity;

          coveredQuantity +=
            quantity;

          if (
            sourceCounts[
              resolved.source
            ] !==
            undefined
          ) {
            sourceCounts[
              resolved.source
            ] +=
              quantity;
          }
        }
      );
    }
  );

  return {
    totalCostJPY,
    coveredQuantity,
    missingQuantity,
    missingCategories:
      Array.from(
        missingCategories
      ),
    sourceCounts
  };
}
