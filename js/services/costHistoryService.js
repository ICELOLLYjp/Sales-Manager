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
    throw new Error("Firebase is not connected.");
  }

  return db;
}

function cleanDate(value) {
  const text = String(value || "").trim();

  return /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? text
    : "";
}

function cleanAmount(value) {
  const number = Number(value);

  if (
    !Number.isFinite(number) ||
    number < 0
  ) {
    return null;
  }

  return number;
}

function timestampMs(value) {
  if (!value) return 0;

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
      return Number(value.seconds) * 1000;
    }
  } catch (error) {
    console.warn(
      "Cost timestamp conversion failed.",
      error
    );
  }

  return 0;
}

function normalizeHistoryRow(
  category,
  id,
  data
) {
  return {
    id,
    category:
      data?.category ||
      category,

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

export async function saveCategoryCost({
  category,
  amountJPY,
  effectiveFrom,
  note = ""
}) {
  const db = await requireDb();

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
    cleanAmount(amountJPY);

  if (amount === null) {
    throw new Error(
      "原価を0以上の数値で入力してください。"
    );
  }

  const date =
    cleanDate(effectiveFrom);

  if (!date) {
    throw new Error(
      "適用開始日を入力してください。"
    );
  }

  const {
    doc,
    getDocFromServer,
    setDoc,
    serverTimestamp
  } = await firestoreModule();

  const ref = doc(
    db,
    "products",
    category,
    "costHistory",
    date
  );

  const existing =
    await getDocFromServer(ref);

  await setDoc(
    ref,
    {
      category,
      amountJPY: amount,
      currency: "JPY",
      effectiveFrom: date,
      note:
        String(
          note || ""
        ).trim(),

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

  return {
    category,
    amountJPY: amount,
    effectiveFrom: date
  };
}

export async function loadCategoryCostHistory(
  category
) {
  const db = await requireDb();

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
          category,
          item.id,
          item.data()
        )
    );

  rows.sort(
    (a, b) => {
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

export function resolveCategoryUnitCost(
  histories,
  category,
  saleDate
) {
  const rows =
    Array.isArray(
      histories?.[category]
    )
      ? histories[category]
      : [];

  const date =
    cleanDate(saleDate) ||
    "9999-12-31";

  const match =
    rows.find(
      row =>
        row.effectiveFrom <=
        date
    );

  if (!match) {
    return null;
  }

  return Number(
    match.amountJPY || 0
  );
}

export function calculateCategoryCogs({
  transactions,
  histories,
  fallbackDate = ""
}) {
  let totalCostJPY = 0;
  let coveredQuantity = 0;
  let missingQuantity = 0;

  const missingCategories =
    new Set();

  (
    Array.isArray(transactions)
      ? transactions
      : []
  ).forEach(
    transaction => {
      const transactionDate =
        transaction?.createdAtMs
          ? new Date(
              transaction.createdAtMs
            )
              .toISOString()
              .slice(0, 10)
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
          const category =
            String(
              item?.category || ""
            );

          const quantity =
            Math.max(
              0,
              Number(
                item?.quantity || 0
              )
            );

          if (
            !category ||
            quantity <= 0
          ) {
            return;
          }

          const unitCost =
            resolveCategoryUnitCost(
              histories,
              category,
              transactionDate
            );

          if (
            unitCost === null
          ) {
            missingQuantity +=
              quantity;

            missingCategories.add(
              category
            );

            return;
          }

          totalCostJPY +=
            unitCost *
            quantity;

          coveredQuantity +=
            quantity;
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
      )
  };
}
