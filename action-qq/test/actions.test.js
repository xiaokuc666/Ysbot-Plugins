import test from "node:test";
import assert from "node:assert/strict";
import {
  BUILTIN_ACTIONS,
  STANDARD_ONEBOT_ACTIONS,
  assertActionSupported,
  allowedActionsFor,
  isWriteAction,
} from "../lib/actions.js";

test("actions expose the v1.0.0 builtin whitelist", () => {
  assert.deepEqual(
    [...BUILTIN_ACTIONS].sort(),
    [...STANDARD_ONEBOT_ACTIONS, "send_group_forward_msg"].sort(),
  );
  assert.equal(isWriteAction("send_group_msg"), true);
  assert.equal(isWriteAction("get_group_list"), false);
});

test("actions use configured whitelist when provided", () => {
  assert.deepEqual(allowedActionsFor(), BUILTIN_ACTIONS);
  assert.deepEqual(allowedActionsFor({ enabledActions: ["send_group_msg"] }), [
    "send_group_msg",
  ]);
});

test("actions reject unsupported and missing actions", () => {
  assert.throws(
    () => assertActionSupported("set_group_level", {}),
    /Unsupported action: set_group_level/,
  );
  assert.throws(
    () => assertActionSupported(undefined, {}),
    /action is required/,
  );
  assert.doesNotThrow(() =>
    assertActionSupported("set_group_level", { allowUnknownActions: true }),
  );
});
