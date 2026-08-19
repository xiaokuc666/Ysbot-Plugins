import test from "node:test";
import assert from "node:assert/strict";
import { loadPluginHarness } from "../../test/plugin-harness.js";

test("protocol-onebot loads and registers status routes", async () => {
  const harness = await loadPluginHarness("protocol-onebot", {
    configOverrides: { autoConnect: false },
  });
  try {
    const plugin = harness.registry.get("protocol-onebot");
    assert.ok(plugin);
    assert.equal(plugin.type, "protocol");
    assert.equal(harness.protocolBridge.adapter, plugin.instance);

    const paths = harness.apiRouter.routes.map((route) => route.path);
    assert.ok(paths.includes("/api/plugins/protocol-onebot/admin/status"));
    assert.ok(paths.includes("/api/plugins/protocol-onebot/admin/status.json"));
    assert.ok(paths.includes("/api/plugins/protocol-onebot/admin/reconnect"));
  } finally {
    await harness.cleanup();
  }
});

test("protocol-onebot rejects unsupported actions", async () => {
  const harness = await loadPluginHarness("protocol-onebot", {
    configOverrides: { autoConnect: false },
  });
  try {
    await assert.rejects(
      harness.registry.invoke("protocol-onebot", {
        action: "unknown_action",
        params: {},
        context: {},
      }),
      /Unsupported action/,
    );
  } finally {
    await harness.cleanup();
  }
});

test("protocol-onebot status routes return status and html", async () => {
  const harness = await loadPluginHarness("protocol-onebot", {
    configOverrides: { autoConnect: false },
  });
  try {
    const status = { status: 0, data: null };
    await harness.apiRouter.dispatch(
      { method: "GET", socket: { remoteAddress: "127.0.0.1" } },
      { writeHead() {}, end() {} },
      new URL("http://localhost/api/plugins/protocol-onebot/admin/status.json"),
      {
        sendJson: (code, data) => {
          status.status = code;
          status.data = data;
        },
        sendHtml: () => {},
      },
    );
    assert.equal(status.status, 200);
    assert.equal(status.data.ok, true);
    assert.equal(status.data.status.connected, false);
  } finally {
    await harness.cleanup();
  }
});

test("protocol-onebot rejects sensitive action without admin", async () => {
  const harness = await loadPluginHarness("protocol-onebot", {
    configOverrides: { autoConnect: false },
  });
  try {
    const instance = harness.registry.get("protocol-onebot").instance;
    await assert.rejects(
      instance.send(
        "delete_msg",
        { message_id: 1 },
        {
          actor: { id: "1", admin: false },
          scene: { type: "group", id: "2" },
        },
      ),
      /requires admin/,
    );
  } finally {
    await harness.cleanup();
  }
});

test("protocol-onebot merges invoke call context", async () => {
  const harness = await loadPluginHarness("protocol-onebot", {
    configOverrides: { autoConnect: false },
  });
  try {
    const instance = harness.registry.get("protocol-onebot").instance;
    instance.httpClient.url = null;
    await assert.rejects(
      instance.invoke(
        { action: "send_group_msg", params: { group_id: "1", message: "hi" } },
        {
          actor: { id: "1", admin: false },
          scene: { type: "group", id: "2" },
        },
      ),
      /HTTP URL is not configured|not connected/,
    );
  } finally {
    await harness.cleanup();
  }
});

test("protocol-onebot removes own routes on dispose", async () => {
  const harness = await loadPluginHarness("protocol-onebot", {
    configOverrides: { autoConnect: false },
  });
  try {
    const instance = harness.registry.get("protocol-onebot").instance;
    const before = harness.apiRouter.routes
      .map((route) => route.path)
      .filter((path) => path.startsWith("/api/plugins/protocol-onebot/admin/"));
    assert.equal(before.length, 3);

    await instance.dispose();
    const after = harness.apiRouter.routes
      .map((route) => route.path)
      .filter((path) => path.startsWith("/api/plugins/protocol-onebot/admin/"));
    assert.equal(after.length, 0);
  } finally {
    await harness.cleanup();
  }
});
