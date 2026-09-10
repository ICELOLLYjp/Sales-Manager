import { getFirebaseState } from "../firebase.js";

const TRACKED_CATEGORIES =
  new Set([
    "tshirt",
    "pierce",
    "earring",
    "drop_pierce",
    "drop_earring"
  ]);

const REASON_DEFINITIONS = [
  {
    key: "loss",
    label: "紛失",
    deltaSign: -1
  },
  {
    key: "theft",
    label: "盗難",
    deltaSign: -1
  },
  {
    key: "damage",
    label: "破損",
    deltaSign: -1
  },
  {
    key: "gift",
    label: "プレゼント",
    deltaSign: -1
  },
  {
    key: "sample",
    label: "サンプル",
    deltaSign: -1
  }
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

function text(
  value
) {
  return String(
    value ?? ""
  ).trim();
}

function int(
  value
) {
  const number =
    Number(value);

  if (
    !Number.isFinite(
      number
    )
  ) {
    return 0;
  }

  return Math.trunc(
    number
  );
}

function nonNegativeInt(
  value
) {
  return Math.max(
    0,
    int(value)
  );
}

function timestampKey(
  value
) {
  if (!value) {
    return "";
  }

  if (
    typeof value.toMillis ===
    "function"
  ) {
    try {
      return String(
        value.toMillis()
      );
    } catch {
      // Fall through.
    }
  }

  if (
    Number.isFinite(
      Number(value?.seconds)
    )
  ) {
    return [
      Number(
        value.seconds
      ),
      Number(
        value.nanoseconds ||
        0
      )
    ].join(":");
  }

  return String(value);
}

function parseTshirtInventoryKey(
  value
) {
  const raw =
    String(
      value || ""
    );

  if (
    !raw.startsWith(
      "tshirt:"
    )
  ) {
    return null;
  }

  const parts =
    raw
      .slice(7)
      .split("|")
      .map(
        part =>
          decodeURIComponent(
            part
          )
      );

  if (
    parts.length !==
    4
  ) {
    return null;
  }

  return {
    bodyId:
      parts[0],

    designId:
      parts[1],

    colorId:
      parts[2],

    sizeId:
      parts[3]
  };
}

function parseAccessoryInventoryKey(
  value
) {
  const raw =
    String(
      value || ""
    );

  if (
    !raw.startsWith(
      "accessory:"
    )
  ) {
    return null;
  }

  const parts =
    raw
      .slice(10)
      .split("|")
      .map(
        part =>
          decodeURIComponent(
            part
          )
      );

  if (
    parts.length !==
    2
  ) {
    return null;
  }

  return {
    sourceId:
      parts[0],

    stockField:
      parts[1]
  };
}

function readTshirtQty(
  master,
  target
) {
  return Math.max(
    0,
    Number(
      master
        ?.inventory_v2
        ?.[target.bodyId]
        ?.[target.designId]
        ?.[target.colorId]
        ?.[target.sizeId]
        ?.qty ||
      0
    )
  );
}

function eventOpeningItems(
  session
) {
  return Array.isArray(
    session
      ?.inventoryCount
      ?.opening
      ?.items
  )
    ? session
        .inventoryCount
        .opening
        .items
    : [];
}

function eventClosingItems(
  session
) {
  return Array.isArray(
    session
      ?.inventoryCount
      ?.closing
      ?.items
  )
    ? session
        .inventoryCount
        .closing
        .items
    : [];
}

function saleBreakdown(
  transactions,
  openingIds
) {
  const exactByVariant =
    new Map();

  let exactTotal = 0;
  let quickTrackedTotal = 0;
  let otherUnallocatedTotal = 0;

  (
    Array.isArray(
      transactions
    )
      ? transactions
      : []
  )
    .filter(
      transaction =>
        transaction?.status !==
        "voided"
    )
    .forEach(
      sale => {
        (
          Array.isArray(
            sale?.items
          )
            ? sale.items
            : []
        ).forEach(
          item => {
            const quantity =
              nonNegativeInt(
                item?.quantity
              );

            if (
              quantity <= 0
            ) {
              return;
            }

            const variantId =
              text(
                item?.variantId
              );

            const category =
              text(
                item?.category
              );

            if (
              variantId &&
              openingIds.has(
                variantId
              )
            ) {
              exactByVariant.set(
                variantId,
                (
                  exactByVariant.get(
                    variantId
                  ) ||
                  0
                ) +
                quantity
              );

              exactTotal +=
                quantity;

              return;
            }

            if (
              !variantId &&
              TRACKED_CATEGORIES.has(
                category
              )
            ) {
              quickTrackedTotal +=
                quantity;

              return;
            }

            if (
              variantId &&
              TRACKED_CATEGORIES.has(
                category
              )
            ) {
              otherUnallocatedTotal +=
                quantity;
            }
          }
        );
      }
    );

  return {
    exactByVariant,
    exactTotal,
    quickTrackedTotal,
    otherUnallocatedTotal
  };
}

function rowReasonReduction(
  closing
) {
  return REASON_DEFINITIONS
    .reduce(
      (sum, reason) =>
        sum +
        nonNegativeInt(
          closing?.[
            reason.key
          ]
        ),
      0
    );
}

function rowExpectedRemaining({
  opening,
  closing,
  soldQty
}) {
  return (
    nonNegativeInt(
      opening?.openingQty
    ) -
    nonNegativeInt(
      soldQty
    ) -
    rowReasonReduction(
      closing
    ) +
    int(
      closing
        ?.stockAdjustment
    )
  );
}

function eventSnapshotSignature(
  session
) {
  const opening =
    session
      ?.inventoryCount
      ?.opening;

  const closing =
    session
      ?.inventoryCount
      ?.closing;

  return JSON.stringify({
    status:
      session?.status ||
      "",

    openingAt:
      timestampKey(
        opening
          ?.capturedAt
      ),

    closingAt:
      timestampKey(
        closing
          ?.savedAt
      ),

    lastTransactionAt:
      timestampKey(
        session
          ?.lastTransactionAt
      ),

    lastVoidAt:
      timestampKey(
        session
          ?.lastVoidAt
      )
  });
}

function sanitizeDocPart(
  value
) {
  return String(
    value || ""
  )
    .replace(
      /[^A-Za-z0-9_-]/g,
      "_"
    )
    .slice(
      0,
      120
    );
}

async function loadPreflight(
  sessionId
) {
  const db =
    await requireDb();

  const {
    doc,
    collection,
    query,
    where,
    getDocFromServer,
    getDocsFromServer
  } =
    await firestoreModule();

  const sessionRef =
    doc(
      db,
      "salesSessions",
      sessionId
    );

  const [
    sessionSnapshot,
    salesSnapshot
  ] =
    await Promise.all([
      getDocFromServer(
        sessionRef
      ),

      getDocsFromServer(
        query(
          collection(
            db,
            "salesTransactions"
          ),
          where(
            "sessionId",
            "==",
            sessionId
          )
        )
      )
    ]);

  if (
    !sessionSnapshot.exists()
  ) {
    throw new Error(
      "販売セッションが見つかりません。"
    );
  }

  const session =
    sessionSnapshot.data();

  if (
    session?.status ===
    "closed"
  ) {
    return {
      alreadyClosed:
        true,
      session,
      sessionRef,
      signature:
        eventSnapshotSignature(
          session
        )
    };
  }

  if (
    session?.status !==
    "open"
  ) {
    const error =
      new Error(
        "このイベントは終了できる状態ではありません。"
      );

    error.code =
      "session-not-open";

    throw error;
  }

  const openingItems =
    eventOpeningItems(
      session
    );

  const closingItems =
    eventClosingItems(
      session
    );

  if (
    !openingItems.length
  ) {
    const error =
      new Error(
        "開始在庫が保存されていません。"
      );

    error.code =
      "opening-inventory-missing";

    throw error;
  }

  if (
    !closingItems.length
  ) {
    const error =
      new Error(
        "先に終了在庫を数えて保存してください。"
      );

    error.code =
      "closing-inventory-missing";

    throw error;
  }

  const openingIds =
    new Set(
      openingItems.map(
        item =>
          text(
            item?.variantId
          )
      )
    );

  const closingMap =
    new Map(
      closingItems.map(
        item => [
          text(
            item?.variantId
          ),
          item
        ]
      )
    );

  const transactions =
    salesSnapshot.docs.map(
      snapshot => ({
        transactionId:
          snapshot.id,
        ...snapshot.data()
      })
    );

  const sales =
    saleBreakdown(
      transactions,
      openingIds
    );

  if (
    sales.quickTrackedTotal >
    0
  ) {
    const error =
      new Error(
        `Tシャツ・アクセサリーのQuick未割当販売が ${sales.quickTrackedTotal} 点あります。SKUを特定できないため、該当会計を取消してSKUで登録し直してからイベントを終了してください。`
      );

    error.code =
      "quick-sales-unallocated";

    throw error;
  }

  if (
    sales.otherUnallocatedTotal >
    0
  ) {
    const error =
      new Error(
        `開始在庫に含まれないSKU販売が ${sales.otherUnallocatedTotal} 点あります。売上と開始在庫を確認してください。`
      );

    error.code =
      "sku-sales-outside-opening";

    throw error;
  }

  const rows =
    openingItems.map(
      (
        opening,
        index
      ) => {
        const variantId =
          text(
            opening
              ?.variantId
          );

        const closing =
          closingMap.get(
            variantId
          );

        if (
          !closing ||
          closing.closingQty ===
            null ||
          closing.closingQty ===
            undefined ||
          closing.closingQty ===
            ""
        ) {
          return {
            index,
            opening,
            closing,
            variantId,
            incomplete:
              true
          };
        }

        const soldQty =
          sales.exactByVariant.get(
            variantId
          ) ||
          0;

        const expectedQty =
          rowExpectedRemaining({
            opening,
            closing,
            soldQty
          });

        const actualQty =
          nonNegativeInt(
            closing.closingQty
          );

        return {
          index,
          opening,
          closing,
          variantId,
          soldQty,
          expectedQty,
          actualQty,
          difference:
            expectedQty -
            actualQty,
          incomplete:
            false
        };
      }
    );

  const incomplete =
    rows.filter(
      row =>
        row.incomplete
    );

  if (
    incomplete.length
  ) {
    const error =
      new Error(
        `終了在庫が未入力のSKUが ${incomplete.length} 件あります。すべてのSKUを数えて保存してください。`
      );

    error.code =
      "closing-count-incomplete";

    throw error;
  }

  const mismatches =
    rows.filter(
      row =>
        row.difference !==
        0
    );

  if (
    mismatches.length
  ) {
    const examples =
      mismatches
        .slice(
          0,
          3
        )
        .map(
          row => {
            const label =
              text(
                row.opening
                  ?.label
              ) ||
              text(
                row.opening
                  ?.sku
              ) ||
              row.variantId;

            return `${label}: 計算 ${row.expectedQty} / 実数 ${row.actualQty}`;
          }
        )
        .join("、");

    const error =
      new Error(
        `未分類差異が残っているSKUが ${mismatches.length} 件あります。理由または在庫調整を入力して差異を0にしてください。${examples ? ` ${examples}` : ""}`
      );

    error.code =
      "inventory-difference-unresolved";

    error.mismatches =
      mismatches.map(
        row => ({
          variantId:
            row.variantId,
          expectedQty:
            row.expectedQty,
          actualQty:
            row.actualQty,
          difference:
            row.difference
        })
      );

    throw error;
  }

  const movementRows = [];

  rows.forEach(
    row => {
      REASON_DEFINITIONS
        .forEach(
          reason => {
            const quantity =
              nonNegativeInt(
                row.closing?.[
                  reason.key
                ]
              );

            if (
              quantity <= 0
            ) {
              return;
            }

            movementRows.push({
              rowIndex:
                row.index,
              variantId:
                row.variantId,
              category:
                text(
                  row.opening
                    ?.category
                ),
              label:
                text(
                  row.opening
                    ?.label
                ),
              sku:
                text(
                  row.opening
                    ?.sku
                ),
              inventorySource:
                text(
                  row.opening
                    ?.inventorySource
                ),
              inventoryKey:
                text(
                  row.opening
                    ?.inventoryKey
                ),
              reason:
                reason.key,
              reasonLabel:
                reason.label,
              quantity,
              delta:
                -quantity
            });
          }
        );

      const adjustment =
        int(
          row.closing
            ?.stockAdjustment
        );

      if (
        adjustment !==
        0
      ) {
        movementRows.push({
          rowIndex:
            row.index,
          variantId:
            row.variantId,
          category:
            text(
              row.opening
                ?.category
            ),
          label:
            text(
              row.opening
                ?.label
            ),
          sku:
            text(
              row.opening
                ?.sku
            ),
          inventorySource:
            text(
              row.opening
                ?.inventorySource
            ),
          inventoryKey:
            text(
              row.opening
                ?.inventoryKey
            ),
          reason:
            "stock_adjustment",
          reasonLabel:
            "在庫調整",
          quantity:
            Math.abs(
              adjustment
            ),
          delta:
            adjustment
        });
      }
    }
  );

  const openingTotal =
    rows.reduce(
      (sum, row) =>
        sum +
        nonNegativeInt(
          row.opening
            ?.openingQty
        ),
      0
    );

  const closingTotal =
    rows.reduce(
      (sum, row) =>
        sum +
        row.actualQty,
      0
    );

  const reductionTotal =
    rows.reduce(
      (sum, row) =>
        sum +
        rowReasonReduction(
          row.closing
        ),
      0
    );

  const stockAdjustmentTotal =
    rows.reduce(
      (sum, row) =>
        sum +
        int(
          row.closing
            ?.stockAdjustment
        ),
      0
    );

  return {
    alreadyClosed:
      false,
    session,
    sessionRef,
    signature:
      eventSnapshotSignature(
        session
      ),
    openingItems,
    closingItems,
    rows,
    sales,
    movementRows,
    summary: {
      openingTotal,
      exactSalesTotal:
        sales.exactTotal,
      closingTotal,
      reductionTotal,
      stockAdjustmentTotal,
      movementCount:
        movementRows.length
    }
  };
}

export async function finalizeEventSession({
  sessionId,
  closedByEmail = ""
}) {
  const cleanSessionId =
    text(
      sessionId
    );

  if (
    !cleanSessionId
  ) {
    throw new Error(
      "販売セッションが見つかりません。"
    );
  }

  const preflight =
    await loadPreflight(
      cleanSessionId
    );

  if (
    preflight.alreadyClosed
  ) {
    return {
      sessionId:
        cleanSessionId,
      duplicate:
        true,
      status:
        "closed"
    };
  }

  const db =
    await requireDb();

  const {
    doc,
    runTransaction,
    FieldPath,
    serverTimestamp
  } =
    await firestoreModule();

  const sessionRef =
    doc(
      db,
      "salesSessions",
      cleanSessionId
    );

  const closeId =
    `eventclose_${sanitizeDocPart(
      cleanSessionId
    )}`;

  const lockRef =
    doc(
      db,
      "transactionLocks",
      closeId
    );

  const tshirtMasterRef =
    doc(
      db,
      "tshirtStock",
      "master"
    );

  const accessorySharedRef =
    doc(
      db,
      "accessoryStock",
      "shared"
    );

  return await runTransaction(
    db,
    async transaction => {
      const [
        lockSnapshot,
        sessionSnapshot
      ] =
        await Promise.all([
          transaction.get(
            lockRef
          ),
          transaction.get(
            sessionRef
          )
        ]);

      if (
        lockSnapshot.exists() &&
        lockSnapshot.data()
          ?.status ===
          "committed"
      ) {
        return {
          sessionId:
            cleanSessionId,
          closeId,
          duplicate:
            true,
          status:
            "closed"
        };
      }

      if (
        !sessionSnapshot.exists()
      ) {
        throw new Error(
          "販売セッションが見つかりません。"
        );
      }

      const currentSession =
        sessionSnapshot.data();

      if (
        currentSession
          ?.status ===
        "closed"
      ) {
        return {
          sessionId:
            cleanSessionId,
          closeId,
          duplicate:
            true,
          status:
            "closed"
        };
      }

      if (
        currentSession
          ?.status !==
        "open"
      ) {
        const error =
          new Error(
            "このイベントは終了できる状態ではありません。"
          );

        error.code =
          "session-not-open";

        throw error;
      }

      if (
        eventSnapshotSignature(
          currentSession
        ) !==
        preflight.signature
      ) {
        const error =
          new Error(
            "終了処理の直前に売上または在庫データが変更されました。画面を更新してもう一度確認してください。"
          );

        error.code =
          "event-data-changed";

        throw error;
      }

      const tshirtMovementRows =
        preflight.movementRows
          .filter(
            row =>
              row.inventorySource ===
              "tshirt"
          );

      const accessoryMovementRows =
        preflight.movementRows
          .filter(
            row =>
              row.inventorySource ===
              "accessory"
          );

      const unsupportedRows =
        preflight.movementRows
          .filter(
            row =>
              row.inventorySource !==
                "tshirt" &&
              row.inventorySource !==
                "accessory"
          );

      if (
        unsupportedRows.length
      ) {
        const error =
          new Error(
            "正式在庫へ反映できないSKUに紛失・破損・在庫調整などが入力されています。"
          );

        error.code =
          "unsupported-inventory-source";

        throw error;
      }

      const tshirtSnapshot =
        tshirtMovementRows.length
          ? await transaction.get(
              tshirtMasterRef
            )
          : null;

      const accessorySnapshot =
        accessoryMovementRows.length
          ? await transaction.get(
              accessorySharedRef
            )
          : null;

      if (
        tshirtMovementRows.length &&
        !tshirtSnapshot?.exists()
      ) {
        throw new Error(
          "Tシャツ実在庫を確認できません。"
        );
      }

      if (
        accessoryMovementRows.length &&
        !accessorySnapshot?.exists()
      ) {
        throw new Error(
          "アクセサリー実在庫を確認できません。"
        );
      }

      const tshirtMaster =
        tshirtSnapshot?.data() ||
        null;

      const accessoryShared =
        accessorySnapshot?.data() ||
        null;

      const tshirtChanges =
        new Map();

      tshirtMovementRows
        .forEach(
          row => {
            const target =
              parseTshirtInventoryKey(
                row.inventoryKey
              );

            if (!target) {
              const error =
                new Error(
                  `${row.label || row.sku || "Tシャツ"} の在庫キーが不正です。`
                );

              error.code =
                "invalid-tshirt-inventory-key";

              throw error;
            }

            const key =
              row.inventoryKey;

            if (
              !tshirtChanges.has(
                key
              )
            ) {
              tshirtChanges.set(
                key,
                {
                  target,
                  delta: 0,
                  label:
                    row.label ||
                    row.sku ||
                    "Tシャツ"
                }
              );
            }

            tshirtChanges
              .get(
                key
              )
              .delta +=
                row.delta;
          }
        );

      tshirtChanges
        .forEach(
          change => {
            const currentQty =
              readTshirtQty(
                tshirtMaster,
                change.target
              );

            const nextQty =
              currentQty +
              change.delta;

            if (
              nextQty < 0
            ) {
              const error =
                new Error(
                  `${change.label} の正式実在庫が不足しています。現在 ${currentQty} 点、反映予定 ${change.delta} 点です。`
                );

              error.code =
                "stock-insufficient";

              throw error;
            }

            change.currentQty =
              currentQty;

            change.nextQty =
              nextQty;
          }
        );

      let accessoryDesigns =
        Array.isArray(
          accessoryShared
            ?.designs
        )
          ? accessoryShared
              .designs
              .map(
                item => ({
                  ...item
                })
              )
          : [];

      const accessoryChanges =
        new Map();

      accessoryMovementRows
        .forEach(
          row => {
            const target =
              parseAccessoryInventoryKey(
                row.inventoryKey
              );

            if (!target) {
              const error =
                new Error(
                  `${row.label || row.sku || "アクセサリー"} の在庫キーが不正です。`
                );

              error.code =
                "invalid-accessory-inventory-key";

              throw error;
            }

            const key =
              row.inventoryKey;

            if (
              !accessoryChanges.has(
                key
              )
            ) {
              accessoryChanges.set(
                key,
                {
                  target,
                  delta: 0,
                  label:
                    row.label ||
                    row.sku ||
                    "アクセサリー"
                }
              );
            }

            accessoryChanges
              .get(
                key
              )
              .delta +=
                row.delta;
          }
        );

      accessoryChanges
        .forEach(
          change => {
            const index =
              accessoryDesigns
                .findIndex(
                  design =>
                    text(
                      design?.id
                    ) ===
                    change
                      .target
                      .sourceId
                );

            if (
              index < 0
            ) {
              const error =
                new Error(
                  `${change.label} のアクセサリー実在庫が見つかりません。`
                );

              error.code =
                "accessory-stock-not-found";

              throw error;
            }

            const currentQty =
              Math.max(
                0,
                Number(
                  accessoryDesigns[
                    index
                  ]?.[
                    change
                      .target
                      .stockField
                  ] ||
                  0
                )
              );

            const nextQty =
              currentQty +
              change.delta;

            if (
              nextQty < 0
            ) {
              const error =
                new Error(
                  `${change.label} の正式実在庫が不足しています。現在 ${currentQty} 点、反映予定 ${change.delta} 点です。`
                );

              error.code =
                "stock-insufficient";

              throw error;
            }

            accessoryDesigns[
              index
            ][
              change
                .target
                .stockField
            ] =
              nextQty;

            change.currentQty =
              currentQty;

            change.nextQty =
              nextQty;
          }
        );

      /*
       * All reads are complete. Writes start here.
       */
      if (
        tshirtChanges.size
      ) {
        const args = [
          tshirtMasterRef
        ];

        tshirtChanges
          .forEach(
            change => {
              args.push(
                new FieldPath(
                  "inventory_v2",
                  change
                    .target
                    .bodyId,
                  change
                    .target
                    .designId,
                  change
                    .target
                    .colorId,
                  change
                    .target
                    .sizeId,
                  "qty"
                )
              );

              args.push(
                change.nextQty
              );
            }
          );

        args.push(
          "updatedAt",
          serverTimestamp()
        );

        transaction.update(
          ...args
        );
      }

      if (
        accessoryChanges.size
      ) {
        transaction.update(
          accessorySharedRef,
          {
            designs:
              accessoryDesigns,

            updatedAt:
              serverTimestamp()
          }
        );
      }

      preflight.movementRows
        .forEach(
          (
            row,
            index
          ) => {
            const movementId =
              `${closeId}__${index + 1}__${sanitizeDocPart(
                row.reason
              )}`;

            const movementRef =
              doc(
                db,
                "inventoryMovements",
                movementId
              );

            transaction.set(
              movementRef,
              {
                movementId,
                eventCloseId:
                  closeId,
                sessionId:
                  cleanSessionId,
                type:
                  "adjustment",
                reason:
                  row.reason,
                reasonLabel:
                  row.reasonLabel,
                sourceAction:
                  "event_close",
                category:
                  row.category,
                label:
                  row.label,
                sku:
                  row.sku ||
                  null,
                quantity:
                  row.quantity,
                signedQuantity:
                  row.delta,
                expectedInventoryDelta:
                  row.delta,
                appliedInventoryDelta:
                  row.delta,
                inventoryApplied:
                  true,
                eventInventoryApplied:
                  true,
                trackingMode:
                  "sku",
                variantId:
                  row.variantId ||
                  null,
                inventoryKey:
                  row.inventoryKey ||
                  null,
                inventorySource:
                  row.inventorySource ||
                  null,
                status:
                  "applied",
                createdAt:
                  serverTimestamp()
              }
            );
          }
        );

      const soldByVariant = {};

      preflight.rows.forEach(
        row => {
          soldByVariant[
            row.variantId
          ] =
            nonNegativeInt(
              row.soldQty
            );
        }
      );

      transaction.update(
        sessionRef,
        {
          status:
            "closed",

          closedAt:
            serverTimestamp(),

          closedByEmail:
            text(
              closedByEmail
            ),

          eventCloseId:
            closeId,

          eventCloseSummary: {
            openingTotal:
              preflight
                .summary
                .openingTotal,

            skuSalesTotal:
              preflight
                .summary
                .exactSalesTotal,

            closingTotal:
              preflight
                .summary
                .closingTotal,

            recordedReductionTotal:
              preflight
                .summary
                .reductionTotal,

            stockAdjustmentTotal:
              preflight
                .summary
                .stockAdjustmentTotal,

            movementCount:
              preflight
                .summary
                .movementCount,

            unclassifiedDifference:
              0
          },

          "inventoryCount.soldByVariant":
            soldByVariant,

          "inventoryCount.finalizedAt":
            serverTimestamp(),

          "inventoryCount.finalizedByEmail":
            text(
              closedByEmail
            ),

          "inventoryCount.adjustmentsAppliedAt":
            serverTimestamp(),

          updatedAt:
            serverTimestamp()
        }
      );

      transaction.set(
        lockRef,
        {
          transactionId:
            closeId,
          action:
            "event_close",
          sessionId:
            cleanSessionId,
          status:
            "committed",
          movementCount:
            preflight
              .summary
              .movementCount,
          createdAt:
            serverTimestamp()
        }
      );

      return {
        sessionId:
          cleanSessionId,
        closeId,
        duplicate:
          false,
        status:
          "closed",
        ...preflight.summary
      };
    }
  );
}
