import { getFirebaseState } from "../firebase.js";
import { closeEventWithUnidentified as baseClose } from "./closeWithUnidentifiedService.js?v=20260915-close-unidentified-1";
import { summarizeEventFlow } from "./eventFlowAccountingService.js?v=20260916-flow-accounting-1";

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

async function loadSession(sessionId) {
  const db = await requireDb();
  const { doc, getDocFromServer } = await firestoreModule();
  const sessionRef = doc(db, "salesSessions", sessionId);
  const snapshot = await getDocFromServer(sessionRef);
  if (!snapshot.exists()) throw new Error("販売セッションが見つかりません。");
  return { db, sessionRef, session: snapshot.data() };
}

export async function closeEventWithUnidentified({
  sessionId,
  closedByEmail = ""
}) {
  const cleanSessionId = text(sessionId);
  if (!cleanSessionId) throw new Error("販売セッションが見つかりません。");

  const loaded = await loadSession(cleanSessionId);
  if (loaded.session?.status === "closed") {
    return await baseClose({
      sessionId: cleanSessionId,
      closedByEmail
    });
  }

  const flow = summarizeEventFlow(loaded.session);
  if (!flow.hasFlow) {
    return await baseClose({
      sessionId: cleanSessionId,
      closedByEmail
    });
  }

  const {
    updateDoc,
    serverTimestamp,
    deleteField
  } = await firestoreModule();

  await updateDoc(loaded.sessionRef, {
    "inventoryCount.opening.items": flow.adjustedOpeningItems,
    "inventoryCount.eventFlowCloseRecovery": {
      originalOpeningItems: flow.originalOpeningItems,
      flowEntryCount: flow.flowEntryCount,
      preparedAt: serverTimestamp(),
      preparedByEmail: text(closedByEmail)
    },
    updatedAt: serverTimestamp()
  });

  try {
    const result = await baseClose({
      sessionId: cleanSessionId,
      closedByEmail
    });

    await updateDoc(loaded.sessionRef, {
      "inventoryCount.opening.items": flow.originalOpeningItems,
      "inventoryCount.eventFlowCloseRecovery": deleteField(),
      "inventoryCount.eventFlowReconciliation": {
        version: 1,
        flowEntryCount: flow.flowEntryCount,
        restockTotal: flow.restockTotal,
        openingCorrectionTotal: flow.openingCorrectionTotal,
        flowOnlySkuCount: flow.flowOnlySkuCount,
        openingTotal: flow.openingTotal,
        adjustedOpeningTotal: flow.adjustedOpeningTotal,
        stockMutationApplied: false,
        reconciledAt: serverTimestamp(),
        reconciledByEmail: text(closedByEmail)
      },
      "eventCloseSummary.openingTotal": flow.openingTotal,
      "eventCloseSummary.restockTotal": flow.restockTotal,
      "eventCloseSummary.openingCorrectionTotal": flow.openingCorrectionTotal,
      "eventCloseSummary.flowAdjustedOpeningTotal": flow.adjustedOpeningTotal,
      updatedAt: serverTimestamp()
    });

    return {
      ...result,
      restockTotal: flow.restockTotal,
      openingCorrectionTotal: flow.openingCorrectionTotal,
      flowAdjustedOpeningTotal: flow.adjustedOpeningTotal,
      flowOnlySkuCount: flow.flowOnlySkuCount
    };
  } catch (error) {
    try {
      await updateDoc(loaded.sessionRef, {
        "inventoryCount.opening.items": flow.originalOpeningItems,
        "inventoryCount.eventFlowCloseRecovery": deleteField(),
        updatedAt: serverTimestamp()
      });
    } catch {
      // Recovery marker remains if the restore itself fails.
    }
    throw error;
  }
}
