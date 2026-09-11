"use strict";

const {
  setGlobalOptions
} = require(
  "firebase-functions/v2"
);

const {
  onCall,
  onRequest,
  HttpsError
} = require(
  "firebase-functions/v2/https"
);

const {
  defineSecret
} = require(
  "firebase-functions/params"
);

const {
  initializeApp
} = require(
  "firebase-admin/app"
);

const {
  getFirestore,
  FieldValue
} = require(
  "firebase-admin/firestore"
);

const Stripe =
  require(
    "stripe"
  );


initializeApp();

setGlobalOptions({
  region:
    "asia-southeast1",

  memory:
    "256MiB",

  timeoutSeconds:
    60,

  maxInstances:
    10
});


const STRIPE_SECRET_KEY =
  defineSecret(
    "STRIPE_SECRET_KEY"
  );

const STRIPE_WEBHOOK_SECRET =
  defineSecret(
    "STRIPE_WEBHOOK_SECRET"
  );

const STRIPE_ALLOWED_EMAILS =
  defineSecret(
    "STRIPE_ALLOWED_EMAILS"
  );


const APP_ORIGIN =
  "https://icelollyjp.github.io";

const RESULT_URL =
  "https://icelollyjp.github.io/Sales-Manager/stripe-result.html";

const ALLOWED_CURRENCIES =
  new Set([
    "JPY",
    "SGD",
    "TWD",
    "HKD",
    "THB",
    "USD"
  ]);

const ZERO_DECIMAL_CURRENCIES =
  new Set([
    "JPY"
  ]);


function stripeClient() {
  return new Stripe(
    STRIPE_SECRET_KEY.value()
  );
}


function allowedEmails() {
  return new Set(
    String(
      STRIPE_ALLOWED_EMAILS
        .value() ||
      ""
    )
      .split(",")
      .map(
        value =>
          value
            .trim()
            .toLowerCase()
      )
      .filter(Boolean)
  );
}


function requireStaff(
  request
) {
  const email =
    String(
      request.auth
        ?.token
        ?.email ||
      ""
    )
      .trim()
      .toLowerCase();

  const verified =
    request.auth
      ?.token
      ?.email_verified !==
    false;

  if (
    !request.auth ||
    !email ||
    !verified ||
    !allowedEmails().has(
      email
    )
  ) {
    throw new HttpsError(
      "permission-denied",
      "Stripe決済を利用する権限がありません。"
    );
  }

  return email;
}


function cleanText(
  value,
  max =
    200
) {
  return String(
    value || ""
  )
    .trim()
    .slice(
      0,
      max
    );
}


function positiveInt(
  value
) {
  const number =
    Math.floor(
      Number(
        value || 0
      )
    );

  return Number.isFinite(
    number
  ) &&
    number >
      0
    ? number
    : 0;
}


function money(
  value
) {
  const number =
    Number(
      value || 0
    );

  return Number.isFinite(
    number
  )
    ? Math.max(
        0,
        number
      )
    : 0;
}


