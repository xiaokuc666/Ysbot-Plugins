import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  collectAdminMetadata,
  loadAdminMetadata,
} from "../lib/admin-metadata.js";

test("admin metadata collects config and page declarations", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ysbot-admin-meta-"));
  const pluginDir = path.join(root, "demo");
  await fs.mkdir(pluginDir, { recursive: true });
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await fs.writeFile(
    path.join(pluginDir, "admin-console.json"),
    JSON.stringify({
      version: 1,
      config: {
        title: "Demo Config",
        schema: {
          type: "object",
          properties: {
            enabled: { type: "boolean", default: true },
          },
        },
        actions: [
          {
            id: "ping",
            label: "Ping",
            path: "/api/plugins/demo/admin/ping",
            body: { value: "$enabled" },
          },
        ],
      },
      pages: [
        {
          id: "memory",
          title: "Memory",
          entry: "/api/plugins/demo/admin/memory",
        },
      ],
    }),
    "utf8",
  );

  const ctx = {
    config: { pluginDir: root },
    pluginManager: { sources: new Map([["demo", { dir: pluginDir }]]) },
    registry: { list: () => [{ id: "demo" }] },
  };
  const metadata = await collectAdminMetadata(ctx);
  assert.equal(metadata.get("demo").config.title, "Demo Config");
  assert.equal(metadata.get("demo").config.actions[0].id, "ping");
  assert.equal(metadata.get("demo").config.actions[0].requiresSave, true);
  assert.equal(metadata.get("demo").pages[0].id, "memory");

  const direct = await loadAdminMetadata(ctx, "demo");
  assert.equal(direct.pages[0].entry, "/api/plugins/demo/admin/memory");
});
