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


const EXPENSE_KEYS = [
  "boothFee",
  "flight",
  "hotel",
  "shipping",
  "transport",
  "interpreter",
  "other"
];

function normalizeExpenseEntry(
  value,
  defaultCurrency = "JPY",
  sessionCurrency = "JPY",
  sessionRate = null
) {
  if (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  ) {
    const amount =
      Math.max(
        0,
        Number(
          value.amount || 0
        )
      );

    const currency =
      value.currency ||
      defaultCurrency ||
      "JPY";

    let fxRateToJPY =
      value.fxRateToJPY ??
      null;

    if (currency === "JPY") {
      fxRateToJPY = 1;
    } else if (
      currency ===
      sessionCurrency &&
      Number(
        sessionRate || 0
      ) > 0
    ) {
      fxRateToJPY =
        Number(
          sessionRate
        );
    }

    const amountJPY =
      Number(
        value.amountJPY || 0
      ) > 0
        ? Number(
            value.amountJPY
          )
        : (
            Number(
              fxRateToJPY || 0
            ) > 0
              ? amount *
                Number(
                  fxRateToJPY
                )
              : 0
          );

    return {
      amount,
      currency,
      fxRateToJPY:
        Number(
          fxRateToJPY || 0
        ) > 0
          ? Number(
              fxRateToJPY
            )
          : null,
      amountJPY
    };
  }

  const amount =
    Math.max(
      0,
      Number(
        value || 0
      )
    );

  return {
    amount,
    currency:
      "JPY",
    fxRateToJPY:
      1,
    amountJPY:
      amount
  };
}

function normalizeExpenses(
  expenses,
  sessionCurrency,
  sessionRate
) {
  const source =
    expenses || {};

  const result = {};

  EXPENSE_KEYS.forEach(
    key => {
      result[key] =
        normalizeExpenseEntry(
          source?.[key],
          "JPY",
          sessionCurrency,
          sessionRate
        );
    }
  );

  return result;
}

function expenseSummary(
  expenses
) {
  const totalJPY =
    EXPENSE_KEYS.reduce(
      (sum, key) =>
        sum +
        Number(
          expenses
            ?.[key]
            ?.amountJPY || 0
        ),
      0
    );

  return {
    totalJPY
  };
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

    previousStatus:
      data?.previousStatus || "",

    archivedAt:
      data?.archivedAt || null,

    archivedByEmail:
      data?.archivedByEmail || "",

    expenses:
      normalizeExpenses(
        data?.expenses,
        data?.currency || "JPY",
        data?.fxRateToJPY ?? null
      ),

    expenseSummary:
      expenseSummary(
        normalizeExpenses(
          data?.expenses,
          data?.currency || "JPY",
          data?.fxRateToJPY ?? null
        )
      ),

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
      boothFee: {
        amount: 0,
        currency: "JPY",
        fxRateToJPY: 1,
        amountJPY: 0
      },
      flight: {
        amount: 0,
        currency: "JPY",
        fxRateToJPY: 1,
        amountJPY: 0
      },
      hotel: {
        amount: 0,
        currency: "JPY",
        fxRateToJPY: 1,
        amountJPY: 0
      },
      shipping: {
        amount: 0,
        currency: "JPY",
        fxRateToJPY: 1,
        amountJPY: 0
      },
      transport: {
        amount: 0,
        currency: "JPY",
        fxRateToJPY: 1,
        amountJPY: 0
      },
      interpreter: {
        amount: 0,
        currency: "JPY",
        fxRateToJPY: 1,
        amountJPY: 0
      },
      other: {
        amount: 0,
        currency: "JPY",
        fxRateToJPY: 1,
        amountJPY: 0
      }
    },

    expenseSummary: {
      totalJPY: 0
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


export async function updateEventSession(
  sessionId,
  {
    eventName,
    country,
    city = "",
    startDate,
    endDate = "",
    currency = "JPY",
    fxRateToJPY = null
  }
) {
  const db = await requireDb();

  const cleanSessionId =
    cleanText(sessionId);

  const name =
    cleanText(eventName);

  const cleanCountry =
    cleanText(country);

  const cleanCity =
    cleanText(city);

  const cleanStart =
    cleanText(startDate);

  const cleanEnd =
    cleanText(endDate) ||
    cleanStart;

  if (!cleanSessionId) {
    throw new Error(
      "販売セッションが見つかりません。"
    );
  }

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
    doc,
    getDocFromServer,
    updateDoc,
    serverTimestamp
  } = await firestoreModule();

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

  const current =
    snapshot.data();

  await updateDoc(
    ref,
    {
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

      updatedAt:
        serverTimestamp()
    }
  );

  return normalizeSession(
    cleanSessionId,
    {
      ...current,
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
          : "pending"
    }
  );
}


