import test from "node:test";
import assert from "node:assert/strict";
import { loadPluginHarness } from "../../test/plugin-harness.js";

test("admin-console toggle disposes plugin and persists disabled override", async () => {
  const harness = await loadPluginHarness("admin-console");
  try {
    let disposed = 0;
    const wrapper = {
      id: "demo",
      type: "capability",
      name: "Demo",
      version: "1.0.0",
      enabled: true,
      status: "ready",
      manifest: { id: "demo", dependencies: [] },
      async dispose() {
        disposed += 1;
      },
    };
    harness.registry.register(wrapper);

    const instance = harness.registry.get("admin-console").instance;
    let response;
    await instance.handleToggle({
      req: { socket: { remoteAddress: "127.0.0.1" } },
      url: new URL("http://localhost/api/plugins/toggle?id=demo"),
      sendJson: (status, data) => {
        response = { status, data };
      },
    });

    assert.equal(response.status, 200);
    assert.equal(response.data.enabled, false);
    assert.equal(disposed, 1);
    assert.equal(harness.registry.get("demo").enabled, false);
    assert.equal(instance.state.getEnabledOverrides().demo, false);
  } finally {
    await harness.cleanup();
  }
});

test("admin-console blocks disabling plugin with dependents", async () => {
  const harness = await loadPluginHarness("admin-console");
  try {
    let baseDisposed = 0;
    const base = {
      id: "base",
      type: "capability",
      name: "Base",
      version: "1.0.0",
      enabled: true,
      status: "ready",
      manifest: { id: "base", dependencies: [] },
      async dispose() {
        baseDisposed += 1;
      },
    };
    const app = {
      id: "app",
      type: "capability",
      name: "App",
      version: "1.0.0",
      enabled: true,
      status: "ready",
      manifest: { id: "app", dependencies: ["base"] },
      async dispose() {},
    };
    harness.registry.register(base);
    harness.registry.register(app);

    const instance = harness.registry.get("admin-console").instance;
    await assert.rejects(
      instance.handleToggle({
        req: { socket: { remoteAddress: "127.0.0.1" } },
        url: new URL("http://localhost/api/plugins/toggle?id=base"),
        sendJson: () => {},
      }),
      /depend on base/,
    );
    assert.equal(baseDisposed, 0);
    assert.equal(harness.registry.get("base").enabled, true);
  } finally {
    await harness.cleanup();
  }
});

test("admin-console dispose removes own routes and stops reconcile work", async () => {
  const harness = await loadPluginHarness("admin-console");
  try {
    const instance = harness.registry.get("admin-console").instance;
    assert.ok(harness.apiRouter.routes.some((route) => route._adminConsole === true));

    await instance.dispose();
    assert.equal(instance.disposed, true);
    assert.equal(
      harness.apiRouter.routes.some((route) => route._adminConsole === true),
      false,
    );
  } finally {
    await harness.cleanup();
  }
});
