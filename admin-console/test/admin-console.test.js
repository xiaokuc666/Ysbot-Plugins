import test from "node:test";
import assert from "node:assert/strict";
import { loadPluginHarness } from "../../test/plugin-harness.js";

test("admin-console loads and registers management routes", async () => {
  const harness = await loadPluginHarness("admin-console");
  try {
    const plugin = harness.registry.get("admin-console");
    assert.ok(plugin);
    assert.equal(plugin.type, "system");
    assert.equal(plugin.version, "1.0.2");

    const exactPaths = harness.apiRouter.routes.map((route) => route.path);
    assert.ok(exactPaths.includes("/api/plugins"));
    assert.ok(exactPaths.includes("/api/status"));
    assert.ok(exactPaths.includes("/api/logs"));
    assert.ok(exactPaths.includes("/api/admin-console/config"));
    assert.ok(exactPaths.includes("/api/admin-console/pages"));
    assert.ok(exactPaths.includes("/api/admin-console/theme"));
    assert.ok(exactPaths.includes("/api/admin-console/design-tokens.css"));
    assert.ok(exactPaths.includes("/api/plugins/detail"));
    assert.ok(exactPaths.includes("/api/plugins/toggle"));
    assert.ok(exactPaths.includes("/api/plugins/reload"));
    assert.ok(exactPaths.includes("/api/plugins/uninstall"));
    assert.ok(exactPaths.includes("/api/admin-console/config/detail"));
    assert.ok(exactPaths.includes("/api/admin-console/pages/meta"));
    assert.equal(harness.apiRouter._ysbotDynamicRouter, undefined);
  } finally {
    await harness.cleanup();
  }
});
