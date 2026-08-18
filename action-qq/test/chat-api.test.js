import test from "node:test";
import assert from "node:assert/strict";
import { loadPluginHarness } from "../../test/plugin-harness.js";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeout = 3000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (predicate()) return;
    await delay(10);
  }
  throw new Error("waitFor timeout");
}

function installFakeProtocol(harness, calls, options = {}) {
  harness.registry.unregister("protocol-onebot");
  harness.registry.register({
    id: "protocol-onebot",
    type: "protocol",
    name: "Fake OneBot",
    version: "1.0.0",
    enabled: true,
    status: "ready",
    manifest: { id: "protocol-onebot", dependencies: [] },
    async dispose() {},
    async invoke(params, context) {
      calls.push({ params, context });
      if (params.action === "get_login_info") {
        return { status: "ok", retcode: 0, data: { user_id: 100000001 } };
      }
      if (params.action === "get_group_list") {
        return {
          status: "ok",
          retcode: 0,
          data: [
            { group_id: "100000001", group_name: "测试群" },
          ],
        };
      }
      if (params.action === "get_friend_list") {
        return {
          status: "ok",
          retcode: 0,
          data: [{ user_id: "300000001", nickname: "好友" }],
        };
      }
      if (params.action === "get_group_member_info") {
        return {
          status: "ok",
          retcode: 0,
          data: { user_id: params.params.user_id, role: "owner" },
        };
      }
      if (params.action === "get_msg") {
        if (options.getMsgReturnsMessage) {
          return {
            status: "ok",
            retcode: 0,
            data: { message_id: params.params.message_id },
          };
        }
        throw Object.assign(new Error("message not found"), {
          code: "ONEBOT_FAILED",
        });
      }
      return {
        status: "ok",
        retcode: 0,
        data: { message_id: 42 },
      };
    },
  });
}

test("chat page captures incoming group messages", async () => {
  const harness = await loadPluginHarness("action-qq", {
    pluginConfigOverrides: { "protocol-onebot": { autoConnect: false } },
  });
  try {
    const instance = harness.registry.get("action-qq").instance;
    harness.eventBus.emit("onebot.message", {
      id: "1",
      message_type: "group",
      group_id: "100000001",
      user_id: "200000001",
      sender: { nickname: "a" },
      message: [{ type: "text", data: { text: "hello" } }],
      timestamp: 1700000000,
      raw: { message_id: "g1" },
    });
    await waitFor(() =>
      instance.chat.listMessages("group", "100000001").length === 1,
    );

    let response = null;
    await instance.handleChatMessages({
      url: new URL(
        "http://localhost/api/plugins/action-qq/admin/chat/messages?sceneType=group&sceneId=100000001",
      ),
      sendJson: (status, data) => {
        response = { status, data };
      },
    });
    assert.equal(response.status, 200);
    assert.equal(response.data.messages[0].text, "hello");
    assert.equal(response.data.messages[0].direction, "in");

    let scenesResponse = null;
    await instance.handleChatScenes({
      sendJson: (status, data) => {
        scenesResponse = { status, data };
      },
    });
    assert.equal(scenesResponse.data.scenes[0].id, "100000001");
  } finally {
    await harness.cleanup();
  }
});

test("chat contacts fetch group roles and friend list", async () => {
  const harness = await loadPluginHarness("action-qq", {
    pluginConfigOverrides: { "protocol-onebot": { autoConnect: false } },
  });
  try {
    const instance = harness.registry.get("action-qq").instance;
    const calls = [];
    installFakeProtocol(harness, calls);

    let response = null;
    await instance.handleChatContacts({
      url: new URL(
        "http://localhost/api/plugins/action-qq/admin/chat/contacts",
      ),
      sendJson: (status, data) => {
        response = { status, data };
      },
    });
    assert.equal(response.status, 200);
    assert.equal(response.data.selfId, "100000001");
    assert.equal(response.data.groups[0].role, "member");
    assert.equal(response.data.friends[0].id, "300000001");

    const role = await instance.resolveGroupRole("100000001");
    assert.equal(role, "owner");
    instance.contactsCache = null;
    const refreshed = await instance.loadContacts();
    assert.equal(refreshed.groups[0].role, "owner");
    const memberCalls = calls.filter(
      (call) => call.params.action === "get_group_member_info",
    );
    assert.equal(memberCalls.length, 1);

    const groupListCallsBefore = calls.filter(
      (call) => call.params.action === "get_group_list",
    ).length;
    let forcedResponse = null;
    await instance.handleChatContacts({
      url: new URL(
        "http://localhost/api/plugins/action-qq/admin/chat/contacts?force=1",
      ),
      sendJson: (status, data) => {
        forcedResponse = { status, data };
      },
    });
    assert.equal(forcedResponse.status, 200);
    const groupListCallsAfter = calls.filter(
      (call) => call.params.action === "get_group_list",
    ).length;
    assert.equal(groupListCallsAfter, groupListCallsBefore + 1);
  } finally {
    await harness.cleanup();
  }
});

