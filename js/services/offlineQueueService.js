const QUEUE_KEY =
  "icelolly-sales-offline-queue-v1";

const POS_SNAPSHOT_KEY =
  "icelolly-sales-pos-offline-snapshot-v1";


function readJson(
  key,
  fallback
) {
  try {
    const raw =
      localStorage.getItem(
        key
      );

    if (!raw) {
      return fallback;
    }

    return JSON.parse(
      raw
    );

  } catch (error) {
    console.warn(
      "Offline local data could not be read",
      key,
      error
    );

    return fallback;
  }
}


function writeJson(
  key,
  value
) {
  try {
    localStorage.setItem(
      key,
      JSON.stringify(
        value
      )
    );

    return true;

  } catch (error) {
    console.warn(
      "Offline local data could not be written",
      key,
      error
    );

    return false;
  }
}


function cleanQueue() {
  const rows =
    readJson(
      QUEUE_KEY,
      []
    );

  return Array.isArray(
    rows
  )
    ? rows
        .filter(
          row =>
            row &&
            row.transactionId &&
            row.sale &&
            row.sale.sessionId
        )
    : [];
}


export function loadOfflineSalesQueue() {
  return cleanQueue();
}


export function getOfflineSalesQueueForSession(
  sessionId
) {
  const cleanSessionId =
    String(
      sessionId || ""
    ).trim();

  if (!cleanSessionId) {
    return [];
  }

  return cleanQueue()
    .filter(
      row =>
        row.sessionId ===
        cleanSessionId ||
        row.sale?.sessionId ===
        cleanSessionId
    );
}


export function enqueueOfflineSale({
  sale,
  display = {}
}) {
  const transactionId =
    String(
      sale?.transactionId ||
      ""
    ).trim();

  const sessionId =
    String(
      sale?.sessionId ||
      ""
    ).trim();

  if (
    !transactionId ||
    !sessionId
  ) {
    throw new Error(
      "オフライン会計の保存情報が不足しています。"
    );
  }

  const queue =
    cleanQueue();

  const existing =
    queue.find(
      row =>
        row.transactionId ===
        transactionId
    );

  if (existing) {
    return existing;
  }

  const row = {
    version:
      1,

    transactionId,
    sessionId,

    queuedAt:
      new Date()
        .toISOString(),

    attempts:
      0,

    lastError:
      "",

    sale:
      JSON.parse(
        JSON.stringify(
          sale
        )
      ),

    display:
      JSON.parse(
        JSON.stringify(
          display || {}
        )
      )
  };

  queue.push(
    row
  );

  if (
    !writeJson(
      QUEUE_KEY,
      queue
    )
  ) {
    throw new Error(
      "この端末にオフライン会計を保存できませんでした。"
    );
  }

  return row;
}


export function removeOfflineSale(
  transactionId
) {
  const cleanId =
    String(
      transactionId || ""
    ).trim();

  const queue =
    cleanQueue();

  const next =
    queue.filter(
      row =>
        row.transactionId !==
        cleanId
    );

  writeJson(
    QUEUE_KEY,
    next
  );

  return (
    next.length !==
    queue.length
  );
}


export function updateOfflineSaleError(
  transactionId,
  error
) {
  const cleanId =
    String(
      transactionId || ""
    ).trim();

  const queue =
    cleanQueue();

  const now =
    new Date()
      .toISOString();

  const next =
    queue.map(
      row => {
        if (
          row.transactionId !==
          cleanId
        ) {
          return row;
        }

        return {
          ...row,

          attempts:
            Number(
              row.attempts ||
              0
            ) +
            1,

          lastAttemptAt:
            now,

          lastError:
            String(
              error?.code ||
              error?.message ||
              error ||
              ""
            )
        };
      }
    );

  writeJson(
    QUEUE_KEY,
    next
  );
}


export function pendingVariantQuantities(
  sessionId
) {
  const result =
    new Map();

  getOfflineSalesQueueForSession(
    sessionId
  )
    .forEach(
      row => {
        (
          Array.isArray(
            row.sale?.items
          )
            ? row.sale.items
            : []
        ).forEach(
          item => {
            const variantId =
              String(
                item?.variantId ||
                ""
              ).trim();

            if (!variantId) {
              return;
            }

            const quantity =
              Math.max(
                0,
                Math.floor(
                  Number(
                    item?.quantity ||
                    0
                  )
                )
              );

            result.set(
              variantId,
              (
                result.get(
                  variantId
                ) ||
                0
              ) +
              quantity
            );
          }
        );
      }
    );

  return result;
}


export function savePosOfflineSnapshot(
  snapshot
) {
  const value = {
    version:
      1,

    savedAt:
      new Date()
        .toISOString(),

    ...JSON.parse(
      JSON.stringify(
        snapshot || {}
      )
    )
  };

  if (
    !writeJson(
      POS_SNAPSHOT_KEY,
      value
    )
  ) {
    throw new Error(
      "オフラインPOS準備データを端末へ保存できませんでした。"
    );
  }

  return value;
}


export function loadPosOfflineSnapshot() {
  const snapshot =
    readJson(
      POS_SNAPSHOT_KEY,
      null
    );

  if (
    !snapshot ||
    snapshot.version !==
      1
  ) {
    return null;
  }

  return snapshot;
}


export function clearPosOfflineSnapshot() {
  try {
    localStorage.removeItem(
      POS_SNAPSHOT_KEY
    );
  } catch (error) {
    console.warn(
      error
    );
  }
}
