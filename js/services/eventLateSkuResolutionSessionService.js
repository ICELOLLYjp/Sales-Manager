import { getFirebaseState } from "../firebase.js";

async function firestoreModule() {
  return await import("https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js");
}

function text(value) { return String(value ?? "").trim(); }
function nonNegativeInt(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
}

export async function listSessionsNeedingLateSkuResolution() {
  const { db, enabled } = getFirebaseState();
  if (!enabled || !db) return [];
  const { collection, getDocsFromServer } = await firestoreModule();
  const snapshot = await getDocsFromServer(collection(db, "salesSessions"));
  return snapshot.docs
    .map(docSnap => ({ sessionId: docSnap.id, ...docSnap.data() }))
    .map(session => {
      const unregisteredCount = (Array.isArray(session?.inventoryCount?.unregisteredItems)
        ? session.inventoryCount.unregisteredItems
        : []).filter(item =>
          text(item?.tempId) &&
          !text(item?.linkedVariantId) &&
          text(item?.status || "unregistered") !== "linked"
        ).length;
      const quickUnresolved = nonNegativeInt(session?.inventoryCount?.unidentifiedQuick?.unresolvedTotal);
      return {
        sessionId: text(session.sessionId),
        status: text(session.status),
        eventName: text(session.eventName || session.name || session.sessionId),
        unregisteredCount,
        quickUnresolved,
        total: unregisteredCount + quickUnresolved
      };
    })
    .filter(row => row.total > 0)
    .sort((a, b) => b.total - a.total || a.eventName.localeCompare(b.eventName, "ja"));
}
