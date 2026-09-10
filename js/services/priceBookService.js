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

const TSHIRT_BODY_IDS = [
  "Vintage",
  "Organic",
  "MIJ"
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

function cleanSetOffers(value) {
  const source =
    Array.isArray(value)
      ? value
      : (
          value &&
          typeof value === "object"
        )
        ? [value]
        : [];

  const seen = new Set();

  return source
    .map(
      offer => ({
        quantity:
          Math.max(
            0,
            Math.floor(
              Number(
                offer?.quantity || 0
              )
            )
          ),

        price:
          cleanPrice(
            offer?.price
          )
      })
    )
    .filter(
      offer =>
        offer.quantity >= 2 &&
        offer.price > 0
    )
    .filter(
      offer => {
        const key =
          `${offer.quantity}|${offer.price}`;

        if (seen.has(key)) {
          return false;
        }

        seen.add(key);
        return true;
      }
    )
    .sort(
      (a, b) =>
        a.quantity -
        b.quantity ||
        a.price -
        b.price
    );
}

function emptyBodyPriceBook() {
  const result = {};

  TSHIRT_BODY_IDS.forEach(
    bodyId => {
      result[bodyId] = {};

      CURRENCIES.forEach(
        currency => {
          result[bodyId][currency] = 0;
        }
      );
    }
  );

  return result;
}

function emptyBodySetOfferBook() {
  const result = {};

  TSHIRT_BODY_IDS.forEach(
    bodyId => {
      result[bodyId] = {};

      CURRENCIES.forEach(
        currency => {
          result[bodyId][currency] = [];
        }
      );
    }
  );

  return result;
}

export async function loadPosPriceConfig() {
  const db = await requireDb();

  const {
    doc,
    getDocFromServer
  } = await firestoreModule();

  const prices = {};
  const setOffers = {};
  const bodyPrices =
    emptyBodyPriceBook();
  const bodySetOffers =
    emptyBodySetOfferBook();

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

        const data =
          snapshot.exists()
            ? snapshot.data()
            : {};

        prices[categoryId] = {};
        setOffers[categoryId] = {};

        CURRENCIES.forEach(
          currency => {
            prices[categoryId][currency] =
              cleanPrice(
                data?.prices?.[
                  currency
                ]
              );

            setOffers[categoryId][currency] =
              cleanSetOffers(
                data?.setOffers?.[
                  currency
                ]
              );

            if (
              categoryId ===
              "tshirt"
            ) {
              TSHIRT_BODY_IDS.forEach(
                bodyId => {
                  bodyPrices[
                    bodyId
                  ][
                    currency
                  ] =
                    cleanPrice(
                      data
                        ?.bodyPrices
                        ?.[currency]
                        ?.[bodyId]
                    );

                  bodySetOffers[
                    bodyId
                  ][
                    currency
                  ] =
                    cleanSetOffers(
                      data
                        ?.bodySetOffers
                        ?.[currency]
                        ?.[bodyId]
                    );
                }
              );
            }
          }
        );
      }
    )
  );

  return {
    prices,
    setOffers,
    bodyPrices,
    bodySetOffers
  };
}

export async function savePosPriceConfig(
  currency,
  prices,
  setOffers,
  bodyPrices = {},
  bodySetOffers = {}
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
      const ref =
        doc(
          db,
          "products",
          categoryId
        );

      const payload = {
        category:
          categoryId,

        prices: {
          [currency]:
            cleanPrice(
              prices?.[
                categoryId
              ]
            )
        },

        setOffers: {
          [currency]:
            cleanSetOffers(
              setOffers?.[
                categoryId
              ]
            )
        },

        updatedAt:
          serverTimestamp()
      };

      if (
        categoryId ===
        "tshirt"
      ) {
        const cleanedBodyPrices = {};
        const cleanedBodySetOffers = {};

        TSHIRT_BODY_IDS.forEach(
          bodyId => {
            cleanedBodyPrices[
              bodyId
            ] =
              cleanPrice(
                bodyPrices?.[
                  bodyId
                ]
              );

            cleanedBodySetOffers[
              bodyId
            ] =
              cleanSetOffers(
                bodySetOffers?.[
                  bodyId
                ]
              );
          }
        );

        payload.bodyPrices = {
          [currency]:
            cleanedBodyPrices
        };

        payload.bodySetOffers = {
          [currency]:
            cleanedBodySetOffers
        };
      }

      batch.set(
        ref,
        payload,
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

export async function loadQuickPriceBook() {
  const config =
    await loadPosPriceConfig();

  return config.prices;
}

export async function saveQuickPrices(
  currency,
  prices
) {
  return await savePosPriceConfig(
    currency,
    prices,
    {},
    {},
    {}
  );
}

export const QUICK_PRICE_CURRENCIES =
  [...CURRENCIES];

export const TSHIRT_PRICE_BODY_IDS =
  [...TSHIRT_BODY_IDS];
