import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// Run the actual DOM change listener without Firebase or production writes.
const source = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
const start = source.indexOf('      document\n        .querySelector(\n          "#posSessionSelect"');
const end = source.indexOf('      document\n        .querySelector(\n          "#goToSessionsButton"', start);
assert.ok(start > 0 && end > start);

function harness({ cart = [], confirm = true } = {}) {
  const calls = [];
  const storage = new Map();
  let listener;
  const sessions = [
    { sessionId: "japan", currency: "JPY" },
    { sessionId: "taipei", currency: "TWD" }
  ];
  const context = vm.createContext({
    document: { querySelector: () => ({ addEventListener: (type, callback) => {
      assert.equal(type, "change"); listener = callback;
    } }) },
    window: { confirm: () => confirm },
    localStorage: { setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) },
    activeSessionId: "japan", activeSession: sessions[0], openSessions: sessions,
    posCurrency: "JPY", posCart: new Map(cart), posOrderDiscount: 50,
    lastCheckoutResult: {}, renderSequence: 10,
    invalidatePendingCheckout: () => calls.push("invalidate"),
    renderPosBody: () => calls.push("body"),
    renderPos: sequence => calls.push({ sequence, sessionId: context.activeSessionId,
      currency: context.posCurrency, cartSize: context.posCart.size })
  });
  vm.runInContext(source.slice(start, end), context);
  return { context, calls, storage, change: value => listener({ target: { value } }) };
}

test("switching Japan to Taipei reloads event stock, rather than only changing currency", () => {
  const h = harness(); h.change("taipei");
  assert.equal(h.context.activeSessionId, "taipei");
  assert.equal(h.storage.get("icelolly-sales-active-session"), "taipei");
  assert.deepEqual(h.calls.at(-1), { sequence: 11, sessionId: "taipei", currency: "TWD", cartSize: 0 });
  assert.equal(h.calls.includes("body"), false);
});

test("deselecting an event reloads company stock context", () => {
  const h = harness(); h.change("");
  assert.equal(h.context.activeSession, null);
  assert.equal(h.calls.at(-1).sessionId, "");
  assert.equal(h.calls.at(-1).sequence, 11);
});

test("cancelled session switch preserves the current cart and skips stock reload", () => {
  const h = harness({ cart: [["sku", { quantity: 1 }]], confirm: false }); h.change("taipei");
  assert.equal(h.context.activeSessionId, "japan");
  assert.equal(h.context.posCart.size, 1);
  assert.deepEqual(h.calls, ["body"]);
});

test("accepted session switch clears the old cart before reloading", () => {
  const h = harness({ cart: [["sku", { quantity: 1 }]] }); h.change("taipei");
  assert.equal(h.context.posCart.size, 0);
  assert.equal(h.context.posOrderDiscount, 0);
  assert.equal(h.calls.at(-1).sessionId, "taipei");
});

test("selecting the same event leaves the current view and cart untouched", () => {
  const h = harness({ cart: [["sku", { quantity: 1 }]] }); h.change("japan");
  assert.equal(h.context.posCart.size, 1);
  assert.deepEqual(h.calls, []);
});
