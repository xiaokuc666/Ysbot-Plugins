import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { createPlugin } from "../tools/lib/scaffold.js";

test("scaffold creates a complete plugin directory", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ysbot-tools-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const target = await createPlugin({
    type: "capability",
    id: "demo-tool",
    name: "Demo Tool",
    description: "Scaffolded by tools test",
    role: "user",
    depends: [],
    root,
  });

  assert.equal(path.basename(target), "demo-tool");
  for (const file of [
    "plugin.json",
    "index.js",
    "README.md",
    "test/demo-tool.test.js",
  ]) {
    await fs.access(path.join(target, file));
  }
  const manifest = JSON.parse(
    await fs.readFile(path.join(target, "plugin.json"), "utf8"),
  );
  assert.equal(manifest.id, "demo-tool");
  assert.equal(manifest.type, "capability");
  assert.equal(manifest.role, "user");
});
