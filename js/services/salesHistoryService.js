import { getFirebaseState } from "../firebase.js";

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

function timestampMs(value) {
  if (!value) {
    return 0;
  }

  try {
    if (typeof value.toMillis === "function") {
      return value.toMillis();
    }

    if (typeof value.toDate === "function") {
      return value.toDate().getTime();
    }

    if (value.seconds) {
      return Number(value.seconds) * 1000;
    }
  } catch (error) {
    console.warn("Timestamp conversion failed.", error);
  }

  return 0;
}

export async function listSessionTransactions(
  sessionId
) {
  const db = await requireDb();

  const cleanSessionId =
    String(sessionId || "").trim();

  if (!cleanSessionId) {
    return [];
  }

  const {
    collection,
    getDocsFromServer,
    query,
    where
  } = await firestoreModule();

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
          cleanSessionId
        )
      )
    );

  const rows =
    snapshot.docs.map(
      item => ({
        id:
          item.id,

        transactionId:
          item.data()
            ?.transactionId ||
          item.id,

        sessionId:
          item.data()
            ?.sessionId ||
          cleanSessionId,

        currency:
          item.data()
            ?.currency ||
          "JPY",

        grossSales:
          Number(
            item.data()
              ?.grossSales || 0
          ),

        discount:
          Number(
            item.data()
              ?.discount || 0
          ),

        netSales:
          Number(
            item.data()
              ?.netSales || 0
          ),

        itemCount:
          Number(
            item.data()
              ?.itemCount || 0
          ),

        items:
          Array.isArray(
            item.data()
              ?.items
          )
            ? item.data().items
            : [],

        mode:
          item.data()
            ?.mode ||
          "quick",

        status:
          item.data()
            ?.status ||
          "completed",

        voidReason:
          item.data()
            ?.voidReason ||
          "",

        voidedByEmail:
          item.data()
            ?.voidedByEmail ||
          "",

        voidedAt:
          item.data()
            ?.voidedAt ||
          null,

        voidedAtMs:
          timestampMs(
            item.data()
              ?.voidedAt
          ),

        createdAt:
          item.data()
            ?.createdAt ||
          null,

        createdAtMs:
          timestampMs(
            item.data()
              ?.createdAt
          )
      })
    );

  rows.sort(
    (a, b) =>
      b.createdAtMs -
      a.createdAtMs
  );

  return rows;
}
