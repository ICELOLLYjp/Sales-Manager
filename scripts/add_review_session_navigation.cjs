"use strict";
const fs = require("node:fs");
const assert = require("node:assert/strict");
const file = "gmail-expense-review.html";
let source = fs.readFileSync(file, "utf8");
function replaceOnce(before, after, label) {
  assert.equal(source.split(before).length - 1, 1, `Expected one ${label}`);
  source = source.replace(before, after);
}
replaceOnce(
  '  import { initAuth, loginWithGoogle } from "./js/auth.js";',
  '  import { initAuth, loginWithGoogle } from "./js/auth.js";\n  import { sessionExpenseDetailHref } from "./js/expenseSourceNavigationModel.js";',
  "navigation import"
);
replaceOnce(
  '  function canPost(item) {',
  `  function addSessionDetailLink(container, item) {
    const session = postingSession(item);
    const href = sessionExpenseDetailHref(session?.id);
    if(!href) return;
    const link = document.createElement("a");
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "このイベントの売上詳細を別タブで開く";
    link.style.cssText = "display:inline-block;margin-top:10px;grid-column:1/-1;";
    container.append(link);
  }
  function canPost(item) {`,
  "session link helper"
);
replaceOnce(
  '      select.value = scopeValue(item); select.disabled = busy || item.expensePosted; classification.append(select); article.append(classification);',
  '      select.value = scopeValue(item); select.disabled = busy || item.expensePosted; classification.append(select); article.append(classification);\n      addSessionDetailLink(article, item);',
  "candidate session link"
);
replaceOnce(
  '        form.append(amountLabel, currencyLabel, paymentLabel, categoryLabel, descriptionLabel, saveDraft);',
  '        form.append(amountLabel, currencyLabel, paymentLabel, categoryLabel, descriptionLabel, saveDraft);\n        addSessionDetailLink(form, item);',
  "draft form session link"
);
assert(source.includes('link.target = "_blank";') && source.includes('link.rel = "noopener noreferrer";'), "New tab must not replace draft form");
if(process.argv.includes("--check")) console.log("Review session navigation patch is applicable; no changes written.");
else {
  fs.writeFileSync(file, source);
  console.log("Review session navigation patch applied.");
}