test("chat page sends and recalls messages", async () => {
  const harness = await loadPluginHarness("action-qq", {
    pluginConfigOverrides: { "protocol-onebot": { autoConnect: false } },
  });
  try {
    const instance = harness.registry.get("action-qq").instance;
    const calls = [];
    installFakeProtocol(harness, calls);

    let sendResponse = null;
    await instance.handleChatSend({
      body: {
        sceneType: "group",
        sceneId: "100000001",
        message: [
          { type: "text", data: { text: "hello" } },
          { type: "at", data: { qq: "200000001" } },
        ],
      },
      sendJson: (status, data) => {
        sendResponse = { status, data };
      },
    });
    assert.equal(sendResponse.status, 200);
    assert.equal(sendResponse.data.message.direction, "out");
    assert.equal(calls[0].params.action, "send_group_msg");
    assert.deepEqual(calls[0].params.params.message, [
      { type: "text", data: { text: "hello" } },
      { type: "at", data: { qq: "200000001" } },
    ]);
    assert.deepEqual(sendResponse.data.message.segments, [
      { type: "text", data: { text: "hello" } },
      { type: "at", data: { qq: "200000001" } },
    ]);

    let deleteResponse = null;
    await instance.handleChatDelete({
      body: { messageId: "42" },
      sendJson: (status, data) => {
        deleteResponse = { status, data };
      },
    });
    assert.equal(deleteResponse.status, 200);
    assert.equal(calls[1].params.action, "delete_msg");
    assert.equal(instance.chat.findByMessageId("42").recalled, true);
  } finally {
    await harness.cleanup();
  }
});

test("chat clear removes current scene messages", async () => {
  const harness = await loadPluginHarness("action-qq", {
    pluginConfigOverrides: { "protocol-onebot": { autoConnect: false } },
  });
  try {
    const instance = harness.registry.get("action-qq").instance;
    const calls = [];
    installFakeProtocol(harness, calls);

    await instance.handleChatSend({
      body: {
        sceneType: "group",
        sceneId: "100000001",
        message: "hello",
      },
      sendJson: () => {},
    });
    assert.equal(instance.chat.listMessages("group", "100000001").length, 1);
    const before = await instance.loadContacts();
    assert.equal(before.groups.length, 1);

    let response = null;
    await instance.handleChatClear({
      body: { sceneType: "group", sceneId: "100000001" },
      sendJson: (status, data) => {
        response = { status, data };
      },
    });
    assert.equal(response.status, 200);
    assert.equal(instance.chat.listMessages("group", "100000001").length, 0);
    assert.equal(
      instance.chat.isSceneRemoved("group", "100000001"),
      true,
    );
    const after = await instance.loadContacts();
    assert.equal(after.groups.length, 0);
  } finally {
    await harness.cleanup();
  }
});

test("chat delete marks recalled after delete succeeds", async () => {
  const harness = await loadPluginHarness("action-qq", {
    pluginConfigOverrides: { "protocol-onebot": { autoConnect: false } },
  });
  try {
    const instance = harness.registry.get("action-qq").instance;
    const calls = [];
    installFakeProtocol(harness, calls, { getMsgReturnsMessage: true });

    await instance.handleChatSend({
      body: {
        sceneType: "group",
        sceneId: "100000001",
        message: "hello",
      },
      sendJson: () => {},
    });
    await instance.handleChatDelete({
      body: { messageId: "42" },
      sendJson: () => {},
    });
    assert.equal(instance.chat.findByMessageId("42").recalled, true);
  } finally {
    await harness.cleanup();
  }
});
