import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { importCoreModule } from "../../tools/lib/core.js";
import { resolveCoreDir } from "../../tools/lib/workspace.js";
import {
  getConfigSnapshot,
  saveConfig,
} from "../lib/config.js";

test("admin config saves normal values and keeps secrets redacted", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ysbot-admin-config-"));
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
    pluginConfig: new PluginConfigStore({
      dataDir: path.join(root, "plugins"),
      secrets: new SecretsStore(path.join(root, "secrets")),
    }),
  };
  const metadata = {
    config: {
      title: "Demo",
      schema: {
        type: "object",
        properties: {
          name: { type: "string", default: "demo" },
          apiKey: { type: "string", secret: true },
        },
      },
      secrets: [],
    },
  };
  const saved = await saveConfig(ctx, "demo", metadata, {
    name: "updated",
    apiKey: "secret-value",
  });
  assert.equal(saved.values.name, "updated");
  assert.equal(saved.secretState.apiKey, true);
  assert.equal(saved.values.apiKey, undefined);

  const snapshot = await getConfigSnapshot(ctx, "demo", metadata);
  assert.equal(snapshot.values.name, "updated");
  assert.equal(snapshot.values.apiKey, undefined);
  assert.equal(await ctx.pluginConfig.getSecret("demo", "apiKey"), "secret-value");
});
