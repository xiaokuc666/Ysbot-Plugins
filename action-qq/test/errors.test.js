import test from "node:test";
import assert from "node:assert/strict";
import { QqActionError, toQqActionError } from "../lib/errors.js";

test("QqActionError preserves action context", () => {
  const error = new QqActionError("ONEBOT_FAILED", "failed", {
    action: "send_group_msg",
    retcode: 100,
    wording: "bad request",
  });
  assert.equal(error.name, "QqActionError");
  assert.equal(error.code, "ONEBOT_FAILED");
  assert.equal(error.action, "send_group_msg");
  assert.equal(error.retcode, 100);
  assert.equal(error.wording, "bad request");
});

test("toQqActionError preserves protocol error fields", () => {
  const protocolError = Object.assign(new Error("bad"), {
    code: "ONEBOT_FAILED",
    retcode: 100,
    wording: "bad request",
  });
  const error = toQqActionError(protocolError, "send_group_msg");
  assert.equal(error.code, "ONEBOT_FAILED");
  assert.equal(error.retcode, 100);
  assert.equal(error.wording, "bad request");
  assert.equal(error.action, "send_group_msg");
});

test("toQqActionError wraps generic failures", () => {
  const error = toQqActionError(new Error("boom"));
  assert.equal(error.code, "INTERNAL");
  assert.match(error.message, /boom/);
  assert.ok(error.cause instanceof Error);
});
