import {
  listSalesSessions as listSalesSessionsFromServer,
  createEventSession as createEventSessionCore,
  updateEventSession as updateEventSessionCore,
  updateEventExpenses as updateEventExpensesCore,
  deleteEventSession as deleteEventSessionCore,
  archiveEventSession as archiveEventSessionCore,
  restoreArchivedEventSession as restoreArchivedEventSessionCore
} from "./sessionServiceCore.js";

export * from "./sessionServiceCore.js";

const SESSION_CACHE_TTL_MS =
  60 * 1000;

let sessionCache =
  null;

let sessionCacheSavedAt =
  0;

let sessionRequest =
  null;

function cloneSessions(
  sessions
) {
  return (
    Array.isArray(
      sessions
    )
      ? sessions
      : []
  ).map(
    session => ({
      ...session,
      expenses:
        session?.expenses
          ? { ...session.expenses }
          : session?.expenses,
      expenseSummary:
        session?.expenseSummary
          ? { ...session.expenseSummary }
          : session?.expenseSummary,
      salesSummary:
        session?.salesSummary
          ? { ...session.salesSummary }
          : session?.salesSummary
    })
  );
}

function posScreenActive() {
  if (
    typeof document ===
    "undefined"
  ) {
    return false;
  }

  return Boolean(
    document
      .querySelector(
        '.nav-btn[data-route="pos"]'
      )
      ?.classList
      .contains(
        "active"
      )
  );
}

function invalidateSessionCache() {
  sessionCache =
    null;

  sessionCacheSavedAt =
    0;
}

export async function listSalesSessions() {
  const allowCache =
    posScreenActive();

  if (
    allowCache &&
    sessionCache &&
    Date.now() -
      sessionCacheSavedAt <
      SESSION_CACHE_TTL_MS
  ) {
    return cloneSessions(
      sessionCache
    );
  }

  if (
    allowCache &&
    sessionRequest
  ) {
    return cloneSessions(
      await sessionRequest
    );
  }

  const request =
    listSalesSessionsFromServer();

  if (allowCache) {
    sessionRequest =
      request;
  }

  try {
    const sessions =
      await request;

    sessionCache =
      cloneSessions(
        sessions
      );

    sessionCacheSavedAt =
      Date.now();

    return cloneSessions(
      sessions
    );
  } finally {
    if (
      sessionRequest ===
      request
    ) {
      sessionRequest =
        null;
    }
  }
}

export async function createEventSession(
  ...args
) {
  const result =
    await createEventSessionCore(
      ...args
    );

  invalidateSessionCache();

  return result;
}

export async function updateEventSession(
  ...args
) {
  const result =
    await updateEventSessionCore(
      ...args
    );

  invalidateSessionCache();

  return result;
}

export async function updateEventExpenses(
  ...args
) {
  const result =
    await updateEventExpensesCore(
      ...args
    );

  invalidateSessionCache();

  return result;
}

export async function deleteEventSession(
  ...args
) {
  const result =
    await deleteEventSessionCore(
      ...args
    );

  invalidateSessionCache();

  return result;
}

export async function archiveEventSession(
  ...args
) {
  const result =
    await archiveEventSessionCore(
      ...args
    );

  invalidateSessionCache();

  return result;
}

export async function restoreArchivedEventSession(
  ...args
) {
  const result =
    await restoreArchivedEventSessionCore(
      ...args
    );

  invalidateSessionCache();

  return result;
}
