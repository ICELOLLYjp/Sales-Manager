import { getFirebaseState } from "../firebase.js";

async function firestoreModule() {
  return await import("https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js");
}

async function requireDb() {
  const { db, enabled } = getFirebaseState();
  if (!enabled || !db) throw new Error("Firebase is not connected.");
  return db;
}

function text(value) {
  return String(value ?? "").trim();
}

export async function provisionallyCloseWithoutCount({
  sessionId,
  closedByEmail = ""
}) {
  const cleanSessionId = text(sessionId);
  if (!cleanSessionId) throw new Error("販売セッションが見つかりません。");

  const db = await requireDb();
  const { doc, runTransaction, serverTimestamp } = await firestoreModule();
  const ref = doc(db, "salesSessions", cleanSessionId);

  return await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) throw new Error("販売セッションが見つかりません。");

    const current = snapshot.data();

    if (current?.status === "closed") {
      return {
        sessionId: cleanSessionId,
        status: "closed",
        duplicate: true
      };
    }

    if (current?.status === "pending_allocation") {
      return {
        sessionId: cleanSessionId,
        status: "pending_allocation",
        duplicate: true,
        waitingForInventoryCount: true
      };
    }

    if (current?.status !== "open") {
      throw new Error("このイベントは仮終了できる状態ではありません。");
    }

    transaction.update(ref, {
      status: "pending_allocation",
      provisionalClosedAt: serverTimestamp(),
      provisionalClosedByEmail: text(closedByEmail),
      provisionalCloseMode: "inventory_pending",
      "inventoryCount.provisionalWithoutCount": {
        version: 1,
        status: "pending_count",
        source: "manual_provisional_close",
        savedAt: serverTimestamp(),
        savedByEmail: text(closedByEmail)
      },
      updatedAt: serverTimestamp()
    });

    return {
      sessionId: cleanSessionId,
      status: "pending_allocation",
      duplicate: false,
      waitingForInventoryCount: true
    };
  });
}
