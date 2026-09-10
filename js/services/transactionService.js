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

        grossLineTotal:
          quantity * unitPrice,

        trackingMode:
          String(
            item?.trackingMode ||
            "quick"
          ),

        variantId:
          item?.variantId || null,

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

function fingerprintFor({
  sessionId,
  currency,
  items,
  discount
}) {
  return JSON.stringify({
    sessionId,
    currency,
    discount,
    items: items.map(
      item => ({
        category:
          item.category,
        quantity:
          item.quantity,
        unitPrice:
          item.unitPrice,
        trackingMode:
          item.trackingMode,
        variantId:
          item.variantId || null
      })
    )
  });
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
    normalizeItems(
      items
    );

  if (!normalizedItems.length) {
    throw new Error(
      "会計する商品がありません。"
    );
  }

  const subtotal =
    normalizedItems.reduce(
      (sum, item) =>
        sum +
        item.grossLineTotal,
      0
    );

  const itemCount =
    normalizedItems.reduce(
      (sum, item) =>
        sum +
        item.quantity,
      0
    );

  const discount =
    Math.max(
      0,
      Math.min(
        safeNumber(
          orderDiscount
        ),
        subtotal
      )
    );

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
    serverTimestamp
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
          session?.status !==
          "open"
        ) {
          throw new Error(
            "この販売セッションは終了しています。"
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

        if (
          lockSnapshot.exists()
        ) {
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
            transactionId:
              id,
            duplicate:
              true,
            currency,
            subtotal,
            discount,
            netSales,
            itemCount
          };
        }

        const fxRateToJPY =
          currency === "JPY"
            ? 1
            : (
                Number(
                  session
                    ?.fxRateToJPY ||
                  0
                ) > 0
                  ? Number(
                      session
                        .fxRateToJPY
                    )
                  : null
              );

        const grossSalesJPY =
          fxRateToJPY
            ? subtotal *
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

          mode:
            "quick",

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

          discount,

          netSales,

          grossSalesJPY,

          discountJPY,

          netSalesJPY,

          itemCount,

          lineCount:
            normalizedItems.length,

          items:
            normalizedItems.map(
              item => ({
                ...item,
                inventoryApplied:
                  false,
                reconciliationStatus:
                  "pending_allocation"
              })
            ),

          inventoryMode:
            "unallocated_quick",

          inventoryApplied:
            false,

          reconciliationStatus:
            "pending_allocation",

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

        normalizedItems.forEach(
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
                  0,

                inventoryApplied:
                  false,

                trackingMode:
                  item.trackingMode,

                variantId:
                  item.variantId ||
                  null,

                inventoryKey:
                  item.inventoryKey ||
                  null,

                status:
                  "pending_allocation",

                createdAt:
                  serverTimestamp()
              }
            );
          }
        );

        const sessionUpdate = {
          "salesSummary.grossSales":
            increment(
              subtotal
            ),

          "salesSummary.discount":
            increment(
              discount
            ),

          "salesSummary.netSales":
            increment(
              netSales
            ),

          "salesSummary.transactionCount":
            increment(
              1
            ),

          "salesSummary.itemCount":
            increment(
              itemCount
            ),

          lastTransactionAt:
            serverTimestamp(),

          updatedAt:
            serverTimestamp()
        };

        if (fxRateToJPY) {
          sessionUpdate[
            "salesSummary.grossSalesJPY"
          ] =
            increment(
              grossSalesJPY
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
          discount,
          netSales,
          itemCount,
          fxRateToJPY,
          netSalesJPY
        };
      }
    );

  return result;
}
