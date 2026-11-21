import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../js/fastPosUi.js", import.meta.url), "utf8");
const modeSource = readFileSync(new URL("../js/fastPosModeEnhancement.js", import.meta.url), "utf8");
const historySource = readFileSync(new URL("../js/historyNavigationReliability.js", import.meta.url), "utf8");
const sessionSource = readFileSync(new URL("../js/fastPosSessionEnhancement.js", import.meta.url), "utf8");

const closeStart = source.indexOf("function closeFastPosOverlay() {");
const closeEnd = source.indexOf("function text(value)", closeStart);
const navStart = source.indexOf("document.addEventListener(\"click\", event => {", source.indexOf("// Route changes must close"));
const navEnd = source.indexOf("document.addEventListener(\"keydown\"", navStart);
assert.ok(closeStart >= 0 && closeEnd > closeStart);
assert.ok(navStart >= 0 && navEnd > navStart);

function harness({ pending = false, hasOverlay = true } = {}) {
  const calls = { removed: 0, alerts: [], prevented: 0, stopped: 0 };
  let overlay = hasOverlay ? {
    dataset: pending ? { checkoutPending: "true" } : {},
    remove() { calls.removed += 1; overlay = null; }
  } : null;
  let routeListener;
  class Element {
    constructor(isNav = false) { this.isNav = isNav; }
    closest(selector) { return selector === ".bottom-nav [data-route]" && this.isNav ? this : null; }
  }
  const context = vm.createContext({
    OVERLAY_ID: "fastPosOverlay",
    stripeToken: 5,
    Element,
    window: { alert: value => calls.alerts.push(value) },
    document: {
      getElementById: id => id === "fastPosOverlay" ? overlay : null,
      addEventListener: (type, callback, capture) => {
        if (type === "click" && capture === true) routeListener = callback;
      }
    }
  });
  vm.runInContext(source.slice(closeStart, closeEnd), context);
  vm.runInContext(source.slice(navStart, navEnd), context);
  return {
    calls, context,
    close: () => context.closeFastPosOverlay(),
    route: isNav => routeListener({
      target: new Element(isNav),
      preventDefault: () => { calls.prevented += 1; },
      stopImmediatePropagation: () => { calls.stopped += 1; }
    })
  };
}

test("Fast POS displays a permanent exit button and preserves rapid repeat sales", () => {
  assert.match(source, /class="fp-close" type="button" aria-label="最速POSを閉じて通常POSへ戻る">POSへ戻る<\/button>/);
  assert.doesNotMatch(source, /class="fp-close" type="button" hidden/);
  assert.match(source, /\.fp-head\{position:sticky/);
  assert.match(source, /setTimeout\(resetSale, 900\)/);
});

test("after checkout, exit removes blocking overlay and invalidates Stripe polling", () => {
  const h = harness();
  assert.equal(h.close(), true);
  assert.equal(h.calls.removed, 1);
  assert.equal(h.context.stripeToken, 6);
  assert.deepEqual(h.calls.alerts, []);
});

test("navigation to another feature removes the overlay before route handling", () => {
  const h = harness();
  h.route(true);
  assert.equal(h.calls.removed, 1);
  assert.equal(h.calls.prevented, 0);
  assert.equal(h.calls.stopped, 0);
});

test("unrelated clicks and navigation without overlay are unchanged", () => {
  const h = harness();
  h.route(false);
  assert.equal(h.calls.removed, 0);
  const noOverlay = harness({ hasOverlay: false });
  noOverlay.route(true);
  assert.equal(noOverlay.calls.removed, 0);
  assert.equal(noOverlay.calls.prevented, 0);
});

test("pending checkout blocks both exit and navigation", () => {
  const h = harness({ pending: true });
  assert.equal(h.close(), false);
  h.route(true);
  assert.equal(h.calls.removed, 0);
  assert.equal(h.calls.prevented, 1);
  assert.equal(h.calls.stopped, 1);
  assert.equal(h.context.stripeToken, 5);
  assert.equal(h.calls.alerts.length, 2);
});

test("alternate POS modes, session changes and history honor pending checkout", () => {
  assert.match(modeSource, /if \(document\.getElementById\(FAST_OVERLAY_ID\)\) return;/);
  assert.match(sessionSource, /if \(overlay\.dataset\.checkoutPending === "true"\)/);
  assert.match(historySource, /if \(document\.getElementById\("fastPosOverlay"\)\) return;/);
  assert.match(source, /finally \{\s*delete overlay\.dataset\.checkoutPending;/);
  assert.match(source, /stripeToken \+= 1;\s*delete overlay\.dataset\.checkoutPending;\s*setStatus\(`Stripe支払い完了/);
});

