"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { validatePreviewRequest } = require("../unsavedBodyPreview");

test("accepts supported account and opaque Gmail message ID", () => {
  assert.deepEqual(validatePreviewRequest({ account: "icelolly.zakka@gmail.com", messageId: "AbC_123-xy" }), {
    account: "icelolly.zakka@gmail.com", messageId: "AbC_123-xy"
  });
});

test("rejects unsupported account and malformed IDs", () => {
  assert.throws(() => validatePreviewRequest({ account: "someone@example.com", messageId: "abc" }));
  for (const messageId of ["", "abc/def", "a b", "a".repeat(257), null]) {
    assert.throws(() => validatePreviewRequest({ account: "icelolly.zakka@gmail.com", messageId }));
  }
});
