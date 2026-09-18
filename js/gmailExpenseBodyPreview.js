import { getFirebaseState } from "./firebase.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js";

const results = document.querySelector("#results");
const status = document.querySelector("#staff");
let generation = 0;
const cache = new Map();

function decorate() {
  if (!results) return;
  for (const card of results.querySelectorAll(".message")) {
    if (card.dataset.bodyPreviewReady) continue;
    card.dataset.bodyPreviewReady = "1";
    const checkbox = card.querySelector('input[type="checkbox"]');
    const text = card.querySelector(".text");
    const meta = text?.querySelector("small")?.textContent || "";
    const account = ["fjmthrs@gmail.com", "icelolly.zakka@gmail.com"].find(value => meta.endsWith(`／ ${value}`));
    if (!checkbox || !text || !account) continue;
    const index = [...results.querySelectorAll(".message")].indexOf(card);
    // The search results are metadata-only; the message ID is not exposed in the DOM.
    // Never infer an ID from a subject or sender, which may be duplicated.
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary";
    button.textContent = "本文を確認";
    button.disabled = true;
    button.title = "検索結果のメッセージIDが必要です";
    button.addEventListener("click", event => event.stopPropagation());
    text.append(button);
  }
}
if (results) new MutationObserver(decorate).observe(results, { childList: true });
decorate();
