import test from "node:test";
import assert from "node:assert/strict";
import { loadPluginHarness } from "../../test/plugin-harness.js";

test("action-qq loads with protocol-onebot dependency", async () => {
  const harness = await loadPluginHarness("action-qq", {
    pluginConfigOverrides: { "protocol-onebot": { autoConnect: false } },
  });
  try {
    assert.ok(harness.registry.get("action-qq"));
    assert.equal(
      harness.registry.get("action-qq").manifest.dependencies[0],
      "protocol-onebot",
    );
    assert.ok(harness.registry.get("protocol-onebot"));
  } finally {
    await harness.cleanup();
  }
});
