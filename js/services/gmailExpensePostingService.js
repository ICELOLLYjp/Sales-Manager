import {
  getApp
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";

import {
  getFunctions,
  httpsCallable
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js";

const REGION =
  "asia-southeast1";

function functionsInstance() {
  return getFunctions(
    getApp(),
    REGION
  );
}

async function call(
  name,
  data = {}
) {
  const fn =
    httpsCallable(
      functionsInstance(),
      name
    );

  const result =
    await fn(
      data
    );

  return result.data;
}

export async function listEventGmailExpenses(
  sessionId
) {
  return await call(
    "gmailExpenseListEventEntries",
    {
      sessionId
    }
  );
}

export async function voidEventGmailExpense({
  candidateId,
  expectedCurrentAmount
}) {
  return await call(
    "gmailExpenseVoidReviewedCandidate",
    {
      candidateId,
      expectedCurrentAmount,
      confirmation:
        "void_reviewed_expense"
    }
  );
}
