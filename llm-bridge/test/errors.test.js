import test from "node:test";
import assert from "node:assert/strict";
import {
  ERROR_CODES,
  LLMBridgeError,
  toLlmBridgeError,
} from "../lib/errors.js";

test("LLMBridgeError preserves code and provider context", () => {
  const error = new LLMBridgeError(ERROR_CODES.NO_API_KEY, "missing key", {
    provider: "deepseek",
    action: "chat",
  });
  assert.equal(error.name, "LLMBridgeError");
  assert.equal(error.code, ERROR_CODES.NO_API_KEY);
  assert.equal(error.provider, "deepseek");
  assert.equal(error.action, "chat");
  assert.equal(error.status, 400);
});

test("toLlmBridgeError keeps existing LLMBridgeError", () => {
  const original = new LLMBridgeError(ERROR_CODES.REQUEST_TIMEOUT, "timeout");
  assert.equal(toLlmBridgeError(original, "chat"), original);
});

test("toLlmBridgeError wraps generic errors", () => {
  const wrapped = toLlmBridgeError(new Error("boom"), "completion", "local");
  assert.equal(wrapped.code, ERROR_CODES.INTERNAL);
  assert.equal(wrapped.provider, "local");
  assert.match(wrapped.message, /boom/);
});