function normalizeSalePayload(
  input
) {
  const transactionId =
    cleanText(
      input?.transactionId,
      160
    );

  const sessionId =
    cleanText(
      input?.sessionId,
      160
    );

  const items =
    (
      Array.isArray(
        input?.items
      )
        ? input.items
        : []
    )
      .map(
        item => ({
          lineId:
            cleanText(
              item?.lineId,
              200
            ),

          category:
            cleanText(
              item?.category,
              80
            ),

          label:
            cleanText(
              item?.label,
              240
            ),

          quantity:
            positiveInt(
              item?.quantity
            ),

          unitPrice:
            money(
              item?.unitPrice
            ),

          trackingMode:
            cleanText(
              item?.trackingMode,
              40
            ) ||
            "quick",

          variantId:
            item?.variantId
              ? cleanText(
                  item.variantId,
                  300
                )
              : null,

          inventoryKey:
            item?.inventoryKey
              ? cleanText(
                  item.inventoryKey,
                  500
                )
              : null,

          setDiscount:
            money(
              item?.setDiscount
            ),

          manualDiscount:
            money(
              item?.manualDiscount
            ),

          setOffer:
            {
              quantity:
                positiveInt(
                  item
                    ?.setOffer
                    ?.quantity
                ),

              price:
                money(
                  item
                    ?.setOffer
                    ?.price
                )
            }
        })
      )
      .filter(
        item =>
          item.category &&
          item.quantity >
            0
      );

  const orderDiscount =
    money(
      input?.orderDiscount
    );

  const createdByEmail =
    cleanText(
      input?.createdByEmail,
      240
    );

  if (
    !transactionId ||
    !sessionId ||
    !items.length
  ) {
    throw new HttpsError(
      "invalid-argument",
      "Stripe会計データが不足しています。"
    );
  }

  return {
    transactionId,
    sessionId,
    items,
    orderDiscount,
    createdByEmail
  };
}


function calculateSaleTotal(
  sale
) {
  const gross =
    sale.items.reduce(
      (
        sum,
        item
      ) =>
        sum +
        (
          item.unitPrice *
          item.quantity
        ),
      0
    );

  const itemDiscount =
    sale.items.reduce(
      (
        sum,
        item
      ) =>
        sum +
        item.setDiscount +
        item.manualDiscount,
      0
    );

  return Math.max(
    0,
    gross -
    itemDiscount -
    sale.orderDiscount
  );
}


function toMinorUnit(
  amount,
  currency
) {
  const multiplier =
    ZERO_DECIMAL_CURRENCIES
      .has(
        currency
      )
      ? 1
      : 100;

  return Math.round(
    amount *
    multiplier
  );
}


function serializeCheckout(
  session
) {
  const paymentIntent =
    typeof session
      .payment_intent ===
    "object"
      ? session
          .payment_intent
          ?.id
      : session
          .payment_intent;

  return {
    checkoutSessionId:
      session.id,

    url:
      session.url ||
      null,

    status:
      session.status ||
      null,

    paymentStatus:
      session.payment_status ||
      null,

    paymentIntentId:
      paymentIntent ||
      null,

    amountTotal:
      session.amount_total ??
      null,

    currency:
      session.currency
        ? String(
            session.currency
          ).toUpperCase()
        : null,

    expiresAt:
      session.expires_at ||
      null,

    livemode:
      session.livemode ===
      true
  };
}


async function paymentDoc(
  transactionId
) {
  return getFirestore()
    .collection(
      "stripePayments"
    )
    .doc(
      transactionId
    );
}


