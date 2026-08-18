import test from "node:test";
import assert from "node:assert/strict";
import { assertActionPermission } from "../lib/permissions.js";

const groupContext = {
  actor: { id: "200000001", admin: false },
  scene: { type: "group", id: "100000001" },
};

test("permissions require actor and scene for write actions", () => {
  assert.throws(
    () => assertActionPermission("send_group_msg", { group_id: "1" }, {}),
    /requires actor and scene/,
  );
});

test("permissions require matching group targets", () => {
  assert.throws(
    () =>
      assertActionPermission(
        "send_group_msg",
        { group_id: "999" },
        groupContext,
      ),
    /target does not match scene/,
  );
  assert.doesNotThrow(() =>
    assertActionPermission(
      "send_group_msg",
      { group_id: "100000001" },
      groupContext,
    ),
  );
});

test("permissions require matching private targets", () => {
  const context = {
    actor: { id: "200000001", admin: false },
    scene: { type: "private", id: "200000001" },
  };
  assert.throws(
    () =>
      assertActionPermission("send_private_msg", { user_id: "999" }, context),
    /target does not match scene/,
  );
  assert.doesNotThrow(() =>
    assertActionPermission("send_private_msg", { user_id: "200000001" }, context),
  );
});

test("delete_msg follows group role hierarchy", () => {
  const member = {
    actor: { id: "200000001", role: "member" },
    scene: { type: "group", id: "100000001" },
    target: { id: "300000001", role: "member" },
  };
  assert.throws(
    () => assertActionPermission("delete_msg", { message_id: "1" }, member),
    /requires owner or admin permission/,
  );
  assert.doesNotThrow(() =>
    assertActionPermission(
      "delete_msg",
      { message_id: "1" },
      {
        ...member,
        messageOwnerId: "200000001",
      },
    ),
  );
  assert.doesNotThrow(() =>
    assertActionPermission(
      "delete_msg",
      {
        message_id: "1",
        targetRole: "member",
      },
      {
        ...member,
        actor: { id: "200000001", role: "admin" },
      },
    ),
  );
  assert.throws(
    () =>
      assertActionPermission(
        "delete_msg",
        { message_id: "1" },
        {
          ...member,
          actor: { id: "200000001", role: "admin" },
          target: { id: "300000001", role: "admin" },
        },
      ),
    /requires owner permission for this target/,
  );
  assert.doesNotThrow(() =>
      assertActionPermission(
        "delete_msg",
        { message_id: "1" },
        {
          ...member,
          actor: { id: "200000001", role: "owner" },
          target: { id: "300000001", role: "admin" },
        },
      ),
  );
});

test("set_group_admin and special title require owner", () => {
  const context = {
    actor: { id: "200000001", role: "admin" },
    scene: { type: "group", id: "100000001" },
    target: { id: "300000001", role: "member" },
  };
  assert.throws(
    () =>
      assertActionPermission(
        "set_group_admin",
        { group_id: "100000001", user_id: "300000001", enable: true },
        context,
      ),
    /requires group owner/,
  );
  assert.doesNotThrow(() =>
    assertActionPermission(
      "set_group_special_title",
      {
        group_id: "100000001",
        user_id: "300000001",
        special_title: "title",
        duration: 0,
      },
      {
        ...context,
        actor: { id: "200000001", role: "owner" },
      },
    ),
  );
});

test("query actions do not require actor or scene", () => {
  assert.doesNotThrow(() =>
    assertActionPermission("get_group_list", {}, {}),
  );
});
