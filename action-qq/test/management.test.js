import test from "node:test";
import assert from "node:assert/strict";
import { validateManagementParams } from "../lib/management.js";
import { assertActionPermission } from "../lib/permissions.js";

test("management params validate group card and name", () => {
  assert.deepEqual(
    validateManagementParams("set_group_card", {
      group_id: "100000001",
      user_id: "200000001",
      card: "",
    }),
    {
      group_id: "100000001",
      user_id: "200000001",
      card: "",
    },
  );
  assert.deepEqual(
    validateManagementParams("set_group_name", {
      group_id: "100000001",
      group_name: "新群名",
    }).group_name,
    "新群名",
  );
  assert.throws(
    () =>
      validateManagementParams("set_group_name", {
        group_id: "100000001",
        group_name: "",
      }),
    /non-empty string/,
  );
});

test("management params validate bans, kicks and admins", () => {
  assert.doesNotThrow(() =>
    validateManagementParams("set_group_ban", {
      group_id: "100000001",
      user_id: "200000001",
      duration: 600,
    }),
  );
  assert.doesNotThrow(() =>
    validateManagementParams("set_group_whole_ban", {
      group_id: "100000001",
      enable: true,
    }),
  );
  assert.doesNotThrow(() =>
    validateManagementParams("set_group_kick", {
      group_id: "100000001",
      user_id: "200000001",
      reject_add_request: true,
    }),
  );
  assert.doesNotThrow(() =>
    validateManagementParams("set_group_admin", {
      group_id: "100000001",
      user_id: "200000001",
      enable: true,
    }),
  );
  assert.throws(
    () =>
      validateManagementParams("set_group_ban", {
        group_id: "100000001",
        user_id: "200000001",
        duration: -1,
      }),
    /non-negative integer/,
  );
});

test("management params validate special title and add requests", () => {
  assert.doesNotThrow(() =>
    validateManagementParams("set_group_special_title", {
      group_id: "100000001",
      user_id: "200000001",
      special_title: "管理员",
      duration: 86400,
    }),
  );
  assert.doesNotThrow(() =>
    validateManagementParams("set_friend_add_request", {
      flag: "flag-1",
      approve: true,
    }),
  );
  assert.doesNotThrow(() =>
    validateManagementParams("set_group_add_request", {
      flag: "flag-1",
      sub_type: "add",
      approve: false,
      reason: "no",
    }),
  );
});

test("send_group_forward_msg accepts node messages", () => {
  const result = validateManagementParams("send_group_forward_msg", {
    group_id: "100000001",
    messages: [
      {
        type: "node",
        data: {
          user_id: "200000001",
          nickname: "a",
          content: [{ type: "text", data: { text: "hello" } }],
        },
      },
    ],
  });
  assert.deepEqual(result.messages[0].data.content, [
    { type: "text", data: { text: "hello" } },
  ]);
  assert.throws(
    () =>
      validateManagementParams("send_group_forward_msg", {
        group_id: "100000001",
        messages: [{ type: "node", data: { user_id: "1" } }],
      }),
    /user_id\/nickname\/content/,
  );
});

test("standard OneBot params validate targets and ids", () => {
  assert.doesNotThrow(() =>
    validateManagementParams("send_msg", {
      message_type: "group",
      group_id: "100000001",
    }),
  );
  assert.throws(
    () =>
      validateManagementParams("send_msg", {
        message_type: "group",
      }),
    /group_id/,
  );
  assert.doesNotThrow(() =>
    validateManagementParams("get_msg", { message_id: "1" }),
  );
  assert.doesNotThrow(() =>
    validateManagementParams("get_image", { file: "a.png" }),
  );
  assert.doesNotThrow(() =>
    validateManagementParams("get_status", {}),
  );
});

test("management permissions require admin or approval", () => {
  const context = {
    actor: { id: "200000001", admin: false },
    scene: { type: "group", id: "100000001" },
  };
  assert.throws(
    () =>
      assertActionPermission(
        "set_group_ban",
        {
          group_id: "100000001",
          user_id: "200000001",
          duration: 60,
        },
        context,
      ),
    /requires admin or explicit approval/,
  );
  assert.doesNotThrow(() =>
    assertActionPermission(
      "set_group_ban",
      {
        group_id: "100000001",
        user_id: "200000001",
        duration: 60,
        targetRole: "member",
      },
      { ...context, approved: true },
    ),
  );
  assert.throws(
    () =>
      assertActionPermission(
        "set_group_ban",
        {
          group_id: "999",
          user_id: "200000001",
          duration: 60,
        },
        context,
      ),
    /target does not match scene/,
  );
});

test("send_group_forward_msg requires matching group scene", () => {
  const context = {
    actor: { id: "200000001", admin: true },
    scene: { type: "group", id: "100000001" },
  };
  assert.doesNotThrow(() =>
    assertActionPermission(
      "send_group_forward_msg",
      {
        group_id: "100000001",
        messages: [
          {
            type: "node",
            data: {
              user_id: "200000001",
              nickname: "a",
              content: "hello",
            },
          },
        ],
      },
      context,
    ),
  );
  assert.throws(
    () =>
      assertActionPermission(
        "send_group_forward_msg",
        {
          group_id: "999",
          messages: [],
        },
        context,
      ),
    /target does not match scene/,
  );
});