exports.stripeCreateCheckout =
  onCall(
    {
      secrets: [
        STRIPE_SECRET_KEY,
        STRIPE_ALLOWED_EMAILS
      ],

      cors: [
        APP_ORIGIN
      ]
    },

    async request => {
      const staffEmail =
        requireStaff(
          request
        );

      const sale =
        normalizeSalePayload(
          request.data
            ?.salePayload
        );

      const db =
        getFirestore();

      const sessionRef =
        db.collection(
          "salesSessions"
        )
          .doc(
            sale.sessionId
          );

      const [
        sessionSnapshot,
        existingSaleSnapshot,
        paymentSnapshot
      ] =
        await Promise.all([
          sessionRef.get(),

          db.collection(
            "salesTransactions"
          )
            .doc(
              sale.transactionId
            )
            .get(),

          (
            await paymentDoc(
              sale.transactionId
            )
          ).get()
        ]);

      if (
        !sessionSnapshot.exists
      ) {
        throw new HttpsError(
          "not-found",
          "販売セッションが見つかりません。"
        );
      }

      const salesSession =
        sessionSnapshot.data() ||
        {};

      if (
        salesSession.status !==
        "open"
      ) {
        throw new HttpsError(
          "failed-precondition",
          "終了済みの販売セッションではStripe決済できません。"
        );
      }

      if (
        existingSaleSnapshot.exists
      ) {
        throw new HttpsError(
          "already-exists",
          "このtransaction IDはすでに売上登録済みです。"
        );
      }

      const currency =
        cleanText(
          salesSession.currency,
          10
        )
          .toUpperCase();

      if (
        !ALLOWED_CURRENCIES.has(
          currency
        )
      ) {
        throw new HttpsError(
          "failed-precondition",
          `Stripe未対応の通貨です: ${currency}`
        );
      }

      const total =
        calculateSaleTotal(
          sale
        );

      if (
        total <=
        0
      ) {
        throw new HttpsError(
          "invalid-argument",
          "Stripe決済金額は0より大きい必要があります。"
        );
      }

      const docRef =
        await paymentDoc(
          sale.transactionId
        );

      if (
        paymentSnapshot.exists
      ) {
        const existing =
          paymentSnapshot.data() ||
          {};

        if (
          existing.checkoutSessionId
        ) {
          try {
            const stripe =
              stripeClient();

            const checkout =
              await stripe
                .checkout
                .sessions
                .retrieve(
                  existing
                    .checkoutSessionId,
                  {
                    expand: [
                      "payment_intent"
                    ]
                  }
                );

            if (
              checkout.status !==
              "expired"
            ) {
              return {
                transactionId:
                  sale.transactionId,

                ...serializeCheckout(
                  checkout
                )
              };
            }

          } catch (
            error
          ) {
            console.warn(
              "Existing Checkout lookup failed",
              error
            );
          }
        }
      }

      const stripe =
        stripeClient();

      const checkout =
        await stripe
          .checkout
          .sessions
          .create(
            {
              mode:
                "payment",

              client_reference_id:
                sale.transactionId,

              line_items: [
                {
                  quantity:
                    1,

                  price_data: {
                    currency:
                      currency
                        .toLowerCase(),

                    unit_amount:
                      toMinorUnit(
                        total,
                        currency
                      ),

                    product_data: {
                      name:
                        "ICELOLLY purchase",

                      description:
                        cleanText(
                          salesSession
                            .eventName ||
                          salesSession
                            .name ||
                          "Event purchase",
                          200
                        )
                    }
                  }
                }
              ],

              success_url:
                `${RESULT_URL}?result=success&session_id={CHECKOUT_SESSION_ID}`,

              cancel_url:
                `${RESULT_URL}?result=cancel`,

              expires_at:
                Math.floor(
                  Date.now() /
                  1000
                ) +
                1860,

              metadata: {
                transactionId:
                  sale.transactionId,

                salesSessionId:
                  sale.sessionId,

                operatorEmail:
                  staffEmail,

                itemCount:
                  String(
                    sale.items.reduce(
                      (
                        sum,
                        item
                      ) =>
                        sum +
                        item.quantity,
                      0
                    )
                  )
              },

              payment_intent_data: {
                metadata: {
                  transactionId:
                    sale.transactionId,

                  salesSessionId:
                    sale.sessionId
                }
              }
            },
            {
              idempotencyKey:
                `checkout_${sale.transactionId}`
            }
          );

      await docRef.set(
        {
          transactionId:
            sale.transactionId,

          salesSessionId:
            sale.sessionId,

          checkoutSessionId:
            checkout.id,

          paymentIntentId:
            null,

          currency,

          amount:
            total,

          amountMinor:
            toMinorUnit(
              total,
              currency
            ),

          itemCount:
            sale.items.reduce(
              (
                sum,
                item
              ) =>
                sum +
                item.quantity,
              0
            ),

          salePayload:
            sale,

          paymentStatus:
            checkout
              .payment_status ||
            "unpaid",

          checkoutStatus:
            checkout.status ||
            "open",

          committed:
            false,

          operatorEmail:
            staffEmail,

          livemode:
            checkout.livemode ===
            true,

          createdAt:
            FieldValue
              .serverTimestamp(),

          updatedAt:
            FieldValue
              .serverTimestamp()
        },
        {
          merge:
            true
        }
      );

      return {
        transactionId:
          sale.transactionId,

        ...serializeCheckout(
          checkout
        )
      };
    }
  );


