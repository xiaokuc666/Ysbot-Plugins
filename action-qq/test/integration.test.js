import test from "node:test";
import assert from "node:assert/strict";
import { loadPluginHarness } from "../../test/plugin-harness.js";

function isQqActionError(error, code) {
  return error?.name === "QqActionError" && error.code === code;
}

function installFakeProtocol(harness, calls, behavior = {}) {
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
      if (behavior.error) throw behavior.error;
      return {
        status: "ok",
        retcode: 0,
        data: { message_id: 42 },
      };
    },
  });
}

test("action-qq sends group messages through protocol-onebot", async () => {
  const harness = await loadPluginHarness("action-qq", {
    pluginConfigOverrides: { "protocol-onebot": { autoConnect: false } },
  });
  try {
    const calls = [];
    installFakeProtocol(harness, calls);
    const result = await harness.invoke({
      action: "send_group_msg",
      params: {
        group_id: "100000001",
        message: [{ type: "text", data: { text: "晚上好" } }],
      },
      context: {
        traceId: "trace-test",
        actor: { id: "200000001", admin: false },
        scene: { type: "group", id: "100000001" },
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.action, "send_group_msg");
    assert.equal(result.data.message_id, 42);
    assert.equal(calls[0].params.action, "send_group_msg");
    assert.equal(calls[0].params.params.group_id, "100000001");
    assert.equal(calls[0].params.context.traceId, "trace-test");
    const logs = await harness.logging.read("action-qq", { limit: 10 });
    assert.ok(logs.some((entry) => entry.message.includes("send_group_msg ok")));
  } finally {
    await harness.cleanup();
  }
});

test("action-qq rejects delete_msg without admin or approval", async () => {
  const harness = await loadPluginHarness("action-qq", {
    pluginConfigOverrides: { "protocol-onebot": { autoConnect: false } },
  });
  try {
    const calls = [];
    installFakeProtocol(harness, calls);
    await assert.rejects(
      harness.invoke({
        action: "delete_msg",
        params: { message_id: "1" },
        context: {
          actor: { id: "200000001", admin: false },
          scene: { type: "group", id: "100000001" },
        },
      }),
      (error) =>
        isQqActionError(error, "PERMISSION_DENIED"),
    );
    assert.equal(
      calls.some((call) => call.params.action === "delete_msg"),
      false,
    );
  } finally {
    await harness.cleanup();
  }
});

test("action-qq sends private messages through protocol-onebot", async () => {
  const harness = await loadPluginHarness("action-qq", {
    pluginConfigOverrides: { "protocol-onebot": { autoConnect: false } },
  });
  try {
    const calls = [];
    installFakeProtocol(harness, calls);
    const result = await harness.invoke({
      action: "send_private_msg",
      params: {
        user_id: "200000001",
        message: [{ type: "text", data: { text: "hello" } }],
      },
      context: {
        actor: { id: "200000001", admin: false },
        scene: { type: "private", id: "200000001" },
      },
    });

    assert.equal(result.ok, true);
    assert.equal(calls[0].params.params.user_id, "200000001");
  } finally {
    await harness.cleanup();
  }
});

test("action-qq allows admin delete and query actions", async () => {
  const harness = await loadPluginHarness("action-qq", {
    pluginConfigOverrides: { "protocol-onebot": { autoConnect: false } },
  });
  try {
    const calls = [];
    installFakeProtocol(harness, calls);
    const context = {
      actor: { id: "200000001", role: "admin" },
      scene: { type: "group", id: "100000001" },
      target: { id: "300000001", role: "member" },
    };
    const deleted = await harness.invoke({
      action: "delete_msg",
      params: { message_id: "1" },
      context,
    });
    assert.equal(deleted.ok, true);

    const list = await harness.invoke({
      action: "get_group_list",
      params: {},
      context: {},
    });
    assert.equal(list.ok, true);
    assert.equal(list.data.message_id, 42);
    assert.equal(calls.length, 2);
  } finally {
    await harness.cleanup();
  }
});

test("action-qq dispatches group management actions", async () => {
  const harness = await loadPluginHarness("action-qq", {
    pluginConfigOverrides: { "protocol-onebot": { autoConnect: false } },
  });
  try {
    const calls = [];
    installFakeProtocol(harness, calls);
    const context = {
      actor: { id: "200000001", admin: true },
      scene: { type: "group", id: "100000001" },
    };
    const banned = await harness.invoke({
      action: "set_group_ban",
      params: {
        group_id: "100000001",
        user_id: "200000001",
        duration: 600,
      },
      context,
    });
    assert.equal(banned.ok, true);
    const banCall = calls.find(
      (call) => call.params.action === "set_group_ban",
    );
    assert.equal(banCall.params.params.duration, 600);
  } finally {
    await harness.cleanup();
  }
});

test("action-qq dispatches forward messages", async () => {
  const harness = await loadPluginHarness("action-qq", {
    pluginConfigOverrides: { "protocol-onebot": { autoConnect: false } },
  });
  try {
    const calls = [];
    installFakeProtocol(harness, calls);
    const result = await harness.invoke({
      action: "send_group_forward_msg",
      params: {
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
      context: {
        actor: { id: "200000001", admin: false },
        scene: { type: "group", id: "100000001" },
      },
    });
    assert.equal(result.ok, true);
    assert.equal(calls[0].params.action, "send_group_forward_msg");
  } finally {
    await harness.cleanup();
  }
});

test("action-qq converts protocol errors to QqActionError", async () => {
  const harness = await loadPluginHarness("action-qq", {
    pluginConfigOverrides: { "protocol-onebot": { autoConnect: false } },
  });
  try {
    const calls = [];
    const protocolError = Object.assign(new Error("bad request"), {
      code: "ONEBOT_FAILED",
      retcode: 100,
      wording: "bad request",
    });
    installFakeProtocol(harness, calls, { error: protocolError });

    await assert.rejects(
      harness.invoke({
        action: "send_group_msg",
        params: {
          group_id: "100000001",
          message: "hello",
        },
        context: {
          actor: { id: "200000001", admin: false },
          scene: { type: "group", id: "100000001" },
        },
      }),
      (error) =>
        isQqActionError(error, "ONEBOT_FAILED") &&
        error.retcode === 100,
    );
  } finally {
    await harness.cleanup();
  }
});

test("action-qq generates a traceId when one is not provided", async () => {
  const harness = await loadPluginHarness("action-qq", {
    pluginConfigOverrides: { "protocol-onebot": { autoConnect: false } },
  });
  try {
    const calls = [];
    installFakeProtocol(harness, calls);
    await harness.invoke({
      action: "get_login_info",
      params: {},
      context: {},
    });
    assert.ok(calls[0].params.context.traceId);
    assert.match(calls[0].params.context.traceId, /^trace-/);
  } finally {
    await harness.cleanup();
  }
});
