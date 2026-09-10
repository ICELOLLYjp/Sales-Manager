import { getFirebaseState } from "../firebase.js";

const COLLECTION =
  "salesSessions";

const EXPENSE_KEYS = [
  "boothFee",
  "flight",
  "hotel",
  "shipping",
  "transport",
  "interpreter",
  "other"
];

async function firestoreModule() {
  return await import(
    "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js"
  );
}

async function requireDb() {
  const {
    db,
    enabled
  } =
    getFirebaseState();

  if (
    !enabled ||
    !db
  ) {
    throw new Error(
      "Firebase is not connected."
    );
  }

  return db;
}

function cleanText(
  value
) {
  return String(
    value ||
    ""
  ).trim();
}

function rawExpenseAmount(
  value
) {
  if (
    value !== null &&
    typeof value ===
      "object" &&
    !Array.isArray(
      value
    )
  ) {
    return Math.max(
      Number(
        value.amount ||
        0
      ),
      Number(
        value.amountJPY ||
        0
      )
    );
  }

  return Number(
    value ||
    0
  );
}

function hasMeaningfulExpenses(
  data
) {
  return EXPENSE_KEYS.some(
    key =>
      rawExpenseAmount(
        data?.expenses?.[
          key
        ]
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
          summary?.[
            key
          ] ||
          0
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
    getDocs
  } =
    await firestoreModule();

  const snapshot =
    await getDocs(
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
    getDoc
  } =
    await firestoreModule();

  const ref =
    doc(
      db,
      COLLECTION,
      cleanSessionId
    );

  const snapshot =
    await getDoc(
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

    reasons
  };
}

export async function deleteEventSession(
  sessionId
) {
  const inspection =
    await inspectEventSessionRemoval(
      sessionId
    );

  if (
    !inspection.canDelete
  ) {
    const error =
      new Error(
        "このイベントには売上・在庫・経費などの記録があるため、完全削除できません。アーカイブしてください。"
      );

    error.code =
      "SESSION_NOT_DELETABLE";

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

  const {
    doc,
    getDoc,
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
    await getDoc(
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

  const {
    doc,
    getDoc,
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
    await getDoc(
      ref
    );

  if (!snapshot.exists()) {
    throw new Error(
      "販売セッションが見つかりません。"
    );
  }

  const current =
    snapshot.data();

  const nextStatus =
    current?.previousStatus ===
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