exports.stripeGetCheckoutStatus =
  onCall(
    {
      secrets: [
        STRIPE_SECRET_KEY,
        STRIPE_ALLOWED_EMAILS
      ],

      cors: [
        APP_ORIGIN
      ]
    },

    async request => {
      requireStaff(
        request
      );

      const transactionId =
        cleanText(
          request.data
            ?.transactionId,
          160
        );

      if (!transactionId) {
        throw new HttpsError(
          "invalid-argument",
          "transactionIdが必要です。"
        );
      }

      const ref =
        await paymentDoc(
          transactionId
        );

      const snapshot =
        await ref.get();

      if (!snapshot.exists) {
        throw new HttpsError(
          "not-found",
          "Stripe会計が見つかりません。"
        );
      }

      const payment =
        snapshot.data() ||
        {};

      const stripe =
        stripeClient();

      const checkout =
        await stripe
          .checkout
          .sessions
          .retrieve(
            payment.checkoutSessionId,
            {
              expand: [
                "payment_intent"
              ]
            }
          );

      const serialized =
        serializeCheckout(
          checkout
        );

      await ref.set(
        {
          paymentStatus:
            serialized
              .paymentStatus,

          checkoutStatus:
            serialized.status,

          paymentIntentId:
            serialized
              .paymentIntentId ||
            payment
              .paymentIntentId ||
            null,

          updatedAt:
            FieldValue
              .serverTimestamp()
        },
        {
          merge:
            true
        }
      );

      return {
        transactionId,
        committed:
          payment.committed ===
          true,

        ...serialized
      };
    }
  );


exports.stripeExpireCheckout =
  onCall(
    {
      secrets: [
        STRIPE_SECRET_KEY,
        STRIPE_ALLOWED_EMAILS
      ],

      cors: [
        APP_ORIGIN
      ]
    },

    async request => {
      requireStaff(
        request
      );

      const transactionId =
        cleanText(
          request.data
            ?.transactionId,
          160
        );

      const ref =
        await paymentDoc(
          transactionId
        );

      const snapshot =
        await ref.get();

      if (!snapshot.exists) {
        return {
          expired:
            true
        };
      }

      const payment =
        snapshot.data() ||
        {};

      const stripe =
        stripeClient();

      let checkout =
        await stripe
          .checkout
          .sessions
          .retrieve(
            payment.checkoutSessionId
          );

      if (
        checkout.status ===
        "open" &&
        checkout.payment_status !==
        "paid"
      ) {
        checkout =
          await stripe
            .checkout
            .sessions
            .expire(
              payment.checkoutSessionId
            );
      }

      await ref.set(
        {
          checkoutStatus:
            checkout.status,

          paymentStatus:
            checkout
              .payment_status,

          expiredAt:
            FieldValue
              .serverTimestamp(),

          updatedAt:
            FieldValue
              .serverTimestamp()
        },
        {
          merge:
            true
        }
      );

      return {
        expired:
          checkout.status ===
          "expired",

        paymentStatus:
          checkout
            .payment_status
      };
    }
  );


