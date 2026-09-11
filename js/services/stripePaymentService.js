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
