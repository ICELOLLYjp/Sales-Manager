import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { planEventTshirtSkuRegistration } from "../js/services/eventTshirtSkuRegistration.mjs";

const mk = size => {
  const ids = ["organic", "gull", "beige_grey", size.toLowerCase()];
  return {
    variantId: ["tshirt", ...ids].join("__"),
    category: "tshirt",
    inventoryKey: "tshirt:" + ids.join("|"),
    label: "Gull", detail: "Organic / Beige Grey / " + size,
    openingQty: size === "XL" ? 3 : 4
  };
};
const opts = {
  bodies: [{id:"organic",name:"Organic"}],
  designs: [{id:"gull",name:"Gull"}],
  colors: [{id:"beige_grey",name:"Beige Grey",bodyId:"organic"}],
  sizes: ["S","M","L","XL"].map((size,i) => ({id:size.toLowerCase(),name:size,order:i+1}))
};
const openingItems = ["S","M","L","XL"].map(mk);
const registeredVariants = [openingItems[1], openingItems[2]].map(r => ({variantId:r.variantId}));

test("Gull S and XL are candidates while M and L stay registered", () => {
  const plan = planEventTshirtSkuRegistration({ openingItems, registeredVariants, masterOptions:opts });
  assert.deepEqual(plan.rows.map(r=>r.size), ["S","XL"]);
  assert.equal(plan.rows[0].stockTargetId, openingItems[0].inventoryKey);
  assert.equal(plan.rows[0].quantity, 0, "metadata only, not event stock");
  assert.deepEqual(plan.excluded, []);
});

test("existing registration is not overwritten, even if company stock is zero", () => {
  const plan = planEventTshirtSkuRegistration({
    openingItems, registeredVariants: openingItems, masterOptions: opts
  });
  assert.equal(plan.rows.length, 0);
});

test("bad stock key never registers unrelated SKU", () => {
  const items = [{...openingItems[0], inventoryKey:"tshirt:wrong|gull|beige_grey|s"}];
  const plan = planEventTshirtSkuRegistration({ openingItems:items, masterOptions:opts });
  assert.equal(plan.rows.length, 0);
  assert.equal(plan.excluded[0].reason, "stock_key_mismatch");
});

test("unknown master ID and mismatching body color are rejected", () => {
  const badDesign = {...openingItems[0],
    variantId:"tshirt__organic__unknown__beige_grey__s",
    inventoryKey:"tshirt:organic|unknown|beige_grey|s"};
  const p1 = planEventTshirtSkuRegistration({openingItems:[badDesign],masterOptions:opts});
  assert.equal(p1.rows.length, 0);
  const p2 = planEventTshirtSkuRegistration({
    openingItems:[openingItems[0]],
    masterOptions:{...opts,colors:[{id:"beige_grey",name:"Beige Grey",bodyId:"vintage"}]}
  });
  assert.equal(p2.rows.length, 0);
});

test("empty event stock, sold out, and corrected to zero cannot be registered", () => {
  const p = planEventTshirtSkuRegistration({
    openingItems,
    soldByVariant:{ [openingItems[0].variantId]: 4, [openingItems[3].variantId]: 3 },
    registeredVariants,
    masterOptions:opts
  });
  assert.equal(p.rows.length, 0);
  const p2 = planEventTshirtSkuRegistration({
    openingItems:[openingItems[0]],
    flowEntries:[{variantId:openingItems[0].variantId,type:"opening_correction",quantity:-4}],
    masterOptions:opts
  });
  assert.equal(p2.rows.length, 0);
});

test("malformed encoded identity and missing stock key are refused", () => {
  const weird = {...openingItems[0],variantId:"tshirt__organic__gull__beige_grey__%ZZ"};
  const invalid = planEventTshirtSkuRegistration({openingItems:[weird],masterOptions:opts});
  assert.equal(invalid.rows.length, 0);
  const missingKey = planEventTshirtSkuRegistration({
    openingItems:[{...openingItems[0],inventoryKey:""}],masterOptions:opts
  });
  assert.equal(missingKey.rows.length, 0);
});

test("page includes missing SKU repair controller and never replaces sale transaction code", () => {
  const index = readFileSync(new URL("../index.html", import.meta.url),"utf8");
  assert.match(index,/eventTshirtSkuRepairUi\.js/);
  const script = readFileSync(new URL("../js/eventTshirtSkuRepairUi.js",import.meta.url),"utf8");
  assert.match(script,/window\.confirm/);
  assert.match(script,/registerTshirtVariant/);
  assert.doesNotMatch(script,/saveEventOpeningInventory|changeStock|commitQuickSale/);
});