exports.stripeMarkSaleCommitted =
  onCall(
    {
      secrets: [
        STRIPE_ALLOWED_EMAILS
      ],

      cors: [
        APP_ORIGIN
      ]
    },

    async request => {
      requireStaff(
        request
      );

      const transactionId =
        cleanText(
          request.data
            ?.transactionId,
          160
        );

      if (!transactionId) {
        throw new HttpsError(
          "invalid-argument",
          "transactionIdが必要です。"
        );
      }

      const db =
        getFirestore();

      const saleSnapshot =
        await db.collection(
          "salesTransactions"
        )
          .doc(
            transactionId
          )
          .get();

      if (
        !saleSnapshot.exists
      ) {
        throw new HttpsError(
          "failed-precondition",
          "Sales Manager側の売上保存が確認できません。"
        );
      }

      const ref =
        await paymentDoc(
          transactionId
        );

      await ref.set(
        {
          committed:
            true,

          committedAt:
            FieldValue
              .serverTimestamp(),

          updatedAt:
            FieldValue
              .serverTimestamp()
        },
        {
          merge:
            true
        }
      );

      return {
        committed:
          true
      };
    }
  );


exports.stripeListRecoverablePayments =
  onCall(
    {
      secrets: [
        STRIPE_ALLOWED_EMAILS
      ],

      cors: [
        APP_ORIGIN
      ]
    },

    async request => {
      requireStaff(
        request
      );

      const sessionId =
        cleanText(
          request.data
            ?.sessionId,
          160
        );

      if (!sessionId) {
        return {
          payments:
            []
        };
      }

      const db =
        getFirestore();

      /*
       * ICELOLLY's volume is small enough that scanning the compact
       * stripePayments collection avoids requiring a composite Firestore index.
       */
      const snapshot =
        await db.collection(
          "stripePayments"
        )
          .limit(
            300
          )
          .get();

      const payments =
        [];

      for (
        const doc of
        snapshot.docs
      ) {
        const data =
          doc.data() ||
          {};

        if (
          data.salesSessionId !==
            sessionId ||
          data.paymentStatus !==
            "paid" ||
          data.committed ===
            true
        ) {
          continue;
        }

        const saleSnapshot =
          await db.collection(
            "salesTransactions"
          )
            .doc(
              doc.id
            )
            .get();

        if (
          saleSnapshot.exists
        ) {
          /*
           * Sale already exists; repair only the Stripe marker.
           */
          await doc.ref.set(
            {
              committed:
                true,

              committedAt:
                FieldValue
                  .serverTimestamp(),

              updatedAt:
                FieldValue
                  .serverTimestamp()
            },
            {
              merge:
                true
            }
          );

          continue;
        }

        payments.push({
          transactionId:
            doc.id,

          salesSessionId:
            data.salesSessionId,

          checkoutSessionId:
            data.checkoutSessionId,

          paymentIntentId:
            data.paymentIntentId ||
            null,

          currency:
            data.currency,

          amount:
            data.amount,

          itemCount:
            data.itemCount,

          salePayload:
            data.salePayload,

          livemode:
            data.livemode ===
            true
        });
      }

      return {
        payments
      };
    }
  );


