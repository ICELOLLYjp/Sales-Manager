import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const html = readFileSync(new URL("../gmail-expense-intake.html", import.meta.url), "utf8");
const inline = html.match(/<script>\s*([\s\S]*?monthSelect[\s\S]*?)<\/script>/)?.[1];
assert.ok(inline, "Gmail search month selector script exists");

function monthOptions(isoDate) {
  const groups = [];
  const select = { append(group) { groups.push(group); } };
  const document = {
    getElementById(id) { return id === "month" ? select : null; },
    createElement(tag) {
      assert.equal(tag, "optgroup");
      return { label: "", options: [], append(option) { this.options.push(option); } };
    }
  };
  const FixedDate = class extends Date {
    constructor(...args) { super(...(args.length ? args : [isoDate])); }
  };
  const Option = class {
    constructor(text, value) { this.text = text; this.value = value; }
  };
  runInNewContext(inline, { document, Date: FixedDate, Option });
  return groups;
}

test("current month comes first and no future months appear", () => {
  const groups = monthOptions("2026-09-24T12:00:00Z");
  assert.deepEqual(groups.map(group => group.label), ["2026年", "2025年"]);
  assert.equal(groups[0].options[0].value, "2026-09");
  assert.equal(groups[0].options.at(-1).value, "2026-01");
  assert.equal(groups[1].options[0].value, "2025-12");
  assert.equal(groups[1].options.at(-1).value, "2025-01");
  assert.equal(groups.flatMap(group => group.options).length, 21);
});

test("January lists only January for its year and then previous December", () => {
  const groups = monthOptions("2027-01-04T12:00:00Z");
  assert.equal(groups[0].options.length, 1);
  assert.equal(groups[0].options[0].value, "2027-01");
  assert.equal(groups[1].options[0].value, "2026-12");
  assert.equal(groups.at(-1).options.at(-1).value, "2025-01");
});
