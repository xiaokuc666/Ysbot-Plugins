import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { importCoreModule } from "../../tools/lib/core.js";
import { packPlugin } from "../../tools/lib/pack.js";
import { resolveCoreDir } from "../../tools/lib/workspace.js";
import {
  installPlg,
  locateInstalledPlgFile,
  reconcilePlgFiles,
  updatePlugin,
} from "../lib/plugin-ops.js";

test("plugin file lookup never leaves pluginDir", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ysbot-ops-path-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const pluginDir = path.join(root, "plugins");
  await fs.mkdir(pluginDir, { recursive: true });
  const otherSrc = path.join(root, "src-other", "other");
  await fs.mkdir(otherSrc, { recursive: true });
  await fs.writeFile(
    path.join(otherSrc, "plugin.json"),
    JSON.stringify({ id: "other", type: "capability", version: "1.0.0" }),
    "utf8",
  );
  await fs.writeFile(
    path.join(otherSrc, "index.js"),
    "export default class Other {}",
    "utf8",
  );
  const otherPacked = await packPlugin(otherSrc, path.join(root, "out"));
  await fs.copyFile(otherPacked.file, path.join(pluginDir, "other.plg"));
  const ctx = {
    config: { pluginDir },
    pluginManager: { sources: new Map() },
    registry: { list: () => [] },
  };
  const state = { data: { plgFiles: { demo: "other.plg" } } };
  const result = await locateInstalledPlgFile(ctx, state, "demo");
  assert.equal(result, null);
});

test("reconcile removes duplicate plg files and keeps highest version", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ysbot-reconcile-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const pluginDir = path.join(root, "plugins");
  const outDir = path.join(root, "out");
  await fs.mkdir(pluginDir, { recursive: true });
  for (const version of ["1.0.0", "2.0.0"]) {
    const src = path.join(root, `src-${version}`, "demo");
    await fs.mkdir(src, { recursive: true });
    await fs.writeFile(
      path.join(src, "plugin.json"),
      JSON.stringify({
        id: "demo",
        type: "capability",
        version,
      }),
      "utf8",
    );
    await fs.writeFile(
      path.join(src, "index.js"),
      `export default class Demo { async invoke() { return "${version}"; } }`,
      "utf8",
    );
    const packed = await packPlugin(src, outDir);
    await fs.copyFile(packed.file, path.join(pluginDir, `demo-${version}.plg`));
  }
  await fs.writeFile(path.join(pluginDir, "demo-1.0.0.plg.bak"), "stale");
  await fs.writeFile(path.join(pluginDir, "demo.plg"), "corrupt");
  const ctx = {
    config: { pluginDir },
    pluginManager: { sources: new Map() },
    registry: { list: () => [] },
  };
  const result = await reconcilePlgFiles(ctx);
  assert.equal(result.quarantined.length, 2);
  const files = await fs.readdir(pluginDir);
  assert.ok(files.includes("demo-2.0.0.plg"));
  assert.ok(files.includes(".quarantine"));
  const quarantineFiles = await fs.readdir(path.join(pluginDir, ".quarantine"));
  assert.equal(quarantineFiles.length, 2);
});