exports.stripeRefundPayment =
  onCall(
    {
      secrets: [
        STRIPE_SECRET_KEY,
        STRIPE_ALLOWED_EMAILS
      ],

      cors: [
        APP_ORIGIN
      ]
    },

    async request => {
      const staffEmail =
        requireStaff(
          request
        );

      const transactionId =
        cleanText(
          request.data
            ?.transactionId,
          160
        );

      if (!transactionId) {
        throw new HttpsError(
          "invalid-argument",
          "transactionIdが必要です。"
        );
      }

      const ref =
        await paymentDoc(
          transactionId
        );

      const snapshot =
        await ref.get();

      if (!snapshot.exists) {
        throw new HttpsError(
          "not-found",
          "Stripe決済記録が見つかりません。"
        );
      }

      const payment =
        snapshot.data() ||
        {};

      if (
        payment.refundStatus ===
        "succeeded"
      ) {
        return {
          refunded:
            true,

          refundId:
            payment.refundId ||
            null,

          status:
            "succeeded"
        };
      }

      const stripe =
        stripeClient();

      let paymentIntentId =
        payment.paymentIntentId;

      if (!paymentIntentId) {
        const checkout =
          await stripe
            .checkout
            .sessions
            .retrieve(
              payment.checkoutSessionId
            );

        paymentIntentId =
          typeof checkout
            .payment_intent ===
          "string"
            ? checkout
                .payment_intent
            : checkout
                .payment_intent
                ?.id;
      }

      if (!paymentIntentId) {
        throw new HttpsError(
          "failed-precondition",
          "Stripe PaymentIntentが見つかりません。"
        );
      }

      const refund =
        await stripe.refunds
          .create(
            {
              payment_intent:
                paymentIntentId,

              metadata: {
                transactionId,
                refundedBy:
                  staffEmail
              }
            },
            {
              idempotencyKey:
                `refund_${transactionId}`
            }
          );

      await ref.set(
        {
          paymentIntentId,

          refundId:
            refund.id,

          refundStatus:
            refund.status,

          refundedBy:
            staffEmail,

          refundedAt:
            FieldValue
              .serverTimestamp(),

          updatedAt:
            FieldValue
              .serverTimestamp()
        },
        {
          merge:
            true
        }
      );

      if (
        refund.status !==
        "succeeded"
      ) {
        throw new HttpsError(
          "aborted",
          `Stripe返金は ${refund.status} 状態です。売上取消はまだ実行しません。`
        );
      }

      return {
        refunded:
          true,

        refundId:
          refund.id,

        status:
          refund.status
      };
    }
  );


exports.stripeWebhook =
  onRequest(
    {
      secrets: [
        STRIPE_SECRET_KEY,
        STRIPE_WEBHOOK_SECRET
      ],

      cors:
        false
    },

    async (
      req,
      res
    ) => {
      if (
        req.method !==
        "POST"
      ) {
        res.status(
          405
        ).send(
          "Method Not Allowed"
        );

        return;
      }

      const signature =
        req.headers[
          "stripe-signature"
        ];

      let event;

      try {
        const stripe =
          stripeClient();

        event =
          stripe.webhooks
            .constructEvent(
              req.rawBody,
              signature,
              STRIPE_WEBHOOK_SECRET
                .value()
            );

      } catch (error) {
        console.error(
          "Stripe webhook signature error",
          error
        );

        res.status(
          400
        ).send(
          "Invalid signature"
        );

        return;
      }

      try {
        const object =
          event.data.object;

        if (
          event.type ===
            "checkout.session.completed" ||
          event.type ===
            "checkout.session.async_payment_succeeded" ||
          event.type ===
            "checkout.session.expired"
        ) {
          const transactionId =
            cleanText(
              object
                .client_reference_id ||
              object
                .metadata
                ?.transactionId,
              160
            );

          if (
            transactionId
          ) {
            const ref =
              await paymentDoc(
                transactionId
              );

            const paymentIntentId =
              typeof object
                .payment_intent ===
              "string"
                ? object
                    .payment_intent
                : object
                    .payment_intent
                    ?.id;

            await ref.set(
              {
                checkoutSessionId:
                  object.id,

                checkoutStatus:
                  object.status ||
                  null,

                paymentStatus:
                  object
                    .payment_status ||
                  (
                    event.type ===
                      "checkout.session.async_payment_succeeded"
                      ? "paid"
                      : null
                  ),

                paymentIntentId:
                  paymentIntentId ||
                  null,

                stripeEventId:
                  event.id,

                webhookUpdatedAt:
                  FieldValue
                    .serverTimestamp(),

                updatedAt:
                  FieldValue
                    .serverTimestamp()
              },
              {
                merge:
                  true
              }
            );
          }
        }

        res.status(
          200
        ).json({
          received:
            true
        });

      } catch (error) {
        console.error(
          "Stripe webhook handler error",
          error
        );

        res.status(
          500
        ).send(
          "Webhook processing failed"
        );
      }
    }
  );