export async function updateEventExpenses(
  sessionId,
  expenseInput
) {
  const db = await requireDb();

  const cleanSessionId =
    cleanText(
      sessionId
    );

  if (!cleanSessionId) {
    throw new Error(
      "販売セッションが見つかりません。"
    );
  }

  const {
    doc,
    getDocFromServer,
    updateDoc,
    serverTimestamp
  } = await firestoreModule();

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

  const current =
    snapshot.data();

  const sessionCurrency =
    current?.currency || "JPY";

  const sessionRate =
    current?.fxRateToJPY ?? null;

  const next = {};

  EXPENSE_KEYS.forEach(
    key => {
      const item =
        expenseInput?.[key] || {};

      const amount =
        Math.max(
          0,
          Number(
            item.amount || 0
          )
        );

      const currency =
        item.currency ===
        sessionCurrency &&
        sessionCurrency !==
        "JPY"
          ? sessionCurrency
          : "JPY";

      let fxRateToJPY =
        currency === "JPY"
          ? 1
          : (
              Number(
                sessionRate || 0
              ) > 0
                ? Number(
                    sessionRate
                  )
                : null
            );

      if (
        currency !== "JPY" &&
        !fxRateToJPY &&
        amount > 0
      ) {
        throw new Error(
          "現地通貨の経費を登録するには、イベントの為替レートを設定してください。"
        );
      }

      next[key] = {
        amount,
        currency,
        fxRateToJPY,
        amountJPY:
          amount *
          Number(
            fxRateToJPY || 0
          )
      };
    }
  );

  const summary =
    expenseSummary(
      next
    );

  await updateDoc(
    ref,
    {
      expenses:
        next,

      expenseSummary:
        summary,

      updatedAt:
        serverTimestamp()
    }
  );

  return {
    expenses:
      next,
    expenseSummary:
      summary
  };
}


function rawExpenseAmount(
  value
) {
  if (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  ) {
    return Math.max(
      Number(
        value.amount || 0
      ),
      Number(
        value.amountJPY || 0
      )
    );
  }

  return Number(
    value || 0
  );
}

function hasMeaningfulExpenses(
  data
) {
  return EXPENSE_KEYS.some(
    key =>
      rawExpenseAmount(
        data?.expenses?.[key]
      ) > 0
  );
}

function hasMeaningfulSalesSummary(
  data
) {
  const summary =
    data?.salesSummary ||
    {};

  return [
    "grossSales",
    "discount",
    "netSales",
    "transactionCount",
    "itemCount",
    "grossSalesJPY",
    "discountJPY",
    "netSalesJPY"
  ].some(
    key =>
      Math.abs(
        Number(
          summary?.[key] || 0
        )
      ) > 0
  );
}

function hasInventoryCountData(
  data
) {
  const count =
    data?.inventoryCount;

  if (!count) {
    return false;
  }

  const openingItems =
    Array.isArray(
      count?.opening?.items
    )
      ? count.opening.items
      : [];

  const closingItems =
    Array.isArray(
      count?.closing?.items
    )
      ? count.closing.items
      : [];

  return Boolean(
    count?.opening?.capturedAt ||
    count?.closing?.savedAt ||
    openingItems.length ||
    closingItems.length
  );
}

async function hasLinkedSessionDocument(
  db,
  collectionName,
  sessionId
) {
  const {
    collection,
    query,
    where,
    limit,
    getDocsFromServer
  } =
    await firestoreModule();

  const snapshot =
    await getDocsFromServer(
      query(
        collection(
          db,
          collectionName
        ),
        where(
          "sessionId",
          "==",
          sessionId
        ),
        limit(1)
      )
    );

  return !snapshot.empty;
}

