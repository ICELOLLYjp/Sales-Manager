import { getFirebaseState } from "./firebase.js";
import {
  buildFastAmountSalePayload,
  commitFastAmountSale,
  queueFastAmountSale,
  normalizeFastAmountSalesForSession
} from "./services/fastAmountSaleService.js?v=20260916-fast-pos-1";
import {
  createStripeCheckout,
  getStripeCheckoutStatus,
  expireStripeCheckout,
  markStripeSaleCommitted,
  renderStripeQr
} from "./services/stripePaymentService.js?v=20260912-stripe-live-short-ui-1";
import { loadPosOfflineSnapshot } from "./services/offlineQueueService.js?v=20260911-offline-resilience-1";

const BUTTON_ID = "fastPosOpenButton";
const OVERLAY_ID = "fastPosOverlay";
let stripeToken = 0;

function text(value) {
  return String(value ?? "").trim();
}

function email() {
  return text(getFirebaseState()?.auth?.currentUser?.email);
}

function esc(value) {
  return text(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function activeSessionId() {
  return text(localStorage.getItem("icelolly-sales-active-session"));
}

function formatAmount(amount, currency) {
  const digits = currency === "JPY" ? 0 : 2;
  return `${currency} ${Number(amount || 0).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  })}`;
}

async function firestoreModule() {
  return await import("https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js");
}

async function loadActiveSession() {
  const id = activeSessionId();
  if (!id) throw new Error("先に通常POSで販売Sessionを選択してください。");

  if (navigator.onLine) {
    const { db, enabled } = getFirebaseState();
    if (enabled && db) {
      try {
        const { doc, getDocFromServer } = await firestoreModule();
        const snap = await getDocFromServer(doc(db, "salesSessions", id));
        if (snap.exists()) return { id: snap.id, ...snap.data() };
      } catch (error) {
        console.warn("Fast POS session server lookup failed", error);
      }
    }
  }

  const snapshot = loadPosOfflineSnapshot();
  const cached = snapshot?.activeSession;
  if (text(cached?.id || cached?.sessionId) === id) {
    return { id, ...cached };
  }

  throw new Error("Session情報を確認できません。オンラインで一度通常POSを開いてください。");
}

function installStyles() {
  if (document.querySelector("#fastPosStyles")) return;
  const style = document.createElement("style");
  style.id = "fastPosStyles";
  style.textContent = `
    #${BUTTON_ID}{min-height:36px;padding:0 14px;border:1px solid #185fa5;border-radius:18px;background:#eaf4ff;color:#185fa5;font:800 13px system-ui,sans-serif}
    #${OVERLAY_ID}{position:fixed;top:var(--fp-top-offset,0px);right:0;bottom:0;left:0;z-index:12000;background:#f5f5f2;color:#1f1f1f;overflow:auto;-webkit-overflow-scrolling:touch}
    #${OVERLAY_ID} .fp-head{max-width:480px;margin:0 auto;padding:16px 16px 10px;background:#f5f5f2}
    #${OVERLAY_ID} .fp-history-row{display:flex;justify-content:flex-end;align-items:center;margin-bottom:10px}
    #${OVERLAY_ID} .fp-title-row{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}
    #${OVERLAY_ID} .fp-title-row strong{font:800 24px/1.2 system-ui,sans-serif}
    #${OVERLAY_ID} .fp-history{min-height:42px;padding:0 14px;border:1px solid #deded9;border-radius:12px;background:#f3f3f0;color:#222;font:800 13px system-ui;white-space:nowrap}
    #${OVERLAY_ID} .fp-currency{min-width:76px;min-height:44px;padding:0 12px;border:1px solid #deded9;border-radius:12px;background:#fff;color:#555;font:800 14px system-ui;text-align:center;opacity:1;-webkit-text-fill-color:#555}
    #${OVERLAY_ID} .fp-close[hidden]{display:none}
    #${OVERLAY_ID} .fp-wrap{max-width:480px;margin:auto;padding:12px 10px calc(30px + env(safe-area-inset-bottom))}
    #${OVERLAY_ID} .fp-card{background:#fff;border:1px solid #e1e1dc;border-radius:16px;padding:12px;margin-bottom:10px}
    #${OVERLAY_ID} .fp-session{font-size:12px;color:#666;line-height:1.45}
    #${OVERLAY_ID} .fp-amount{font-size:36px;font-weight:900;text-align:right;padding:14px 6px;border-bottom:1px solid #eee;min-height:70px;overflow:hidden}
    #${OVERLAY_ID} .fp-pad{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:10px}
    #${OVERLAY_ID} .fp-key{height:58px;border:1px solid #d8d8d2;border-radius:14px;background:#fff;font:800 24px system-ui}
    #${OVERLAY_ID} .fp-key:active{transform:scale(.97);background:#eee}
    #${OVERLAY_ID} .fp-hints{display:grid;grid-template-columns:repeat(2,1fr);gap:7px;margin-top:8px}
    #${OVERLAY_ID} .fp-hint{min-height:42px;border:1px solid #d9d9d4;border-radius:11px;background:#fff;font:700 12px system-ui}
    #${OVERLAY_ID} .fp-hint.active{background:#1f1f1f;color:#fff;border-color:#1f1f1f}
    #${OVERLAY_ID} .fp-actions{display:grid;gap:9px;margin-top:12px}
    #${OVERLAY_ID} .fp-action{min-height:54px;border:0;border-radius:14px;font:900 16px system-ui}
    #${OVERLAY_ID} .fp-manual{background:#1f1f1f;color:#fff}
    #${OVERLAY_ID} .fp-stripe{background:#635bff;color:#fff}
    #${OVERLAY_ID} .fp-action:disabled{opacity:.45}
    #${OVERLAY_ID} .fp-note{font-size:11px;color:#666;line-height:1.5;margin-top:8px}
    #${OVERLAY_ID} .fp-status{font-size:12px;line-height:1.5;margin-top:8px;padding:8px;border-radius:9px;background:#f3f3ef}
    #${OVERLAY_ID} .fp-status.ok{background:#edf8ef;color:#22683b}
    #${OVERLAY_ID} .fp-status.err{background:#fff0f0;color:#a32d2d}
    #${OVERLAY_ID} .fp-qr{text-align:center;padding:10px 0}
    #${OVERLAY_ID} .fp-cancel{width:100%;min-height:44px;border:1px solid #ccc;border-radius:11px;background:#fff;font:700 13px system-ui}
  `;
  document.head.appendChild(style);
}

function ensureButton() {
  const skuButton = document.querySelector("#posModeSku");
  if (!skuButton || document.querySelector(`#${BUTTON_ID}`)) return;
  installStyles();
  const button = document.createElement("button");
  button.id = BUTTON_ID;
  button.type = "button";
  button.textContent = "最速";
  button.title = "金額だけで会計";
  button.addEventListener("click", () => void openFastPos());
  skuButton.insertAdjacentElement("afterend", button);
}

function currencyAllowsDecimal(currency) {
  return text(currency).toUpperCase() !== "JPY";
}

function parseDigitString(raw, currency) {
  const value = text(raw);
  if (!value) return 0;
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  if (!currencyAllowsDecimal(currency)) return Math.floor(n);
  return Math.round(n * 100) / 100;
}

function makeTransactionId() {
  if (globalThis.crypto?.randomUUID) return `sale_fast_${globalThis.crypto.randomUUID()}`;
  return `sale_fast_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function waitFor(find, timeoutMs = 3500) {
  return new Promise(resolve => {
    const started = Date.now();

    function check() {
      const result = find();
      if (result) {
        resolve(result);
        return;
      }
      if (Date.now() - started >= timeoutMs) {
        resolve(null);
        return;
      }
      window.setTimeout(check, 60);
    }

    check();
  });
}

function cardTitle(label) {
  return Array.from(document.querySelectorAll(".card-title"))
    .find(element => element.textContent?.trim() === label) || null;
}

async function openActiveSessionHistory(sessionId) {
  stripeToken += 1;
  document.getElementById(OVERLAY_ID)?.remove();

  const sessionsNav = document.querySelector('.nav-btn[data-route="sessions"]');
  if (!sessionsNav) return;
  sessionsNav.click();

  const detailButton = await waitFor(() =>
    Array.from(document.querySelectorAll(".sessionDetailButton"))
      .find(button => button.dataset.sessionId === sessionId)
  );

  if (!detailButton) {
    window.alert("現在の販売セッションの会計履歴を開けませんでした。");
    return;
  }

  detailButton.click();
  const historyTitle = await waitFor(() => cardTitle("会計履歴"));
  historyTitle?.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function openFastPos() {
  if (document.querySelector(`#${OVERLAY_ID}`)) return;

  let session;
  try {
    session = await loadActiveSession();
  } catch (error) {
    window.alert(error?.message || String(error));
    return;
  }

  if (text(session?.status) !== "open") {
    window.alert("このSessionは販売中ではありません。");
    return;
  }

  const currency = text(session?.currency || "JPY").toUpperCase();
  let rawAmount = "";
  let hint = "unclassified";
  stripeToken += 1;

  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.innerHTML = `
    <div class="fp-head">
      <div class="fp-history-row">
        <button class="fp-history" type="button">会計履歴</button>
      </div>
      <div class="fp-title-row">
        <strong>EVENT POS</strong>
        <select class="fp-currency" aria-label="通貨" disabled>
          <option selected>${esc(currency)}</option>
        </select>
      </div>
      <button class="fp-close" type="button" hidden aria-label="最速POSを閉じる"></button>
    </div>
    <div class="fp-wrap">
      <section class="fp-card">
        <div class="fp-session">${esc(session?.eventName || session?.name || session.id)} / ${esc(currency)}</div>
        <div class="fp-amount" id="fpAmount">${esc(formatAmount(0, currency))}</div>
        <div class="fp-pad">
          ${["1","2","3","4","5","6","7","8","9",currencyAllowsDecimal(currency)?".":"C","0","⌫"].map(key => `<button type="button" class="fp-key" data-key="${esc(key)}">${esc(key)}</button>`).join("")}
        </div>
        <div class="fp-note">商品を探さず、合計金額だけで会計します。商品数・SKUは未分類のまま保存されます。</div>
      </section>

      <section class="fp-card">
        <strong style="font-size:13px">あとで分類するためのヒント（任意）</strong>
        <div class="fp-hints">
          <button type="button" class="fp-hint active" data-hint="unclassified">完全未分類</button>
          <button type="button" class="fp-hint" data-hint="tshirt">Tシャツ</button>
          <button type="button" class="fp-hint" data-hint="accessory">アクセサリー</button>
          <button type="button" class="fp-hint" data-hint="other">その他</button>
        </div>
        <div class="fp-note">これはSKU確定ではありません。正式在庫はこの時点では減らしません。</div>
      </section>

      <section class="fp-card">
        <div class="fp-actions">
          <button type="button" class="fp-action fp-manual" id="fpManual">現金・その他で会計</button>
          <button type="button" class="fp-action fp-stripe" id="fpStripe">Stripe QR</button>
        </div>
        <div id="fpStatus"></div>
      </section>
    </div>
  `;
  document.body.appendChild(overlay);
  const topbarBottom = document.querySelector(".topbar")?.getBoundingClientRect().bottom || 0;
  overlay.style.setProperty("--fp-top-offset", `${Math.max(0, Math.round(topbarBottom))}px`);

  const amountEl = overlay.querySelector("#fpAmount");
  const statusEl = overlay.querySelector("#fpStatus");
  const manualButton = overlay.querySelector("#fpManual");
  const stripeButton = overlay.querySelector("#fpStripe");

  overlay.querySelector(".fp-history")?.addEventListener("click", () => {
    void openActiveSessionHistory(session.id);
  });

  function amount() {
    return parseDigitString(rawAmount, currency);
  }

  function renderAmount() {
    amountEl.textContent = formatAmount(amount(), currency);
    const disabled = amount() <= 0;
    manualButton.disabled = disabled;
    stripeButton.disabled = disabled || !navigator.onLine;
  }

  function setStatus(message, type = "") {
    statusEl.innerHTML = message
      ? `<div class="fp-status ${esc(type)}">${esc(message)}</div>`
      : "";
  }

  function resetSale() {
    rawAmount = "";
    hint = "unclassified";
    overlay.querySelectorAll(".fp-hint").forEach(button => {
      button.classList.toggle("active", button.dataset.hint === hint);
    });
    setStatus("");
    renderAmount();
  }

  overlay.querySelector(".fp-close")?.addEventListener("click", () => {
    stripeToken += 1;
    overlay.remove();
  });

  overlay.querySelectorAll(".fp-key").forEach(button => {
    button.addEventListener("click", () => {
      const key = button.dataset.key;
      if (key === "C") {
        rawAmount = "";
      } else if (key === "⌫") {
        rawAmount = rawAmount.slice(0, -1);
      } else if (key === ".") {
        if (!rawAmount.includes(".")) rawAmount = rawAmount ? `${rawAmount}.` : "0.";
      } else {
        const decimals = rawAmount.includes(".") ? rawAmount.split(".")[1].length : 0;
        if (rawAmount.includes(".") && decimals >= 2) return;
        rawAmount += key;
      }
      renderAmount();
    });
  });

  overlay.querySelectorAll(".fp-hint").forEach(button => {
    button.addEventListener("click", () => {
      hint = text(button.dataset.hint) || "unclassified";
      overlay.querySelectorAll(".fp-hint").forEach(row => {
        row.classList.toggle("active", row === button);
      });
    });
  });

  manualButton.addEventListener("click", async () => {
    const total = amount();
    if (total <= 0) return;
    if (!window.confirm(`${formatAmount(total, currency)} を金額のみで会計しますか？\n\nSKU・商品数は未分類のまま保存します。`)) return;

    manualButton.disabled = true;
    stripeButton.disabled = true;
    setStatus("会計中…");

    const transactionId = makeTransactionId();
    try {
      if (!navigator.onLine) {
        queueFastAmountSale({
          transactionId,
          sessionId: session.id,
          amount: total,
          createdByEmail: email(),
          classificationHint: hint,
          currency
        });
        setStatus("オフライン会計として保存しました。再接続後に同期します。", "ok");
      } else {
        await commitFastAmountSale({
          transactionId,
          sessionId: session.id,
          amount: total,
          createdByEmail: email(),
          classificationHint: hint,
          paymentMethod: "manual"
        });
        setStatus(`${formatAmount(total, currency)} を会計しました。未分類売上として保存しています。`, "ok");
      }
      setTimeout(resetSale, 900);
    } catch (error) {
      setStatus(error?.message || String(error), "err");
      renderAmount();
    }
  });

  stripeButton.addEventListener("click", async () => {
    const total = amount();
    if (total <= 0 || !navigator.onLine) return;

    const transactionId = makeTransactionId();
    const salePayload = buildFastAmountSalePayload({
      transactionId,
      sessionId: session.id,
      amount: total,
      createdByEmail: email(),
      classificationHint: hint
    });

    manualButton.disabled = true;
    stripeButton.disabled = true;
    setStatus("Stripe QRを作成中…");

    try {
      const checkout = await createStripeCheckout({ salePayload });
      if (!checkout?.url) throw new Error("Stripe支払いURLを作成できませんでした。");

      const token = ++stripeToken;
      statusEl.innerHTML = `
        <div class="fp-status">お客様の支払いを待っています…</div>
        <div class="fp-qr" id="fpQr"></div>
        <button type="button" class="fp-cancel" id="fpCancelStripe">Stripe会計をキャンセル</button>
      `;
      await renderStripeQr(statusEl.querySelector("#fpQr"), checkout.url);

      statusEl.querySelector("#fpCancelStripe")?.addEventListener("click", async () => {
        stripeToken += 1;
        try { await expireStripeCheckout(transactionId); } catch {}
        setStatus("Stripe会計をキャンセルしました。");
        renderAmount();
      });

      for (let attempt = 0; attempt < 90 && token === stripeToken; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 1500));
        if (token !== stripeToken || !document.body.contains(overlay)) return;

        const latest = await getStripeCheckoutStatus(transactionId);
        if (latest?.paymentStatus === "paid") {
          await commitFastAmountSale({
            transactionId,
            sessionId: session.id,
            amount: total,
            createdByEmail: email(),
            classificationHint: hint,
            paymentMethod: "stripe",
            paymentProvider: "stripe",
            providerPaymentIntentId: latest?.paymentIntentId || "",
            providerCheckoutSessionId: latest?.checkoutSessionId || checkout?.checkoutSessionId || "",
            providerPaymentStatus: latest?.paymentStatus || "paid"
          });
          try { await markStripeSaleCommitted({ transactionId }); } catch (error) {
            console.warn("Stripe committed marker failed", error);
          }
          stripeToken += 1;
          setStatus(`Stripe支払い完了。${formatAmount(total, currency)} を未分類売上として保存しました。`, "ok");
          setTimeout(resetSale, 1100);
          return;
        }

        if (latest?.status === "expired" || latest?.status === "complete" && latest?.paymentStatus !== "paid") {
          stripeToken += 1;
          setStatus("Stripe会計は完了しませんでした。", "err");
          renderAmount();
          return;
        }
      }

      if (token === stripeToken) {
        setStatus("支払い確認がタイムアウトしました。会計履歴とStripe状態を確認してください。", "err");
        renderAmount();
      }
    } catch (error) {
      setStatus(error?.message || String(error), "err");
      renderAmount();
    }
  });

  renderAmount();

  if (navigator.onLine) {
    void normalizeFastAmountSalesForSession(session.id).catch(error => {
      console.warn("Fast amount sale normalization skipped", error);
    });
  }
}

new MutationObserver(ensureButton).observe(document.body, { childList: true, subtree: true });
window.addEventListener("online", () => {
  const sessionId = activeSessionId();
  if (!sessionId) return;
  setTimeout(() => {
    void normalizeFastAmountSalesForSession(sessionId).catch(error => console.warn(error));
  }, 2500);
  setTimeout(() => {
    void normalizeFastAmountSalesForSession(sessionId).catch(error => console.warn(error));
  }, 6000);
});
ensureButton();
