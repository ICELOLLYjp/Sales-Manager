"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  CONFIRMATION,
  postingPlan,
  postReviewedCandidate
} = require("../expensePosting");

const candidateId = "a".repeat(64);

function candidate(overrides = {}) {
  return {
    reviewStatus: "kept",
    expenseScope: "event",
    eventId: "mori2026",
    eventName: "森之市 珈琲と花物語",
    subject: "支払い完了",
    expensePosted: false,
    evidenceReview: {
      amount: 13050,
      currency: "TWD",
      paymentStatus: "paid_evidence",
      category: "boothFee",
      description: "森之市 出店料"
    },
    ...overrides
  };
}

function session(overrides = {}) {
  return {
    eventName: "森之市 珈琲と花物語",
    currency: "TWD",
    fxRateToJPY: 4.8,
    expenses: {
      boothFee: { amount: 100, currency: "TWD", fxRateToJPY: 4.8, amountJPY: 480 },
      shipping: { amount: 1000, currency: "JPY", fxRateToJPY: 1, amountJPY: 1000 }
    },
    ...overrides
  };
}

function snapshot(exists, data) {
  return { exists, data: () => data };
}

function fakeDb(candidateData, sessionData) {
  const writes = [];
  const candidateRef = { kind: "candidate", id: candidateId };
  const sessionRef = { kind: "session", id: "mori2026" };
  const auditRef = { kind: "audit", id: "audit1" };
  const db = {
    collection(name) {
      return {
        doc(id) {
          if (name === "gmailExpenseCandidates") return candidateRef;
          if (name === "salesSessions") return sessionRef;
          if (name === "gmailExpenseCandidateAudit") return auditRef;
          throw new Error(`unexpected collection ${name}:${id}`);
        }
      };
    },
    async runTransaction(callback) {
      return callback({
        async get(ref) {
          if (ref.kind === "candidate") return snapshot(true, candidateData);
          if (ref.kind === "session") return snapshot(Boolean(sessionData), sessionData);
          throw new Error(`unexpected read ${ref.kind}`);
        },
        update(ref, data) { writes.push({ operation: "update", ref, data }); },
        set(ref, data) { writes.push({ operation: "set", ref, data }); }
      });
    }
  };
  return { db, writes };
}

test("posting plan adds one reviewed payment to the matching event category", () => {
  const result = postingPlan({ candidate: candidate(), session: session(), expectedCurrentAmount: 100 });
  assert.equal(result.amount, 13050);
  assert.equal(result.previousAmount, 100);
  assert.equal(result.nextAmount, 13150);
  assert.deepEqual(result.categoryEntry, {
    amount: 13150,
    currency: "TWD",
    fxRateToJPY: 4.8,
    amountJPY: 63120
  });
  assert.equal(result.expenseTotalJPY, 64120);
});

test("posting requires paid evidence, an event and matching currency", () => {
  assert.throws(() => postingPlan({
    candidate: candidate({ evidenceReview: { ...candidate().evidenceReview, paymentStatus: "invoiced" } }),
    session: session(),
    expectedCurrentAmount: 100
  }), /支払確認済み/);
  assert.throws(() => postingPlan({
    candidate: candidate({ expenseScope: "unassigned", eventId: null }),
    session: session(),
    expectedCurrentAmount: 100
  }), /対象イベント/);
  assert.throws(() => postingPlan({
    candidate: candidate(),
    session: session({ currency: "JPY" }),
    expectedCurrentAmount: 100
  }), /一致しません/);
});

test("posting aborts when the currently stored category amount changed", () => {
  assert.throws(() => postingPlan({
    candidate: candidate(),
    session: session(),
    expectedCurrentAmount: 0
  }), /再読み込み/);
});

test("explicit posting updates the event and candidate in one transaction", async () => {
  const { db, writes } = fakeDb(candidate(), session());
  const result = await postReviewedCandidate({
    db,
    candidateId,
    confirmation: CONFIRMATION,
    expectedCurrentAmount: 100,
    actorEmail: "staff@example.com",
    now: new Date("2026-09-17T00:00:00Z")
  });
  assert.equal(result.expensePosted, true);
  assert.equal(result.duplicate, false);
  assert.equal(result.expensePost.amount, 13050);
  const sessionWrite = writes.find(write => write.operation === "update" && write.ref.kind === "session");
  assert.equal(sessionWrite.data["expenses.boothFee"].amount, 13150);
  const candidateWrite = writes.find(write => write.operation === "update" && write.ref.kind === "candidate");
  assert.equal(candidateWrite.data.expensePosted, true);
  assert.equal(writes.filter(write => write.operation === "set" && write.ref.kind === "audit").length, 1);
});

test("retrying an already posted candidate never adds the amount again", async () => {
  const posted = candidate({
    expensePosted: true,
    expensePost: { eventId: "mori2026", amount: 13050, currency: "TWD", category: "boothFee" }
  });
  const { db, writes } = fakeDb(posted, session());
  const result = await postReviewedCandidate({
    db,
    candidateId,
    confirmation: CONFIRMATION,
    expectedCurrentAmount: 100,
    actorEmail: "staff@example.com"
  });
  assert.equal(result.duplicate, true);
  assert.equal(writes.length, 0);
});

test("posting cannot run without the explicit confirmation value", async () => {
  const { db } = fakeDb(candidate(), session());
  await assert.rejects(() => postReviewedCandidate({
    db,
    candidateId,
    confirmation: "",
    expectedCurrentAmount: 100,
    actorEmail: "staff@example.com"
  }), /確認操作/);
});
