import { getFirebaseState } from "../firebase.js";

const CATEGORY_IDS = [
  "tshirt",
  "pierce",
  "earring",
  "drop_pierce",
  "drop_earring",
  "sticker",
  "postcard",
  "art_print"
];

const CURRENCIES = [
  "JPY",
  "TWD",
  "HKD",
  "SGD",
  "THB",
  "USD"
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

function cleanPrice(value) {
  const number = Number(value || 0);

  if (!Number.isFinite(number) || number < 0) {
    return 0;
  }

  return number;
}

export async function loadQuickPriceBook() {
  const db = await requireDb();

  const {
    doc,
    getDocFromServer
  } = await firestoreModule();

  const result = {};

  await Promise.all(
    CATEGORY_IDS.map(
      async categoryId => {
        const snapshot =
          await getDocFromServer(
            doc(
              db,
              "products",
              categoryId
            )
          );

        const prices =
          snapshot.exists()
            ? snapshot.data()?.prices || {}
            : {};

        result[categoryId] = {};

        CURRENCIES.forEach(
          currency => {
            result[categoryId][currency] =
              cleanPrice(
                prices?.[currency]
              );
          }
        );
      }
    )
  );

  return result;
}

export async function saveQuickPrices(
  currency,
  prices
) {
  const db = await requireDb();

  if (
    !CURRENCIES.includes(
      currency
    )
  ) {
    throw new Error(
      "Unsupported currency."
    );
  }

  const {
    doc,
    writeBatch,
    serverTimestamp
  } = await firestoreModule();

  const batch =
    writeBatch(db);

  CATEGORY_IDS.forEach(
    categoryId => {
      const value =
        cleanPrice(
          prices?.[categoryId]
        );

      const ref =
        doc(
          db,
          "products",
          categoryId
        );

      batch.set(
        ref,
        {
          category:
            categoryId,

          prices: {
            [currency]:
              value
          },

          updatedAt:
            serverTimestamp()
        },
        {
          merge:
            true
        }
      );
    }
  );

  await batch.commit();

  return {
    currency
  };
}

export const QUICK_PRICE_CURRENCIES =
  [...CURRENCIES];
