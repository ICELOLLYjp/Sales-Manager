import { test } from "node:test";
import assert from "node:assert/strict";
import { createInlineExpenseReview } from "../js/gmailExpenseInlineReview.js";

class Node {
  constructor(tag = "div") {
    this.tag = tag.toLowerCase(); this.children = []; this.parentElement = null;
    this.dataset = {}; this.listeners = {}; this.hidden = false; this.disabled = false;
    this.value = ""; this.options = []; this._text = "";
    this.classList = { add: () => {} };
  }
  set textContent(value) { this._text = String(value); this.replaceChildren(); }
  get textContent() { return this._text + this.children.map(child => child.textContent || "").join(""); }
  append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  add(option) { this.options.push(option); }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  all() { return this.children.flatMap(child => [child, ...child.all()]); }
  querySelectorAll(selector) {
    const tags = selector.split(",").map(value => value.trim().toLowerCase());
    return this.all().filter(node => tags.includes(node.tag));
  }
  querySelector(selector) {
    const match = selector.match(/^\[data-field="([^"]+)"\]$/);
    return match ? this.all().find(node => node.dataset.field === match[1]) : null;
  }
  closest(selector) {
    let node = this;
    while (node) {
      if (selector === ".inline-item" && node.tag === "article") return node;
      if (selector === "button[data-action][data-id]" && node.tag === "button" && node.dataset.action && node.dataset.id) return node;
      node = node.parentElement;
    }
    return null;
  }
  setAttribute(name, value) { this[name] = value; }
  removeAttribute(name) { delete this[name]; }
}

function setup({ eventId = "eventA", duplicates = [], amount = 50 } = {}) {
  const nodes = Object.fromEntries(["inlineReview", "inlineReviewList", "inlineReviewStatus", "inlineReviewLoad"].map(id => [id, new Node()]));
  globalThis.document = {
    getElementById: id => nodes[id],
    createElement: tag => new Node(tag)
  };
  globalThis.Option = class { constructor(label, value) { this.label = label; this.value = value; } };
  let confirm = true;
  globalThis.window = { confirm: () => confirm };
  const id = "f".repeat(64);
  let candidate = {
    id, eventId: "eventA", expenseScope: "event", reviewStatus: "unreviewed", expensePosted: false,
    subject: "領収書", account: "a@example.com", sender: "sender@example.com", date: "2026-09-18"
  };
  const calls = [];
  const session = { id: "eventA", eventName: "Public Garden", currency: "JPY", expenses: { advertising: { amount, currency: "JPY" } } };
  const snapshot = () => ({
    month: "2026-09", candidates: [structuredClone(candidate), { ...candidate, id: "e".repeat(64), eventId: "eventB" }],
    sessions: [structuredClone(session)], duplicateGroups: duplicates.length ? [[id, "e".repeat(64)]] : [],
    expensePostingAvailable: true, truncated: false
  });
  async function call(name, args) {
    calls.push({ name, args });
    if (name === "gmailExpenseCandidateList") return snapshot();
    if (name === "gmailExpenseCandidateReview") { candidate.reviewStatus = args.status; return {}; }
    if (name === "gmailExpenseInspectEvidence") return { excerpt: "支払領収書", moneyHints: ["JPY 20"], pdfResults: [], attachments: [] };
    if (name === "gmailExpenseSaveEvidenceReview") {
      candidate.evidenceReview = { ...args.review, amount: Number(args.review.amount) }; return {};
    }
    if (name === "gmailExpensePostReviewedCandidate") {
      candidate.expensePosted = true; candidate.expensePost = { amount: 20, currency: "JPY" };
      session.expenses.advertising.amount += 20; return { duplicate: false };
    }
    throw Error(`Unexpected call: ${name}`);
  }
  const review = createInlineExpenseReview({ call, getContext: () => ({ eventId, month: "2026-09" }), setIntakeBusy: () => {} });
  const buttons = () => nodes.inlineReviewList.all().filter(node => node.tag === "button");
  const click = action => {
    const button = buttons().find(node => node.dataset.action === action);
    assert.ok(button, `missing ${action} button`);
    nodes.inlineReviewList.listeners.click({ target: button });
  };
  const settle = async () => {
    for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve));
  };
  return { review, calls, nodes, buttons, click, settle, setConfirm: value => { confirm = value; }, id };
}

test("loading the inline screen reads only, and displays only the selected event", async () => {
  const app = setup();
  await app.review.load();
  assert.deepEqual(app.calls.map(item => item.name), ["gmailExpenseCandidateList"]);
  assert.equal(app.nodes.inlineReviewList.children.length, 1);
  assert.equal(app.nodes.inlineReviewList.children[0].dataset.id, app.id);
});

test("proof inspection saves no expense, unverified payment cannot be posted", async () => {
  const app = setup();
  await app.review.load();
  app.click("inspect"); await app.settle();
  assert.deepEqual(app.calls.slice(1).map(item => item.name), ["gmailExpenseCandidateReview", "gmailExpenseInspectEvidence"]);
  app.click("post"); await app.settle();
  assert.equal(app.calls.some(item => item.name === "gmailExpensePostReviewedCandidate"), false);
});

test("confirmed posting uses the current server total and posts exactly once", async () => {
  const app = setup();
  await app.review.load(); app.click("inspect"); await app.settle();
  const article = app.nodes.inlineReviewList.children[0];
  article.querySelector('[data-field="amount"]').value = "20";
  article.querySelector('[data-field="currency"]').value = "JPY";
  article.querySelector('[data-field="category"]').value = "advertising";
  article.querySelector('[data-field="paymentStatus"]').value = "paid_evidence";
  app.click("post"); await app.settle();
  const posts = app.calls.filter(item => item.name === "gmailExpensePostReviewedCandidate");
  assert.equal(posts.length, 1);
  assert.equal(posts[0].args.expectedCurrentAmount, 50);
  assert.equal(posts[0].args.confirmation, "post_reviewed_expense");
  assert.equal(app.nodes.inlineReviewList.children[0].textContent.includes("登録済み"), true);
});

test("a duplicate is not posted when the separate duplicate confirmation is declined", async () => {
  const app = setup({ duplicates: true });
  app.setConfirm(false); await app.review.load(); app.click("inspect"); await app.settle();
  const article = app.nodes.inlineReviewList.children[0];
  article.querySelector('[data-field="amount"]').value = "20";
  article.querySelector('[data-field="currency"]').value = "JPY";
  article.querySelector('[data-field="paymentStatus"]').value = "paid_evidence";
  app.click("post"); await app.settle();
  assert.equal(app.calls.some(item => item.name === "gmailExpensePostReviewedCandidate"), false);
  assert.equal(app.calls.some(item => item.name === "gmailExpenseSaveEvidenceReview"), true);
});
