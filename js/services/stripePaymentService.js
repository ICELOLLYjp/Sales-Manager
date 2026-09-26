import {
  getApp
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";

import {
  getFunctions,
  httpsCallable
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js";


const REGION =
  "asia-southeast1";

const RECOVERABLE_CACHE_TTL_MS =
  60 * 1000;

const recoverablePaymentCache =
  new Map();

const recoverablePaymentRequests =
  new Map();


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


function recoverableSessionKey(
  sessionId
) {
  return String(
    sessionId ||
    ""
  ).trim();
}


function clonePayments(
  payments
) {
  return (
    Array.isArray(
      payments
    )
      ? payments
      : []
  ).map(
    payment => ({
      ...payment
    })
  );
}


function invalidateRecoverablePayments(
  sessionId = ""
) {
  const key =
    recoverableSessionKey(
      sessionId
    );

  if (key) {
    recoverablePaymentCache
      .delete(
        key
      );

    recoverablePaymentRequests
      .delete(
        key
      );

    return;
  }

  recoverablePaymentCache
    .clear();

  recoverablePaymentRequests
    .clear();
}


export async function createStripeCheckout(
  data
) {
  const result =
    await call(
      "stripeCreateCheckout",
      data
    );

  invalidateRecoverablePayments(
    data?.sessionId
  );

  return result;
}


export async function getStripeCheckoutStatus(
  transactionId
) {
  return await call(
    "stripeGetCheckoutStatus",
    {
      transactionId
    }
  );
}


export async function expireStripeCheckout(
  transactionId
) {
  const result =
    await call(
      "stripeExpireCheckout",
      {
        transactionId
      }
    );

  invalidateRecoverablePayments();

  return result;
}


export async function markStripeSaleCommitted({
  transactionId
}) {
  const result =
    await call(
      "stripeMarkSaleCommitted",
      {
        transactionId
      }
    );

  invalidateRecoverablePayments();

  return result;
}


export async function refundStripePayment({
  transactionId
}) {
  const result =
    await call(
      "stripeRefundPayment",
      {
        transactionId
      }
    );

  invalidateRecoverablePayments();

  return result;
}


export async function listRecoverableStripePayments(
  sessionId
) {
  const key =
    recoverableSessionKey(
      sessionId
    );

  const cached =
    recoverablePaymentCache
      .get(
        key
      );

  if (
    cached &&
    Date.now() -
      cached.savedAt <
      RECOVERABLE_CACHE_TTL_MS
  ) {
    return clonePayments(
      cached.payments
    );
  }

  const pending =
    recoverablePaymentRequests
      .get(
        key
      );

  if (pending) {
    return clonePayments(
      await pending
    );
  }

  const request =
    (async () => {
      const result =
        await call(
          "stripeListRecoverablePayments",
          {
            sessionId
          }
        );

      const payments =
        Array.isArray(
          result?.payments
        )
          ? result.payments
          : [];

      recoverablePaymentCache
        .set(
          key,
          {
            savedAt:
              Date.now(),
            payments:
              clonePayments(
                payments
              )
          }
        );

      return payments;
    })();

  recoverablePaymentRequests
    .set(
      key,
      request
    );

  try {
    return clonePayments(
      await request
    );
  } finally {
    if (
      recoverablePaymentRequests
        .get(
          key
        ) ===
      request
    ) {
      recoverablePaymentRequests
        .delete(
          key
        );
    }
  }
}


let qrScriptPromise =
  null;


async function loadQrScript() {
  if (
    typeof globalThis.QRCode ===
    "function"
  ) {
    return globalThis.QRCode;
  }

  if (
    !qrScriptPromise
  ) {
    qrScriptPromise =
      new Promise(
        (
          resolve,
          reject
        ) => {
          const script =
            document.createElement(
              "script"
            );

          /*
           * qrcodejs exposes a browser-ready QRCode constructor.
           * The previous node-qrcode CDN URL pointed to a build file
           * that is not published on jsDelivr for qrcode@1.5.4.
           */
          script.src =
            "https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js";

          script.async =
            true;

          script.onload =
            () => {
              if (
                typeof globalThis.QRCode ===
                "function"
              ) {
                resolve(
                  globalThis.QRCode
                );
              } else {
                reject(
                  new Error(
                    "QRコードライブラリを読み込めませんでした。"
                  )
                );
              }
            };

          script.onerror =
            () => {
              reject(
                new Error(
                  "QRコードライブラリを読み込めませんでした。"
                )
              );
            };

          document.head
            .appendChild(
              script
            );
        }
      );
  }

  return await qrScriptPromise;
}

export async function renderStripeQr(
  container,
  url
) {
  if (
    !container ||
    !url
  ) {
    return;
  }

  container.innerHTML =
    "";

  try {
    const QRCode =
      await loadQrScript();

    const qrHost =
      document.createElement(
        "div"
      );

    qrHost.style.cssText =
      [
        "display:grid",
        "place-items:center",
        "width:270px",
        "max-width:100%",
        "margin:0 auto"
      ].join(";");

    container.appendChild(
      qrHost
    );

    new QRCode(
      qrHost,
      {
        text:
          url,

        width:
          270,

        height:
          270,

        colorDark:
          "#000000",

        colorLight:
          "#ffffff",

        correctLevel:
          QRCode.CorrectLevel
            ?.M ??
          0
      }
    );

    const rendered =
      qrHost.querySelector(
        "canvas, img"
      );

    if (
      !rendered
    ) {
      throw new Error(
        "QRコードを生成できませんでした。"
      );
    }

    rendered.style.maxWidth =
      "100%";

    rendered.style.height =
      "auto";

    rendered.style.display =
      "block";

  } catch (error) {
    console.error(
      "Stripe QR render failed",
      error
    );

    container.innerHTML =
      "";

    const fallback =
      document.createElement(
        "a"
      );

    fallback.href =
      url;

    fallback.target =
      "_blank";

    fallback.rel =
      "noopener";

    fallback.textContent =
      "Stripe支払いページを開く";

    fallback.style.fontWeight =
      "800";

    container.appendChild(
      fallback
    );
  }
}