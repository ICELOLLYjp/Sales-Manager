import { normalizeFastAmountSalesForSession } from "./services/fastAmountSaleService.js?v=20260927-mixed-fast-1";

let timer = null;
let running = false;

function activeSessionId() {
  return String(localStorage.getItem("icelolly-sales-active-session") || "").trim();
}

async function run() {
  timer = null;
  if (running || !navigator.onLine) return;

  const sessionId = activeSessionId();
  if (!sessionId) return;

  running = true;
  try {
    await normalizeFastAmountSalesForSession(sessionId);
  } catch (error) {
    console.warn("Mixed fast amount normalization skipped", error);
  } finally {
    running = false;
  }
}

function schedule(delay = 700) {
  if (timer) window.clearTimeout(timer);
  timer = window.setTimeout(() => void run(), delay);
}

document.addEventListener("icelolly:fast-cart-released", () => schedule(500));
window.addEventListener("online", () => schedule(1200));

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) schedule(1200);
});