export async function inspectEventSessionRemoval(
  sessionId
) {
  const db =
    await requireDb();

  const cleanSessionId =
    cleanText(
      sessionId
    );

  if (!cleanSessionId) {
    throw new Error(
      "販売セッションが見つかりません。"
    );
  }

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

  const data =
    snapshot.data();

  const [
    hasTransactions,
    hasInventoryMovements,
    hasTransactionLocks
  ] =
    await Promise.all([
      hasLinkedSessionDocument(
        db,
        "salesTransactions",
        cleanSessionId
      ),

      hasLinkedSessionDocument(
        db,
        "inventoryMovements",
        cleanSessionId
      ),

      hasLinkedSessionDocument(
        db,
        "transactionLocks",
        cleanSessionId
      )
    ]);

  const hasInventoryCount =
    hasInventoryCountData(
      data
    );

  const hasExpenses =
    hasMeaningfulExpenses(
      data
    );

  const hasSalesSummary =
    hasMeaningfulSalesSummary(
      data
    );

  const reasons = [];

  if (hasTransactions) {
    reasons.push(
      "sales"
    );
  }

  if (hasInventoryMovements) {
    reasons.push(
      "inventory_movements"
    );
  }

  if (hasTransactionLocks) {
    reasons.push(
      "transaction_locks"
    );
  }

  if (hasInventoryCount) {
    reasons.push(
      "inventory_count"
    );
  }

  if (hasExpenses) {
    reasons.push(
      "expenses"
    );
  }

  if (hasSalesSummary) {
    reasons.push(
      "sales_summary"
    );
  }

  return {
    sessionId:
      cleanSessionId,

    eventName:
      data?.eventName ||
      "",

    status:
      data?.status ||
      "open",

    canDelete:
      reasons.length ===
      0,

    reasons,

    hasTransactions,
    hasInventoryMovements,
    hasTransactionLocks,
    hasInventoryCount,
    hasExpenses,
    hasSalesSummary
  };
}

export async function deleteEventSession(
  sessionId
) {
  const inspection =
    await inspectEventSessionRemoval(
      sessionId
    );

  if (!inspection.canDelete) {
    const error =
      new Error(
        "このイベントには売上・在庫・経費などの記録があるため、完全削除できません。アーカイブしてください。"
      );

    error.code =
      "SESSION_NOT_DELETABLE";

    error.inspection =
      inspection;

    throw error;
  }

  const db =
    await requireDb();

  const {
    doc,
    deleteDoc
  } =
    await firestoreModule();

  await deleteDoc(
    doc(
      db,
      COLLECTION,
      inspection.sessionId
    )
  );

  return {
    sessionId:
      inspection.sessionId,

    action:
      "deleted"
  };
}

export async function archiveEventSession(
  sessionId,
  {
    archivedByEmail = ""
  } = {}
) {
  const db =
    await requireDb();

  const cleanSessionId =
    cleanText(
      sessionId
    );

  if (!cleanSessionId) {
    throw new Error(
      "販売セッションが見つかりません。"
    );
  }

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

  const current =
    snapshot.data();

  if (
    current?.status ===
    "archived"
  ) {
    return {
      sessionId:
        cleanSessionId,

      action:
        "already_archived"
    };
  }

  await updateDoc(
    ref,
    {
      previousStatus:
        current?.status ||
        "open",

      status:
        "archived",

      archivedAt:
        serverTimestamp(),

      archivedByEmail:
        cleanText(
          archivedByEmail
        ),

      updatedAt:
        serverTimestamp()
    }
  );

  return {
    sessionId:
      cleanSessionId,

    action:
      "archived"
  };
}

export async function restoreArchivedEventSession(
  sessionId
) {
  const db =
    await requireDb();

  const cleanSessionId =
    cleanText(
      sessionId
    );

  if (!cleanSessionId) {
    throw new Error(
      "販売セッションが見つかりません。"
    );
  }

  const {
    doc,
    getDocFromServer,
    updateDoc,
    serverTimestamp,
    deleteField
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

  const current =
    snapshot.data();

  const previousStatus =
    current?.previousStatus;

  const nextStatus =
    previousStatus ===
      "closed"
      ? "closed"
      : "open";

  await updateDoc(
    ref,
    {
      status:
        nextStatus,

      previousStatus:
        deleteField(),

      archivedAt:
        deleteField(),

      archivedByEmail:
        deleteField(),

      restoredAt:
        serverTimestamp(),

      updatedAt:
        serverTimestamp()
    }
  );

  return {
    sessionId:
      cleanSessionId,

    action:
      "restored",

    status:
      nextStatus
  };
}
