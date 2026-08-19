import test from "node:test";
import assert from "node:assert/strict";
import { assertActionAllowed } from "../lib/action-policy.js";

test("action policy rejects unknown actions", () => {
  assert.throws(
    () => assertActionAllowed("unknown_action", {}, { allowUnknownActions: false }),
    /Unsupported action/,
  );
});

test("action policy requires actor and scene for sending", () => {
  assert.throws(
    () => assertActionAllowed("send_group_msg", {}, {}),
    /requires actor and scene/,
  );
});

test("action policy requires admin for delete", () => {
  assert.throws(
    () =>
      assertActionAllowed(
        "delete_msg",
        {
          actor: { id: "1", admin: false },
          scene: { type: "group", id: "2" },
        },
        {},
      ),
    /requires admin/,
  );
});
