import test from "node:test";
import assert from "node:assert/strict";
import { loadPluginHarness } from "../../test/plugin-harness.js";

test("action-qq registers status routes and log source", async () => {
  const harness = await loadPluginHarness("action-qq", {
    pluginConfigOverrides: { "protocol-onebot": { autoConnect: false } },
  });
  try {
    const paths = harness.apiRouter.routes.map((route) => route.path);
    assert.ok(paths.includes("/api/plugins/action-qq/admin/status"));
    assert.ok(paths.includes("/api/plugins/action-qq/admin/status.json"));
    assert.ok(paths.includes("/api/plugins/action-qq/admin/chat"));
    assert.ok(paths.includes("/api/plugins/action-qq/admin/chat/scenes"));
    assert.ok(paths.includes("/api/plugins/action-qq/admin/chat/contacts"));
    assert.ok(paths.includes("/api/plugins/action-qq/admin/chat/messages"));
    assert.ok(paths.includes("/api/plugins/action-qq/admin/chat/send"));
    assert.ok(paths.includes("/api/plugins/action-qq/admin/chat/delete"));
    assert.ok(paths.includes("/api/plugins/action-qq/admin/chat/clear"));
    assert.ok(
      harness.logging.list().some((source) => source.id === "action-qq"),
    );
  } finally {
    await harness.cleanup();
  }
});

test("action-qq dispose removes routes and log source", async () => {
  const harness = await loadPluginHarness("action-qq", {
    pluginConfigOverrides: { "protocol-onebot": { autoConnect: false } },
  });
  try {
    const instance = harness.registry.get("action-qq").instance;
    await instance.dispose();

    assert.equal(
      harness.apiRouter.routes.some((route) =>
        String(route.path || "").startsWith(
          "/api/plugins/action-qq/admin/",
        ),
      ),
      false,
    );
    harness.eventBus.emit("onebot.message", {
      message_type: "group",
      group_id: "100000001",
      user_id: "200000001",
      message: [{ type: "text", data: { text: "after dispose" } }],
      raw: { message_id: "after-dispose" },
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(instance.chat.listMessages("group", "100000001").length, 0);
    assert.equal(
      harness.logging.list().some((source) => source.id === "action-qq"),
      false,
    );

    let response = null;
    await instance.handleStatusJson({
      sendJson: (status, data) => {
        response = { status, data };
      },
    });
    assert.equal(response.status, 503);
    assert.equal(response.data.error, "action-qq is disabled");
  } finally {
    await harness.cleanup();
  }
});
