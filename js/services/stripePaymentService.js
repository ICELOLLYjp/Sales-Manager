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


export async function createStripeCheckout(
  data
) {
  return await call(
    "stripeCreateCheckout",
    data
  );
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
  return await call(
    "stripeExpireCheckout",
    {
      transactionId
    }
  );
}


export async function markStripeSaleCommitted({
  transactionId
}) {
  return await call(
    "stripeMarkSaleCommitted",
    {
      transactionId
    }
  );
}


export async function refundStripePayment({
  transactionId
}) {
  return await call(
    "stripeRefundPayment",
    {
      transactionId
    }
  );
}


export async function listRecoverableStripePayments(
  sessionId
) {
  const result =
    await call(
      "stripeListRecoverablePayments",
      {
        sessionId
      }
    );

  return Array.isArray(
    result?.payments
  )
    ? result.payments
    : [];
}


let qrScriptPromise =
  null;


async function loadQrScript() {
  if (
    globalThis.QRCode
      ?.toCanvas
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

          script.src =
            "https://cdn.jsdelivr.net/npm/qrcode@1.5.4/build/qrcode.min.js";

          script.async =
            true;

          script.onload =
            () => {
              if (
                globalThis.QRCode
                  ?.toCanvas
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

    const canvas =
      document.createElement(
        "canvas"
      );

    await QRCode.toCanvas(
      canvas,
      url,
      {
        width:
          270,

        margin:
          1,

        errorCorrectionLevel:
          "M"
      }
    );

    canvas.style.maxWidth =
      "100%";

    canvas.style.height =
      "auto";

    container.appendChild(
      canvas
    );

  } catch (error) {
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
