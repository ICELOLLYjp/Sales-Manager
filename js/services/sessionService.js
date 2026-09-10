import { getFirebaseState } from "../firebase.js";

const COLLECTION = "salesSessions";

export const SESSION_CURRENCIES = [
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

function cleanText(value) {
  return String(value || "").trim();
}

function cleanRate(value, currency) {
  if (currency === "JPY") {
    return 1;
  }

  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const number = Number(value);

  if (
    !Number.isFinite(number) ||
    number <= 0
  ) {
    return null;
  }

  return number;
}

function normalizeSession(id, data) {
  return {
    id,
    sessionId:
      data?.sessionId || id,
    type:
      data?.type || "event",
    eventName:
      data?.eventName || "",
    country:
      data?.country || "",
    city:
      data?.city || "",
    startDate:
      data?.startDate || "",
    endDate:
      data?.endDate || "",
    currency:
      data?.currency || "JPY",
    baseCurrency:
      data?.baseCurrency || "JPY",
    fxRateToJPY:
      data?.fxRateToJPY ?? null,
    fxRateMode:
      data?.fxRateMode || "manual_event_rate",
    status:
      data?.status || "open",

    salesSummary: {
      grossSales:
        Number(
          data
            ?.salesSummary
            ?.grossSales || 0
        ),

      discount:
        Number(
          data
            ?.salesSummary
            ?.discount || 0
        ),

      netSales:
        Number(
          data
            ?.salesSummary
            ?.netSales || 0
        ),

      transactionCount:
        Number(
          data
            ?.salesSummary
            ?.transactionCount || 0
        ),

      itemCount:
        Number(
          data
            ?.salesSummary
            ?.itemCount || 0
        ),

      grossSalesJPY:
        Number(
          data
            ?.salesSummary
            ?.grossSalesJPY || 0
        ),

      discountJPY:
        Number(
          data
            ?.salesSummary
            ?.discountJPY || 0
        ),

      netSalesJPY:
        Number(
          data
            ?.salesSummary
            ?.netSalesJPY || 0
        )
    },

    createdAt:
      data?.createdAt || null,

    updatedAt:
      data?.updatedAt || null
  };
}

export async function listSalesSessions() {
  const db = await requireDb();

  const {
    collection,
    getDocsFromServer
  } = await firestoreModule();

  const snapshot =
    await getDocsFromServer(
      collection(
        db,
        COLLECTION
      )
    );

  const sessions =
    snapshot.docs.map(
      item =>
        normalizeSession(
          item.id,
          item.data()
        )
    );

  sessions.sort(
    (a, b) => {
      const aDate =
        a.startDate || "";
      const bDate =
        b.startDate || "";

      if (aDate !== bDate) {
        return bDate.localeCompare(
          aDate
        );
      }

      return a.eventName.localeCompare(
        b.eventName,
        "ja"
      );
    }
  );

  return sessions;
}

export async function createEventSession({
  eventName,
  country,
  city = "",
  startDate,
  endDate = "",
  currency = "JPY",
  fxRateToJPY = null
}) {
  const db = await requireDb();

  const name =
    cleanText(
      eventName
    );

  const cleanCountry =
    cleanText(
      country
    );

  const cleanCity =
    cleanText(
      city
    );

  const cleanStart =
    cleanText(
      startDate
    );

  const cleanEnd =
    cleanText(
      endDate
    ) || cleanStart;

  if (!name) {
    throw new Error(
      "イベント名を入力してください。"
    );
  }

  if (!cleanCountry) {
    throw new Error(
      "国を入力してください。"
    );
  }

  if (!cleanStart) {
    throw new Error(
      "開始日を入力してください。"
    );
  }

  if (
    !SESSION_CURRENCIES.includes(
      currency
    )
  ) {
    throw new Error(
      "通貨を確認してください。"
    );
  }

  if (
    cleanEnd &&
    cleanEnd < cleanStart
  ) {
    throw new Error(
      "終了日は開始日以降にしてください。"
    );
  }

  const rate =
    cleanRate(
      fxRateToJPY,
      currency
    );

  const {
    collection,
    doc,
    setDoc,
    serverTimestamp
  } = await firestoreModule();

  const ref =
    doc(
      collection(
        db,
        COLLECTION
      )
    );

  const data = {
    sessionId:
      ref.id,

    type:
      "event",

    eventName:
      name,

    country:
      cleanCountry,

    city:
      cleanCity,

    startDate:
      cleanStart,

    endDate:
      cleanEnd,

    currency,

    baseCurrency:
      "JPY",

    fxRateToJPY:
      rate,

    fxRateMode:
      "manual_event_rate",

    fxRateStatus:
      rate
        ? "set"
        : "pending",

    status:
      "open",

    expenses: {
      boothFee:
        0,
      flight:
        0,
      hotel:
        0,
      shipping:
        0,
      transport:
        0,
      interpreter:
        0,
      other:
        0
    },

    salesSummary: {
      grossSales:
        0,
      discount:
        0,
      netSales:
        0,
      transactionCount:
        0,
      itemCount:
        0
    },

    createdAt:
      serverTimestamp(),

    updatedAt:
      serverTimestamp()
  };

  await setDoc(
    ref,
    data
  );

  return normalizeSession(
    ref.id,
    data
  );
}
