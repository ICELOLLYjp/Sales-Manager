const CONFIRM_OVERLAY_ID = "stripeCompletionConfirmOverlay";

function completionLeftOffset() {
  return window.matchMedia("(min-width: 760px)").matches
    ? "200px"
    : "0";
}

function showStripeCompletionConfirm() {
  if (document.getElementById(CONFIRM_OVERLAY_ID)) return;

  const overlay = document.createElement("div");
  overlay.id = CONFIRM_OVERLAY_ID;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Stripe支払い完了");
  overlay.style.cssText = [
    "position:fixed",
    "top:0",
    "right:0",
    "bottom:0",
    `left:${completionLeftOffset()}`,
    "z-index:20000",
    "display:grid",
    "place-items:center",
    "padding:20px",
    "background:rgba(245,245,242,.96)",
    "backdrop-filter:blur(4px)",
    "-webkit-backdrop-filter:blur(4px)"
  ].join(";");

  overlay.innerHTML = `
    <div
      style="
        width:min(100%,420px);
        padding:28px 22px 22px;
        border:1px solid #e2e2dd;
        border-radius:22px;
        background:#fff;
        box-shadow:0 18px 60px rgba(0,0,0,.16);
        text-align:center;
      "
    >
      <div
        style="
          width:64px;
          height:64px;
          margin:0 auto;
          border-radius:50%;
          display:grid;
          place-items:center;
          background:#edf8ef;
          color:#22683b;
          font:900 34px/1 system-ui,sans-serif;
        "
        aria-hidden="true"
      >
        ✓
      </div>

      <div
        style="
          margin-top:16px;
          font:900 26px/1.25 system-ui,sans-serif;
          color:#1f1f1f;
        "
      >
        支払い完了
      </div>

      <div
        style="
          margin-top:10px;
          font:700 14px/1.6 system-ui,sans-serif;
          color:#555;
        "
      >
        Stripe決済と売上保存が完了しました。<br>
        内容を確認して OK を押してください。
      </div>

      <button
        id="stripeCompletionConfirmButton"
        type="button"
        style="
          width:100%;
          min-height:58px;
          margin-top:22px;
          border:0;
          border-radius:15px;
          background:#635bff;
          color:#fff;
          font:900 18px system-ui,sans-serif;
          touch-action:manipulation;
        "
      >
        OK
      </button>
    </div>
  `;

  document.body.appendChild(overlay);

  const button = overlay.querySelector("#stripeCompletionConfirmButton");
  button?.focus({ preventScroll: true });
  button?.addEventListener("click", () => {
    overlay.remove();
  }, { once: true });
}

function checkStripeCompletion() {
  const normalState = document.querySelector(
    "#stripePaymentOverlay #stripePaymentState"
  );

  if (normalState) {
    const complete = String(normalState.textContent || "")
      .includes("支払い・会計完了");

    if (complete && normalState.dataset.confirmSeen !== "1") {
      normalState.dataset.confirmSeen = "1";
      showStripeCompletionConfirm();
    } else if (!complete) {
      delete normalState.dataset.confirmSeen;
    }
  }

  const fastStatus = document.querySelector(
    "#fastPosOverlay #fpStatus"
  );

  if (fastStatus) {
    const complete = String(fastStatus.textContent || "")
      .includes("Stripe支払い完了");

    if (complete && fastStatus.dataset.confirmSeen !== "1") {
      fastStatus.dataset.confirmSeen = "1";
      showStripeCompletionConfirm();
    } else if (!complete) {
      delete fastStatus.dataset.confirmSeen;
    }
  }
}

new MutationObserver(checkStripeCompletion).observe(
  document.body,
  {
    childList: true,
    subtree: true,
    characterData: true
  }
);

window.addEventListener("resize", () => {
  const overlay = document.getElementById(CONFIRM_OVERLAY_ID);
  if (overlay) overlay.style.left = completionLeftOffset();
});

checkStripeCompletion();
