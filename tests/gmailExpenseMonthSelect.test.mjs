import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const html = readFileSync(new URL("../gmail-expense-intake.html", import.meta.url), "utf8");
const inline = html.match(/<script>\s*([\s\S]*?monthSelect[\s\S]*?)<\/script>/)?.[1];
assert.ok(inline, "Gmail search month selector script exists");

function monthOptions(isoDate) {
  const select = { options: [], selectedIndex: -1, add(option) { this.options.push(option); } };
  const document = { getElementById(id) { return id === "month" ? select : null; } };
  const FixedDate = class extends Date {
    constructor(...args) { super(...(args.length ? args : [isoDate])); }
  };
  const Option = class {
    constructor(text, value) { this.text = text; this.value = value; }
  };
  runInNewContext(inline, { document, Date: FixedDate, Option });
  return select;
}

test("current month comes first and no future months appear", () => {
  const select = monthOptions("2026-09-24T12:00:00Z");
  assert.equal(select.selectedIndex, 0);
  assert.equal(select.options[0].value, "2026-09");
  assert.equal(select.options[8].value, "2026-01");
  assert.equal(select.options[9].value, "2025-12");
  assert.equal(select.options.at(-1).value, "2025-01");
  assert.equal(select.options.length, 21);
});

test("January lists only January for its year and then previous December", () => {
  const select = monthOptions("2027-01-04T12:00:00Z");
  assert.equal(select.options[0].value, "2027-01");
  assert.equal(select.options[1].value, "2026-12");
  assert.equal(select.options.at(-1).value, "2025-01");
});
