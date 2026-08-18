import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const pluginDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

test("admin-console.json exposes config and status page", async () => {
  const manifest = JSON.parse(
    await fs.readFile(path.join(pluginDir, "admin-console.json"), "utf8"),
  );
  assert.equal(manifest.version, 1);
  assert.ok(manifest.config.schema.properties.enabledActions);
  assert.ok(manifest.config.schema.properties.maxMessageLength);
  assert.deepEqual(manifest.config.secrets, []);
  assert.deepEqual(manifest.pages, [
    {
      id: "chat",
      title: "QQ 聊天",
      entry: "/api/plugins/action-qq/admin/chat",
      theme: "shared",
    },
    {
      id: "status",
      title: "QQ 动作状态",
      entry: "/api/plugins/action-qq/admin/status",
      theme: "shared",
    },
  ]);
});