test("update restores old plugin when new version fails dependencies", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ysbot-update-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const oldSrc = path.join(root, "src-old", "demo");
  const newSrc = path.join(root, "src-new", "demo");
  const pluginDir = path.join(root, "plugins");
  const outDir = path.join(root, "out");
  await fs.mkdir(oldSrc, { recursive: true });
  await fs.mkdir(newSrc, { recursive: true });
  await fs.mkdir(pluginDir, { recursive: true });

  for (const [dir, version, deps] of [
    [oldSrc, "1.0.0", []],
    [newSrc, "2.0.0", ["missing"]],
  ]) {
    await fs.writeFile(
      path.join(dir, "plugin.json"),
      JSON.stringify({
        id: "demo",
        type: "capability",
        name: "Demo",
        version,
        dependencies: deps,
      }),
      "utf8",
    );
    await fs.writeFile(
      path.join(dir, "index.js"),
      `export default class Demo { async invoke() { return { version: "${version}" }; } }`,
      "utf8",
    );
  }

  const oldResult = await packPlugin(oldSrc, outDir);
  const newResult = await packPlugin(newSrc, outDir);
  await fs.copyFile(oldResult.file, path.join(pluginDir, "demo-1.0.0.plg"));

  const { PluginRegistry } = await importCoreModule(
    resolveCoreDir(),
    "src/core/plugin-registry.js",
  );
  const { PluginManager } = await importCoreModule(
    resolveCoreDir(),
    "src/core/plugin-manager.js",
  );
  const registry = new PluginRegistry();
  const manager = new PluginManager({
    registry,
    pluginDir,
    cacheDir: path.join(root, "cache"),
    dataDir: path.join(root, "data", "plugins"),
    contextFactory: () => ({}),
  });
  await manager.loadAll({ ids: ["demo"] });

  const state = {
    data: { plgFiles: { demo: "demo-1.0.0.plg" }, errors: {} },
    async setPlgFile(id, name) {
      this.data.plgFiles[id] = name;
    },
    async deletePlgFile(id) {
      delete this.data.plgFiles[id];
    },
  };
  const ctx = {
    registry,
    pluginManager: manager,
    config: { pluginDir },
  };
  const newBase64 = (
    await fs.readFile(newResult.file)
  ).toString("base64");

  await assert.rejects(
    updatePlugin({
      ctx,
      state,
      id: "demo",
      fileName: "demo-2.0.0.plg",
      plgBase64: newBase64,
    }),
    /missing/,
  );

  const restored = registry.get("demo");
  assert.ok(restored);
  assert.equal(restored.version, "1.0.0");
  assert.equal(state.data.plgFiles.demo, "demo-1.0.0.plg");
  const files = await fs.readdir(pluginDir);
  assert.ok(files.includes("demo-1.0.0.plg"));
  assert.equal(files.some((file) => file.endsWith(".bak")), false);
});

test("install cleans registry when state write fails", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ysbot-install-state-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const src = path.join(root, "src", "demo");
  const pluginDir = path.join(root, "plugins");
  const outDir = path.join(root, "out");
  await fs.mkdir(src, { recursive: true });
  await fs.mkdir(pluginDir, { recursive: true });
  await fs.writeFile(
    path.join(src, "plugin.json"),
    JSON.stringify({
      id: "demo",
      type: "capability",
      version: "1.0.0",
    }),
    "utf8",
  );
  await fs.writeFile(
    path.join(src, "index.js"),
    "export default class Demo { async invoke() { return { ok: true }; } }",
    "utf8",
  );
  const packed = await packPlugin(src, outDir);

  const { PluginRegistry } = await importCoreModule(
    resolveCoreDir(),
    "src/core/plugin-registry.js",
  );
  const { PluginManager } = await importCoreModule(
    resolveCoreDir(),
    "src/core/plugin-manager.js",
  );
  const registry = new PluginRegistry();
  const manager = new PluginManager({
    registry,
    pluginDir,
    cacheDir: path.join(root, "cache"),
    dataDir: path.join(root, "data", "plugins"),
    contextFactory: () => ({}),
  });
  const state = {
    data: { plgFiles: {}, errors: {} },
    async setPlgFile() {
      throw new Error("state write failed");
    },
    async deletePlgFile() {},
  };

  await assert.rejects(
    installPlg({
      ctx: { registry, pluginManager: manager, config: { pluginDir } },
      state,
      fileName: "demo-1.0.0.plg",
      plgBase64: (await fs.readFile(packed.file)).toString("base64"),
    }),
    /state write failed/,
  );
  assert.equal(registry.get("demo"), undefined);
  assert.deepEqual(await fs.readdir(pluginDir), []);
});
