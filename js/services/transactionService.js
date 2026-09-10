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

function safeNumber(value) {
  const number = Number(value || 0);

  if (!Number.isFinite(number)) {
    return 0;
  }

  return number;
}

function createTransactionId() {
  if (
    globalThis.crypto &&
    typeof globalThis.crypto.randomUUID === "function"
  ) {
    return `sale_${globalThis.crypto.randomUUID()}`;
  }

  return [
    "sale",
    Date.now(),
    Math.random()
      .toString(36)
      .slice(2, 12)
  ].join("_");
}

function normalizeItems(items) {
  return (Array.isArray(items) ? items : [])
    .map((item, index) => {
      const quantity = Math.max(
        0,
        Math.floor(
          safeNumber(item?.quantity)
        )
      );

      const unitPrice = Math.max(
        0,
        safeNumber(item?.unitPrice)
      );

      const grossLineTotal =
        quantity *
        unitPrice;

      const requestedSetDiscount =
        Math.max(
          0,
          safeNumber(
            item?.setDiscount
          )
        );

      const setDiscount =
        Math.min(
          requestedSetDiscount,
          grossLineTotal
        );

      const afterSet =
        Math.max(
          0,
          grossLineTotal -
          setDiscount
        );

      const requestedManualDiscount =
        Math.max(
          0,
          safeNumber(
            item?.manualDiscount
          )
        );

      const manualDiscount =
        Math.min(
          requestedManualDiscount,
          afterSet
        );

      const netBeforeOrder =
        Math.max(
          0,
          afterSet -
          manualDiscount
        );

      const variantId =
        String(
          item?.variantId || ""
        ).trim() || null;

      return {
        lineId:
          String(
            item?.lineId ||
            `line_${index + 1}`
          ),

        category:
          String(
            item?.category || ""
          ).trim(),

        label:
          String(
            item?.label ||
            item?.category ||
            ""
          ).trim(),

        quantity,

        unitPrice,

        grossLineTotal,

        setDiscount,

        manualDiscount,

        lineDiscountBeforeOrder:
          setDiscount +
          manualDiscount,

        netBeforeOrder,

        setOffer: {
          quantity:
            Math.max(
              0,
              Math.floor(
                safeNumber(
                  item?.setOffer
                    ?.quantity
                )
              )
            ),
          price:
            Math.max(
              0,
              safeNumber(
                item?.setOffer
                  ?.price
              )
            )
        },

        trackingMode:
          variantId
            ? "sku"
            : String(
                item?.trackingMode ||
                "quick"
              ),

        variantId,

        inventoryKey:
          item?.inventoryKey || null
      };
    })
    .filter(
      item =>
        item.category &&
        item.quantity > 0
    );
}

function allocateOrderDiscount(
  items,
  orderDiscount
) {
  const beforeOrder =
    items.reduce(
      (sum, item) =>
        sum +
        item.netBeforeOrder,
      0
    );

  const cleanOrderDiscount =
    Math.max(
      0,
      Math.min(
        safeNumber(
          orderDiscount
        ),
        beforeOrder
      )
    );

  let allocated = 0;

  const eligibleIndexes =
    items
      .map(
        (item, index) => ({
          item,
          index
        })
      )
      .filter(
        entry =>
          entry.item
            .netBeforeOrder >
          0
      )
      .map(
        entry =>
          entry.index
      );

  return {
    orderDiscount:
      cleanOrderDiscount,

    items:
      items.map(
        (
          item,
          index
        ) => {
          let allocation = 0;

          const eligiblePosition =
            eligibleIndexes
              .indexOf(
                index
              );

          if (
            cleanOrderDiscount > 0 &&
            eligiblePosition >= 0
          ) {
            const isLast =
              eligiblePosition ===
              eligibleIndexes.length -
              1;

            allocation =
              isLast
                ? (
                    cleanOrderDiscount -
                    allocated
                  )
                : (
                    cleanOrderDiscount *
                    (
                      item.netBeforeOrder /
                      beforeOrder
                    )
                  );

            allocation =
              Math.max(
                0,
                Math.min(
                  allocation,
                  item.netBeforeOrder
                )
              );

            allocated +=
              allocation;
          }

          return {
            ...item,

            orderDiscountAllocated:
              allocation,

            totalLineDiscount:
              item.lineDiscountBeforeOrder +
              allocation,

            netLineTotal:
              Math.max(
                0,
                item.netBeforeOrder -
                allocation
              )
          };
        }
      )
  };
}

function fingerprintFor({
  sessionId,
  currency,
  items,
  orderDiscount,
  discount
}) {
  return JSON.stringify({
    sessionId,
    currency,
    orderDiscount,
    discount,
    items: items.map(
      item => ({
        category:
          item.category,
        quantity:
          item.quantity,
        unitPrice:
          item.unitPrice,
        setDiscount:
          item.setDiscount,
        manualDiscount:
          item.manualDiscount,
        trackingMode:
          item.trackingMode,
        variantId:
          item.variantId || null
      })
    )
  });
}

function parseTshirtInventoryKey(value) {
  const text = String(value || "");

  if (!text.startsWith("tshirt:")) {
    return null;
  }

  const parts =
    text
      .slice(7)
      .split("|")
      .map(
        part =>
          decodeURIComponent(part)
      );

  if (parts.length !== 4) {
    return null;
  }

  return {
    bodyId: parts[0],
    designId: parts[1],
    colorId: parts[2],
    sizeId: parts[3]
  };
}

