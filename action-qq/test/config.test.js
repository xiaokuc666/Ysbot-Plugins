import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { importCoreModule } from "../../tools/lib/core.js";
import { resolveCoreDir } from "../../tools/lib/workspace.js";
import { RESTRICTED_ACTIONS } from "../lib/actions.js";
import { loadPluginConfig } from "../lib/config.js";

test("config loads defaults without saved values", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ysbot-action-config-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const { SecretsStore } = await importCoreModule(
    resolveCoreDir(),
    "src/core/secrets.js",
  );
  const { PluginConfigStore } = await importCoreModule(
    resolveCoreDir(),
    "src/core/plugin-config.js",
  );
  const ctx = {
    manifest: { id: "action-qq" },
    pluginConfig: new PluginConfigStore({
      dataDir: path.join(root, "plugins"),
      secrets: new SecretsStore(path.join(root, "secrets")),
    }),
  };

  const config = await loadPluginConfig(ctx);
  assert.deepEqual(config.enabledActions, []);
  assert.equal(config.allowUnknownActions, false);
  assert.deepEqual(config.managementOnlyActions, RESTRICTED_ACTIONS);
  assert.deepEqual(config.requireApprovalActions, RESTRICTED_ACTIONS);
  assert.equal(config.maxMessageLength, 5000);
});