function parseAccessoryInventoryKey(value) {
  const text = String(value || "");

  if (!text.startsWith("accessory:")) {
    return null;
  }

  const parts =
    text
      .slice(10)
      .split("|")
      .map(
        part =>
          decodeURIComponent(part)
      );

  if (parts.length !== 2) {
    return null;
  }

  return {
    sourceId: parts[0],
    stockField: parts[1]
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
        ?.qty || 0
    )
  );
}

function saleMode(items) {
  const skuCount =
    items.filter(
      item =>
        item.variantId
    ).length;

  if (skuCount === 0) {
    return "quick";
  }

  if (skuCount === items.length) {
    return "sku";
  }

  return "mixed";
}


function sessionEventOpeningMap(
  session
) {
  const openingItems =
    Array.isArray(
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

  const map =
    new Map();

  openingItems.forEach(
    item => {
      const variantId =
        String(
          item?.variantId ||
          ""
        ).trim();

      if (!variantId) {
        return;
      }

      map.set(
        variantId,
        Math.max(
          0,
          Math.floor(
            safeNumber(
              item?.openingQty
            )
          )
        )
      );
    }
  );

  return map;
}

function sessionEventSoldMap(
  session
) {
  const source =
    session
      ?.inventoryCount
      ?.soldByVariant;

  if (
    !source ||
    typeof source !==
      "object" ||
    Array.isArray(
      source
    )
  ) {
    return {};
  }

  const result = {};

  Object.entries(
    source
  ).forEach(
    ([
      variantId,
      quantity
    ]) => {
      const cleanVariantId =
        String(
          variantId ||
          ""
        ).trim();

      if (!cleanVariantId) {
        return;
      }

      result[
        cleanVariantId
      ] =
        Math.max(
          0,
          Math.floor(
            safeNumber(
              quantity
            )
          )
        );
    }
  );

  return result;
}

function eventSaleQuantityByVariant(
  items
) {
  const result =
    new Map();

  (
    Array.isArray(items)
      ? items
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
            safeNumber(
              item?.quantity
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

  return result;
}

function localDateKey() {
  const now =
    new Date();

  const year =
    String(
      now.getFullYear()
    );

  const month =
    String(
      now.getMonth() +
      1
    ).padStart(
      2,
      "0"
    );

  const day =
    String(
      now.getDate()
    ).padStart(
      2,
      "0"
    );

  return `${year}-${month}-${day}`;
}


function normalizedCostSchedule(
  value
) {
  return (
    Array.isArray(
      value
    )
      ? value
      : []
  )
    .map(
      row => ({
        amountJPY:
          Number(
            row?.amountJPY
          ),

        effectiveFrom:
          String(
            row?.effectiveFrom ||
            ""
          ),

        note:
          String(
            row?.note || ""
          )
      })
    )
    .filter(
      row =>
        /^\d{4}-\d{2}-\d{2}$/.test(
          row.effectiveFrom
        ) &&
        Number.isFinite(
          row.amountJPY
        ) &&
        row.amountJPY >=
          0
    )
    .sort(
      (a, b) =>
        b.effectiveFrom
          .localeCompare(
            a.effectiveFrom
          )
    );
}


function resolveScheduledCost(
  schedule,
  saleDate
) {
  const match =
    normalizedCostSchedule(
      schedule
    ).find(
      row =>
        row.effectiveFrom <=
        saleDate
    );

  return match
    ? {
        unitCostJPY:
          match.amountJPY,

        effectiveFrom:
          match.effectiveFrom,

        note:
          match.note
      }
    : null;
}


function resolveItemCostSnapshot({
  item,
  variant,
  product,
  saleDate
}) {
  if (
    item?.variantId
  ) {
    const skuCost =
      resolveScheduledCost(
        variant?.costSchedule,
        saleDate
      );

    if (
      skuCost
    ) {
      return {
        captured:
          true,
        version:
          1,
        saleDate,
        source:
          "sku",
        ...skuCost
      };
    }

    /*
     * Backward compatibility for SKU cost entries saved
     * before costSchedule was introduced.
     */
    const legacyDate =
      String(
        variant
          ?.latestCostEffectiveFrom ||
        ""
      );

    const legacyAmount =
      Number(
        variant
          ?.latestCostJPY
      );

    if (
      /^\d{4}-\d{2}-\d{2}$/.test(
        legacyDate
      ) &&
      legacyDate <=
        saleDate &&
      Number.isFinite(
        legacyAmount
      ) &&
      legacyAmount >=
        0
    ) {
      return {
        captured:
          true,
        version:
          1,
        saleDate,
        source:
          "sku",
        unitCostJPY:
          legacyAmount,
        effectiveFrom:
          legacyDate,
        note:
          ""
      };
    }
  }

  if (
    item?.category ===
      "tshirt" &&
    item?.bodyId
  ) {
    const bodyCost =
      resolveScheduledCost(
        product
          ?.bodyCostSchedules
          ?.[
            item.bodyId
          ],
        saleDate
      );

    if (
      bodyCost
    ) {
      return {
        captured:
          true,
        version:
          1,
        saleDate,
        source:
          "body",
        ...bodyCost
      };
    }
  }

  const categoryCost =
    resolveScheduledCost(
      product?.costSchedule,
      saleDate
    );

  if (
    categoryCost
  ) {
    return {
      captured:
        true,
      version:
        1,
      saleDate,
      source:
        "category",
      ...categoryCost
    };
  }

  return {
    captured:
      true,
    version:
      1,
    saleDate,
    source:
      "missing",
    unitCostJPY:
      null,
    effectiveFrom:
      null,
    note:
      ""
  };
}


export async function commitQuickSale({
  transactionId = null,
  sessionId,
  items,
  orderDiscount = 0,
  createdByEmail = ""
}) {
  const db = await requireDb();

  const cleanSessionId =
    String(
      sessionId || ""
    ).trim();

  if (!cleanSessionId) {
    throw new Error(
      "販売セッションを選択してください。"
    );
  }

  const normalizedItems =
    normalizeItems(items);

  if (!normalizedItems.length) {
    throw new Error(
      "会計する商品がありません。"
    );
  }

  const allocation =
    allocateOrderDiscount(
      normalizedItems,
      orderDiscount
    );

  const pricedItems =
    allocation.items;

  const subtotal =
    pricedItems.reduce(
      (sum, item) =>
        sum +
        item.grossLineTotal,
      0
    );

  const itemCount =
    pricedItems.reduce(
      (sum, item) =>
        sum +
        item.quantity,
      0
    );

  const setDiscount =
    pricedItems.reduce(
      (sum, item) =>
        sum +
        item.setDiscount,
      0
    );

  const lineDiscount =
    pricedItems.reduce(
      (sum, item) =>
        sum +
        item.manualDiscount,
      0
    );

  const cleanOrderDiscount =
    allocation.orderDiscount;

  const discount =
    setDiscount +
    lineDiscount +
    cleanOrderDiscount;

  const netSales =
    Math.max(
      0,
      subtotal -
      discount
    );

  const id =
    String(
      transactionId ||
      createTransactionId()
    );

  const {
    doc,
    runTransaction,
    increment,
    serverTimestamp,
    FieldPath
  } = await firestoreModule();

  const sessionRef =
    doc(
      db,
      "salesSessions",
      cleanSessionId
    );

  const saleRef =
    doc(
      db,
      "salesTransactions",
      id
    );

  const lockRef =
    doc(
      db,
      "transactionLocks",
      id
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

  const result =
    await runTransaction(
      db,
      async transaction => {
        const lockSnapshot =
          await transaction.get(
            lockRef
          );

        const sessionSnapshot =
          await transaction.get(
            sessionRef
          );

        if (!sessionSnapshot.exists()) {
          throw new Error(
            "販売セッションが見つかりません。"
          );
        }

        const session =
          sessionSnapshot.data();

        if (
          session?.status !==
          "open"
        ) {
          throw new Error(
            "この販売セッションは終了しています。"
          );
        }

        /*
         * If an event opening inventory exists, SKU sales are constrained
         * to that event allocation rather than the company's total stock.
         * Quick sales remain unallocated and do not change a specific SKU.
         */
        const eventOpeningMap =
          sessionEventOpeningMap(
            session
          );

        const eventInventoryEnabled =
          eventOpeningMap.size >
          0;

        const eventSaleQtyMap =
          eventSaleQuantityByVariant(
            normalizedItems
          );

        const currentEventSoldByVariant =
          sessionEventSoldMap(
            session
          );

        const nextEventSoldByVariant = {
          ...currentEventSoldByVariant
        };

        if (
          eventInventoryEnabled
        ) {
          eventSaleQtyMap.forEach(
            (
              saleQuantity,
              variantId
            ) => {
              const openingQuantity =
                eventOpeningMap.get(
                  variantId
                );

              if (
                openingQuantity ===
                undefined
              ) {
                const error =
                  new Error(
                    "このSKUはイベント開始在庫に含まれていません。"
                  );

                error.code =
                  "event-stock-not-carried";

                throw error;
              }

              const soldQuantity =
                Math.max(
                  0,
                  Math.floor(
                    safeNumber(
                      currentEventSoldByVariant[
                        variantId
                      ]
                    )
                  )
                );

              const availableQuantity =
                Math.max(
                  0,
                  openingQuantity -
                  soldQuantity
                );

              if (
                availableQuantity <
                saleQuantity
              ) {
                const error =
                  new Error(
                    `イベント在庫が不足しています。残り ${availableQuantity} 点です。`
                  );

                error.code =
                  "event-stock-insufficient";

                throw error;
              }

              nextEventSoldByVariant[
                variantId
              ] =
                soldQuantity +
                saleQuantity;
            }
          );
        }

        const currency =
          String(
            session?.currency ||
            "JPY"
          );

        const fingerprint =
          fingerprintFor({
            sessionId:
              cleanSessionId,
            currency,
            items:
              normalizedItems,
            discount
          });

        if (lockSnapshot.exists()) {
          const existing =
            lockSnapshot.data();

          if (
            existing?.fingerprint &&
            existing.fingerprint !==
              fingerprint
          ) {
            const error =
              new Error(
                "同じtransaction IDに異なる会計内容が使われています。"
              );

            error.code =
              "transaction-id-conflict";

            throw error;
          }

          return {
            transactionId: id,
            duplicate: true,
            currency,
            subtotal,
            setDiscount,
            lineDiscount,
            orderDiscount:
              cleanOrderDiscount,
            discount,
            netSales,
            itemCount
          };
        }

        /*
         * All reads happen before writes.
         * SKU metadata is re-read from Firestore rather than trusting the client.
         */
        const variantSnapshots =
          new Map();

        for (const item of pricedItems) {
          if (!item.variantId) {
            continue;
          }

          const variantRef =
            doc(
              db,
              "productVariants",
              item.variantId
            );

          const snapshot =
            await transaction.get(
              variantRef
            );

          if (!snapshot.exists()) {
            throw new Error(
              `${item.label} のSKU情報が見つかりません。`
            );
          }

          variantSnapshots.set(
            item.variantId,
            snapshot.data()
          );
        }

        let needsTshirt =
          false;

        let needsAccessory =
          false;

        let resolvedItems =
          pricedItems.map(
            item => {
              if (!item.variantId) {
                return {
                  ...item,
                  eventInventoryApplied:
                    false,
                  inventorySource:
                    null,
                  inventoryKey:
                    null
                };
              }

              const variant =
                variantSnapshots.get(
                  item.variantId
                ) || {};

              if (
                variant.active ===
                false
              ) {
                throw new Error(
                  `${item.label} は現在販売停止中です。`
                );
              }

              const inventorySource =
                variant.inventorySource ||
                null;

              const inventoryKey =
                variant.inventoryKey ||
                null;

              if (
                inventorySource ===
                "tshirt"
              ) {
                needsTshirt =
                  true;
              }

              if (
                inventorySource ===
                "accessory"
              ) {
                needsAccessory =
                  true;
              }

              return {
                ...item,

                eventInventoryApplied:
                  eventInventoryEnabled,

                category:
                  variant.category ||
                  item.category,

                label:
                  item.label ||
                  variant.displayName ||
                  variant.design ||
                  item.category,

                inventorySource,

                inventoryKey,

                bodyId:
                  variant.bodyId ||
                  null,

                designId:
                  variant.designId ||
                  null,

                colorId:
                  variant.colorId ||
                  null,

                sizeId:
                  variant.sizeId ||
                  null
              };
            }
          );

        /*
         * Cost master is effective-dated. Product docs contain a compact
         * schedule cache so checkout only needs one read per used category.
         * SKU schedules are already available from the variant reads above.
         */
        const saleCostDate =
          localDateKey();

        const costProductSnapshots =
          new Map();

        const costCategories =
          Array.from(
            new Set(
              resolvedItems
                .map(
                  item =>
                    String(
                      item.category ||
                      ""
                    ).trim()
                )
                .filter(Boolean)
            )
          );

        for (
          const category of
          costCategories
        ) {
          const productRef =
            doc(
              db,
              "products",
              category
            );

          const snapshot =
            await transaction.get(
              productRef
            );

          costProductSnapshots.set(
            category,
            snapshot.exists()
              ? snapshot.data()
              : {}
          );
        }

        resolvedItems =
          resolvedItems.map(
            item => {
              const variant =
                item.variantId
                  ? (
                      variantSnapshots.get(
                        item.variantId
                      ) ||
                      {}
                    )
                  : {};

              const product =
                costProductSnapshots.get(
                  item.category
                ) ||
                {};

              const costSnapshot =
                resolveItemCostSnapshot({
                  item,
                  variant,
                  product,
                  saleDate:
                    saleCostDate
                });

              const unitCostJPY =
                costSnapshot
                  .unitCostJPY;

              return {
                ...item,

                costSnapshot,

                costSnapshotCaptured:
                  true,

                unitCostJPY,

                costSource:
                  costSnapshot.source,

                costEffectiveFrom:
                  costSnapshot
                    .effectiveFrom,

                lineCostJPY:
                  unitCostJPY ===
                    null
                    ? null
                    : (
                        unitCostJPY *
                        item.quantity
                      )
              };
            }
          );

        const tshirtSnapshot =
          needsTshirt
            ? await transaction.get(
                tshirtMasterRef
              )
            : null;

        const accessorySnapshot =
          needsAccessory
            ? await transaction.get(
                accessorySharedRef
              )
            : null;

        if (
          needsTshirt &&
          !tshirtSnapshot?.exists()
        ) {
          throw new Error(
            "Tシャツ実在庫を確認できません。"
          );
        }

        if (
          needsAccessory &&
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

        const tshirtTargets =
          [];

        let accessoryDesigns =
          Array.isArray(
            accessoryShared?.designs
          )
            ? accessoryShared.designs.map(
                item => ({
                  ...item
                })
              )
            : [];

        const finalizedItems =
          resolvedItems.map(
            item => {
              if (!item.variantId) {
                return {
                  ...item,
                  inventoryApplied:
                    false,
                  reconciliationStatus:
                    "pending_allocation"
                };
              }

              if (
                item.inventorySource ===
                "tshirt"
              ) {
                const target =
                  parseTshirtInventoryKey(
                    item.inventoryKey
                  );

                if (!target) {
                  throw new Error(
                    `${item.label} のTシャツ在庫キーが不正です。`
                  );
                }

                const currentQty =
                  readTshirtQty(
                    tshirtMaster,
                    target
                  );

                if (
                  currentQty <
                  item.quantity
                ) {
                  const error =
                    new Error(
                      `${item.label} の在庫が不足しています。現在 ${currentQty} 点です。`
                    );

                  error.code =
                    "stock-insufficient";

                  throw error;
                }

                tshirtTargets.push({
                  target,
                  nextQty:
                    currentQty -
                    item.quantity
                });

                return {
                  ...item,
                  inventoryApplied:
                    true,
                  reconciliationStatus:
                    "reconciled"
                };
              }

              if (
                item.inventorySource ===
                "accessory"
              ) {
                const target =
                  parseAccessoryInventoryKey(
                    item.inventoryKey
                  );

                if (!target) {
                  throw new Error(
                    `${item.label} のアクセサリー在庫キーが不正です。`
                  );
                }

                const index =
                  accessoryDesigns.findIndex(
                    design =>
                      String(
                        design?.id || ""
                      ) ===
                      target.sourceId
                  );

                if (index < 0) {
                  throw new Error(
                    `${item.label} のアクセサリー在庫が見つかりません。`
                  );
                }

                const currentQty =
                  Math.max(
                    0,
                    Number(
                      accessoryDesigns[
                        index
                      ]?.[
                        target.stockField
                      ] || 0
                    )
                  );

                if (
                  currentQty <
                  item.quantity
                ) {
                  const error =
                    new Error(
                      `${item.label} の在庫が不足しています。現在 ${currentQty} 点です。`
                    );

                  error.code =
                    "stock-insufficient";

                  throw error;
                }

                accessoryDesigns[
                  index
                ][
                  target.stockField
                ] =
                  currentQty -
                  item.quantity;

                return {
                  ...item,
                  inventoryApplied:
                    true,
                  reconciliationStatus:
                    "reconciled"
                };
              }

              /*
               * A SKU may exist but not yet have a stock adapter.
               * In that case the sale is saved, but stock is left for reconciliation.
               */
              return {
                ...item,
                inventoryApplied:
                  false,
                reconciliationStatus:
                  "pending_allocation"
              };
            }
          );

        const fxRateToJPY =
          currency === "JPY"
            ? 1
            : (
                Number(
                  session?.fxRateToJPY ||
                  0
                ) > 0
                  ? Number(
                      session.fxRateToJPY
                    )
                  : null
              );

        const grossSalesJPY =
          fxRateToJPY
            ? subtotal *
              fxRateToJPY
            : null;

        const setDiscountJPY =
          fxRateToJPY
            ? setDiscount *
              fxRateToJPY
            : null;

        const lineDiscountJPY =
          fxRateToJPY
            ? lineDiscount *
              fxRateToJPY
            : null;

        const orderDiscountJPY =
          fxRateToJPY
            ? cleanOrderDiscount *
              fxRateToJPY
            : null;

        const discountJPY =
          fxRateToJPY
            ? discount *
              fxRateToJPY
            : null;

        const netSalesJPY =
          fxRateToJPY
            ? netSales *
              fxRateToJPY
            : null;

        const costSnapshotCoveredQuantity =
          finalizedItems.reduce(
            (sum, item) =>
              item.unitCostJPY ===
                null ||
              item.unitCostJPY ===
                undefined
                ? sum
                : (
                    sum +
                    item.quantity
                  ),
            0
          );

        const costSnapshotMissingQuantity =
          finalizedItems.reduce(
            (sum, item) =>
              item.unitCostJPY ===
                null ||
              item.unitCostJPY ===
                undefined
                ? (
                    sum +
                    item.quantity
                  )
                : sum,
            0
          );

        const costSnapshotTotalJPY =
          finalizedItems.reduce(
            (sum, item) =>
              item.lineCostJPY ===
                null ||
              item.lineCostJPY ===
                undefined
                ? sum
                : (
                    sum +
                    Number(
                      item.lineCostJPY ||
                      0
                    )
                  ),
            0
          );

        const appliedCount =
          finalizedItems.filter(
            item =>
              item.inventoryApplied
          ).length;

        const pendingCount =
          finalizedItems.length -
          appliedCount;

        const mode =
          saleMode(
            finalizedItems
          );

        const reconciliationStatus =
          pendingCount === 0
            ? "reconciled"
            : (
                appliedCount > 0
                  ? "partially_allocated"
                  : "pending_allocation"
              );

        /*
         * Writes start here.
         */
        if (tshirtTargets.length) {
          const args = [
            tshirtMasterRef
          ];

          tshirtTargets.forEach(
            entry => {
              args.push(
                new FieldPath(
                  "inventory_v2",
                  entry.target.bodyId,
                  entry.target.designId,
                  entry.target.colorId,
                  entry.target.sizeId,
                  "qty"
                )
              );

              args.push(
                entry.nextQty
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

        if (needsAccessory) {
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

        const transactionData = {
          transactionId:
            id,

          sessionId:
            cleanSessionId,

          sessionType:
            session?.type ||
            "event",

          eventName:
            session?.eventName ||
            "",

          country:
            session?.country ||
            "",

          city:
            session?.city ||
            "",

          mode,

          currency,

          baseCurrency:
            "JPY",

          fxRateToJPY,

          fxRateStatus:
            fxRateToJPY
              ? "set"
              : "pending",

          grossSales:
            subtotal,

          setDiscount,

          lineDiscount,

          orderDiscount:
            cleanOrderDiscount,

          discount,

          netSales,

          grossSalesJPY,

          setDiscountJPY,

          lineDiscountJPY,

          orderDiscountJPY,

          discountJPY,

          netSalesJPY,

          costSnapshotVersion:
            1,

          costSnapshotDate:
            saleCostDate,

          costSnapshotTotalJPY,

          costSnapshotCoveredQuantity,

          costSnapshotMissingQuantity,

          costSnapshotComplete:
            costSnapshotMissingQuantity ===
            0,

          itemCount,

          lineCount:
            finalizedItems.length,

          items:
            finalizedItems,

          eventInventoryMode:
            eventInventoryEnabled
              ? "opening_allocation"
              : "global_only",

          inventoryMode:
            reconciliationStatus ===
              "reconciled"
              ? "allocated"
              : (
                  reconciliationStatus ===
                    "partially_allocated"
                    ? "mixed"
                    : "unallocated_quick"
                ),

          inventoryApplied:
            reconciliationStatus ===
            "reconciled",

          reconciliationStatus,

          status:
            "completed",

          createdByEmail:
            String(
              createdByEmail ||
              ""
            ),

          createdAt:
            serverTimestamp(),

          updatedAt:
            serverTimestamp()
        };

        transaction.set(
          saleRef,
          transactionData
        );

        transaction.set(
          lockRef,
          {
            transactionId:
              id,
            sessionId:
              cleanSessionId,
            fingerprint,
            status:
              "committed",
            createdAt:
              serverTimestamp()
          }
        );

        finalizedItems.forEach(
          (item, index) => {
            const movementRef =
              doc(
                db,
                "inventoryMovements",
                `${id}__${index + 1}`
              );

            transaction.set(
              movementRef,
              {
                movementId:
                  `${id}__${index + 1}`,

                transactionId:
                  id,

                sessionId:
                  cleanSessionId,

                type:
                  "sale",

                reason:
                  "sale",

                category:
                  item.category,

                label:
                  item.label,

                quantity:
                  item.quantity,

                expectedInventoryDelta:
                  -item.quantity,

                appliedInventoryDelta:
                  item.inventoryApplied
                    ? -item.quantity
                    : 0,

                inventoryApplied:
                  item.inventoryApplied,

                eventInventoryApplied:
                  item.eventInventoryApplied ===
                  true,

                trackingMode:
                  item.trackingMode,

                variantId:
                  item.variantId ||
                  null,

                inventoryKey:
                  item.inventoryKey ||
                  null,

                inventorySource:
                  item.inventorySource ||
                  null,

                status:
                  item.inventoryApplied
                    ? "applied"
                    : "pending_allocation",

                createdAt:
                  serverTimestamp()
              }
            );
          }
        );

        const sessionUpdate = {
          "salesSummary.grossSales":
            increment(subtotal),

          "salesSummary.setDiscount":
            increment(
              setDiscount
            ),

          "salesSummary.lineDiscount":
            increment(
              lineDiscount
            ),

          "salesSummary.orderDiscount":
            increment(
              cleanOrderDiscount
            ),

          "salesSummary.discount":
            increment(discount),

          "salesSummary.netSales":
            increment(netSales),

          "salesSummary.transactionCount":
            increment(1),

          "salesSummary.itemCount":
            increment(itemCount),

          lastTransactionAt:
            serverTimestamp(),

          updatedAt:
            serverTimestamp()
        };

        if (
          eventInventoryEnabled &&
          eventSaleQtyMap.size
        ) {
          sessionUpdate[
            "inventoryCount.soldByVariant"
          ] =
            nextEventSoldByVariant;

          sessionUpdate[
            "inventoryCount.salesUpdatedAt"
          ] =
            serverTimestamp();
        }

        if (fxRateToJPY) {
          sessionUpdate[
            "salesSummary.grossSalesJPY"
          ] =
            increment(
              grossSalesJPY
            );

          sessionUpdate[
            "salesSummary.setDiscountJPY"
          ] =
            increment(
              setDiscountJPY
            );

          sessionUpdate[
            "salesSummary.lineDiscountJPY"
          ] =
            increment(
              lineDiscountJPY
            );

          sessionUpdate[
            "salesSummary.orderDiscountJPY"
          ] =
            increment(
              orderDiscountJPY
            );

          sessionUpdate[
            "salesSummary.discountJPY"
          ] =
            increment(
              discountJPY
            );

          sessionUpdate[
            "salesSummary.netSalesJPY"
          ] =
            increment(
              netSalesJPY
            );
        }

        transaction.update(
          sessionRef,
          sessionUpdate
        );

        return {
          transactionId:
            id,
          duplicate:
            false,
          currency,
          subtotal,
          setDiscount,
          lineDiscount,
          orderDiscount:
            cleanOrderDiscount,
          discount,
          netSales,
          itemCount,
          fxRateToJPY,
          netSalesJPY,
          mode,
          reconciliationStatus
        };
      }
    );

  return result;
}


export async function voidSaleTransaction({
  transactionId,
  voidedByEmail = "",
  reason = "manual_void"
}) {
  const db = await requireDb();

  const id =
    String(
      transactionId || ""
    ).trim();

  if (!id) {
    throw new Error(
      "取消する会計IDがありません。"
    );
  }

  const {
    doc,
    runTransaction,
    serverTimestamp,
    FieldPath
  } = await firestoreModule();

  const saleRef =
    doc(
      db,
      "salesTransactions",
      id
    );

  const lockRef =
    doc(
      db,
      "transactionLocks",
      id
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
      const saleSnapshot =
        await transaction.get(
          saleRef
        );

      if (!saleSnapshot.exists()) {
        throw new Error(
          "取消する会計が見つかりません。"
        );
      }

      const sale =
        saleSnapshot.data();

      if (
        sale?.status ===
        "voided"
      ) {
        return {
          transactionId:
            id,
          duplicate:
            true,
          status:
            "voided"
        };
      }

      if (
        sale?.status &&
        sale.status !==
          "completed"
      ) {
        throw new Error(
          "この会計は取消できる状態ではありません。"
        );
      }

      const sessionId =
        String(
          sale?.sessionId ||
          ""
        ).trim();

      if (!sessionId) {
        throw new Error(
          "会計の販売セッションを確認できません。"
        );
      }

      const sessionRef =
        doc(
          db,
          "salesSessions",
          sessionId
        );

      const sessionSnapshot =
        await transaction.get(
          sessionRef
        );

      if (!sessionSnapshot.exists()) {
        throw new Error(
          "販売セッションが見つかりません。"
        );
      }

      const session =
        sessionSnapshot.data();

      const items =
        Array.isArray(
          sale?.items
        )
          ? sale.items
          : [];

      const appliedItems =
        items.filter(
          item =>
            item?.inventoryApplied ===
            true
        );

      const eventAppliedItems =
        items.filter(
          item =>
            item
              ?.eventInventoryApplied ===
              true &&
            item?.variantId
        );

      const currentEventSoldByVariant =
        sessionEventSoldMap(
          session
        );

      const nextEventSoldByVariant = {
        ...currentEventSoldByVariant
      };

      eventAppliedItems.forEach(
        item => {
          const variantId =
            String(
              item?.variantId ||
              ""
            ).trim();

          const quantity =
            Math.max(
              0,
              Math.floor(
                safeNumber(
                  item?.quantity
                )
              )
            );

          nextEventSoldByVariant[
            variantId
          ] =
            Math.max(
              0,
              Math.floor(
                safeNumber(
                  nextEventSoldByVariant[
                    variantId
                  ]
                )
              ) -
              quantity
            );
        }
      );

      const needsTshirt =
        appliedItems.some(
          item =>
            item?.inventorySource ===
            "tshirt"
        );

      const needsAccessory =
        appliedItems.some(
          item =>
            item?.inventorySource ===
            "accessory"
        );

      const tshirtSnapshot =
        needsTshirt
          ? await transaction.get(
              tshirtMasterRef
            )
          : null;

      const accessorySnapshot =
        needsAccessory
          ? await transaction.get(
              accessorySharedRef
            )
          : null;

      if (
        needsTshirt &&
        !tshirtSnapshot?.exists()
      ) {
        throw new Error(
          "Tシャツ実在庫を確認できないため取消できません。"
        );
      }

      if (
        needsAccessory &&
        !accessorySnapshot?.exists()
      ) {
        throw new Error(
          "アクセサリー実在庫を確認できないため取消できません。"
        );
      }

      const tshirtMaster =
        tshirtSnapshot?.data() ||
        null;

      const tshirtRestore =
        new Map();

      appliedItems
        .filter(
          item =>
            item?.inventorySource ===
            "tshirt"
        )
        .forEach(
          item => {
            const target =
              parseTshirtInventoryKey(
                item?.inventoryKey
              );

            if (!target) {
              throw new Error(
                `${item?.label || "Tシャツ"} の在庫キーが不正なため取消できません。`
              );
            }

            const key =
              [
                target.bodyId,
                target.designId,
                target.colorId,
                target.sizeId
              ].join("|");

            const existing =
              tshirtRestore.get(
                key
              );

            if (existing) {
              existing.quantity +=
                Math.max(
                  0,
                  Math.floor(
                    safeNumber(
                      item?.quantity
                    )
                  )
                );
            } else {
              tshirtRestore.set(
                key,
                {
                  target,
                  quantity:
                    Math.max(
                      0,
                      Math.floor(
                        safeNumber(
                          item?.quantity
                        )
                      )
                    )
                }
              );
            }
          }
        );

      let accessoryDesigns =
        Array.isArray(
          accessorySnapshot
            ?.data()
            ?.designs
        )
          ? accessorySnapshot
              .data()
              .designs
              .map(
                item => ({
                  ...item
                })
              )
          : [];

      appliedItems
        .filter(
          item =>
            item?.inventorySource ===
            "accessory"
        )
        .forEach(
          item => {
            const target =
              parseAccessoryInventoryKey(
                item?.inventoryKey
              );

            if (!target) {
              throw new Error(
                `${item?.label || "アクセサリー"} の在庫キーが不正なため取消できません。`
              );
            }

            const index =
              accessoryDesigns
                .findIndex(
                  design =>
                    String(
                      design?.id ||
                      ""
                    ) ===
                    target.sourceId
                );

            if (index < 0) {
              throw new Error(
                `${item?.label || "アクセサリー"} の実在庫が見つからないため取消できません。`
              );
            }

            const quantity =
              Math.max(
                0,
                Math.floor(
                  safeNumber(
                    item?.quantity
                  )
                )
              );

            const currentQty =
              Math.max(
                0,
                Number(
                  accessoryDesigns[
                    index
                  ]?.[
                    target.stockField
                  ] || 0
                )
              );

            accessoryDesigns[
              index
            ][
              target.stockField
            ] =
              currentQty +
              quantity;
          }
        );

      /*
       * All reads are complete. Writes start here.
       */
      if (
        tshirtRestore.size
      ) {
        const args = [
          tshirtMasterRef
        ];

        tshirtRestore
          .forEach(
            entry => {
              const currentQty =
                readTshirtQty(
                  tshirtMaster,
                  entry.target
                );

              args.push(
                new FieldPath(
                  "inventory_v2",
                  entry.target.bodyId,
                  entry.target.designId,
                  entry.target.colorId,
                  entry.target.sizeId,
                  "qty"
                )
              );

              args.push(
                currentQty +
                entry.quantity
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

      if (needsAccessory) {
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

      const currentSummary =
        session?.salesSummary ||
        {};

      const nextSummary = {
        ...currentSummary,

        grossSales:
          Math.max(
            0,
            safeNumber(
              currentSummary.grossSales
            ) -
            safeNumber(
              sale?.grossSales
            )
          ),

        setDiscount:
          Math.max(
            0,
            safeNumber(
              currentSummary.setDiscount
            ) -
            safeNumber(
              sale?.setDiscount
            )
          ),

        lineDiscount:
          Math.max(
            0,
            safeNumber(
              currentSummary.lineDiscount
            ) -
            safeNumber(
              sale?.lineDiscount
            )
          ),

        orderDiscount:
          Math.max(
            0,
            safeNumber(
              currentSummary.orderDiscount
            ) -
            safeNumber(
              sale?.orderDiscount
            )
          ),

        discount:
          Math.max(
            0,
            safeNumber(
              currentSummary.discount
            ) -
            safeNumber(
              sale?.discount
            )
          ),

        netSales:
          Math.max(
            0,
            safeNumber(
              currentSummary.netSales
            ) -
            safeNumber(
              sale?.netSales
            )
          ),

        transactionCount:
          Math.max(
            0,
            Math.floor(
              safeNumber(
                currentSummary
                  .transactionCount
              )
            ) -
            1
          ),

        itemCount:
          Math.max(
            0,
            Math.floor(
              safeNumber(
                currentSummary
                  .itemCount
              )
            ) -
            Math.floor(
              safeNumber(
                sale?.itemCount
              )
            )
          )
      };

      if (
        sale?.grossSalesJPY !==
        null &&
        sale?.grossSalesJPY !==
        undefined
      ) {
        nextSummary.grossSalesJPY =
          Math.max(
            0,
            safeNumber(
              currentSummary.grossSalesJPY
            ) -
            safeNumber(
              sale.grossSalesJPY
            )
          );
      }

      if (
        sale?.setDiscountJPY !==
        null &&
        sale?.setDiscountJPY !==
        undefined
      ) {
        nextSummary.setDiscountJPY =
          Math.max(
            0,
            safeNumber(
              currentSummary.setDiscountJPY
            ) -
            safeNumber(
              sale.setDiscountJPY
            )
          );
      }

      if (
        sale?.lineDiscountJPY !==
        null &&
        sale?.lineDiscountJPY !==
        undefined
      ) {
        nextSummary.lineDiscountJPY =
          Math.max(
            0,
            safeNumber(
              currentSummary.lineDiscountJPY
            ) -
            safeNumber(
              sale.lineDiscountJPY
            )
          );
      }

      if (
        sale?.orderDiscountJPY !==
        null &&
        sale?.orderDiscountJPY !==
        undefined
      ) {
        nextSummary.orderDiscountJPY =
          Math.max(
            0,
            safeNumber(
              currentSummary.orderDiscountJPY
            ) -
            safeNumber(
              sale.orderDiscountJPY
            )
          );
      }

      if (
        sale?.discountJPY !==
        null &&
        sale?.discountJPY !==
        undefined
      ) {
        nextSummary.discountJPY =
          Math.max(
            0,
            safeNumber(
              currentSummary.discountJPY
            ) -
            safeNumber(
              sale.discountJPY
            )
          );
      }

      if (
        sale?.netSalesJPY !==
        null &&
        sale?.netSalesJPY !==
        undefined
      ) {
        nextSummary.netSalesJPY =
          Math.max(
            0,
            safeNumber(
              currentSummary.netSalesJPY
            ) -
            safeNumber(
              sale.netSalesJPY
            )
          );
      }

      const sessionUpdate = {
        salesSummary:
          nextSummary,
        lastVoidAt:
          serverTimestamp(),
        updatedAt:
          serverTimestamp()
      };

      if (
        eventAppliedItems.length
      ) {
        sessionUpdate[
          "inventoryCount.soldByVariant"
        ] =
          nextEventSoldByVariant;

        sessionUpdate[
          "inventoryCount.salesUpdatedAt"
        ] =
          serverTimestamp();
      }

      transaction.update(
        sessionRef,
        sessionUpdate
      );

      transaction.update(
        saleRef,
        {
          status:
            "voided",
          voidReason:
            String(
              reason ||
              "manual_void"
            ),
          voidedByEmail:
            String(
              voidedByEmail ||
              ""
            ),
          voidedAt:
            serverTimestamp(),
          updatedAt:
            serverTimestamp()
        }
      );

      transaction.set(
        lockRef,
        {
          transactionId:
            id,
          sessionId,
          status:
            "voided",
          voidedAt:
            serverTimestamp()
        },
        {
          merge:
            true
        }
      );

      items.forEach(
        (item, index) => {
          const quantity =
            Math.max(
              0,
              Math.floor(
                safeNumber(
                  item?.quantity
                )
              )
            );

          const inventoryWasApplied =
            item?.inventoryApplied ===
            true;

          const movementRef =
            doc(
              db,
              "inventoryMovements",
              `${id}__void__${index + 1}`
            );

          transaction.set(
            movementRef,
            {
              movementId:
                `${id}__void__${index + 1}`,
              transactionId:
                id,
              reversalOfTransactionId:
                id,
              sessionId,
              type:
                "return",
              reason:
                "return",
              sourceAction:
                "sale_void",
              category:
                item?.category ||
                "",
              label:
                item?.label ||
                "",
              quantity,
              expectedInventoryDelta:
                inventoryWasApplied
                  ? quantity
                  : 0,
              appliedInventoryDelta:
                inventoryWasApplied
                  ? quantity
                  : 0,
              inventoryApplied:
                inventoryWasApplied,
              trackingMode:
                item?.trackingMode ||
                "quick",
              variantId:
                item?.variantId ||
                null,
              inventoryKey:
                item?.inventoryKey ||
                null,
              inventorySource:
                item?.inventorySource ||
                null,
              status:
                inventoryWasApplied
                  ? "applied"
                  : "not_applied_originally",
              createdAt:
                serverTimestamp()
            }
          );
        }
      );

      return {
        transactionId:
          id,
        duplicate:
          false,
        status:
          "voided",
        restoredItemCount:
          appliedItems.reduce(
            (sum, item) =>
              sum +
              Math.max(
                0,
                Math.floor(
                  safeNumber(
                    item?.quantity
                  )
                )
              ),
            0
          )
      };
    }
  );
}
