import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { importCoreModule } from "../tools/lib/core.js";
import { loadPluginManifest } from "../tools/lib/manifests.js";
import {
  ensureDir,
  pluginsDir,
  resolveCoreDir,
} from "../tools/lib/workspace.js";

function createTestLogger(silent = false) {
  const noop = () => {};
  return {
    debug: noop,
    info: silent ? noop : (message) => console.log(message),
    warn: silent ? noop : (message) => console.warn(message),
    error: silent ? noop : (message) => console.error(message),
  };
}

async function readDependencies(pluginDir, id, seen = new Set(), deps = []) {
  if (seen.has(id)) return deps;
  seen.add(id);
  const manifest = await loadPluginManifest(path.join(pluginDir, id));
  for (const dependency of manifest.dependencies || []) {
    if (!deps.includes(dependency)) deps.push(dependency);
    await readDependencies(pluginDir, dependency, seen, deps);
  }
  return deps;
}

export async function loadPluginHarness(pluginId, options = {}) {
  const coreDir = resolveCoreDir(options.coreDir);
  const pluginDir = options.pluginDir
    ? path.resolve(options.pluginDir)
    : pluginsDir;
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "ysbot-plugin-harness-"),
  );

  const cacheDir = path.join(tempRoot, "cache");
  const dataDir = path.join(tempRoot, "data", "plugins");
  const secretsDir = path.join(tempRoot, "data", "secrets");
  const stateDir = path.join(tempRoot, "data", "state");
  await Promise.all([
    ensureDir(cacheDir),
    ensureDir(dataDir),
    ensureDir(secretsDir),
    ensureDir(stateDir),
  ]);

  const config = {
    dataDir: path.join(tempRoot, "data"),
    pluginDir,
    pluginCacheDir: cacheDir,
    pluginDataDir: dataDir,
    secretsDir,
    onebotWsUrl: "ws://127.0.0.1:3001",
    curiosityIntervalMs: 60000,
    managementPort: 0,
    managementHost: "127.0.0.1",
    managementUser: "admin",
    managementPassword: "admin",
  };

  const { EventBus } = await importCoreModule(
    coreDir,
    "src/core/event-bus.js",
  );
  const { TaskStore } = await importCoreModule(
    coreDir,
    "src/core/task-store.js",
  );
  const { Scheduler } = await importCoreModule(
    coreDir,
    "src/core/scheduler.js",
  );
  const { PluginRegistry } = await importCoreModule(
    coreDir,
    "src/core/plugin-registry.js",
  );
  const { PluginManager } = await importCoreModule(
    coreDir,
    "src/core/plugin-manager.js",
  );
  const { ApiRouter } = await importCoreModule(
    coreDir,
    "src/core/api-router.js",
  );
  const { SecretsStore } = await importCoreModule(
    coreDir,
    "src/core/secrets.js",
  );
  const { PluginConfigStore } = await importCoreModule(
    coreDir,
    "src/core/plugin-config.js",
  );
  const { FrameworkRuntime } = await importCoreModule(
    coreDir,
    "src/core/runtime.js",
  );
  const { ProtocolBridge } = await importCoreModule(
    coreDir,
    "src/core/protocol-bridge.js",
  );

  const eventBus = new EventBus();
  const runtime = new FrameworkRuntime(
    path.join(stateDir, "framework-runtime.json"),
  );
  await runtime.init();
  const taskStore = new TaskStore(path.join(stateDir, "tasks.json"));
  await taskStore.init();
  const apiRouter = new ApiRouter();
  const protocolBridge = new ProtocolBridge();
  const scheduler = new Scheduler({
    taskStore,
    tickMs: 60000,
    isPaused: () => false,
  });
  const secrets = new SecretsStore(secretsDir);
  const pluginConfig = new PluginConfigStore({
    dataDir,
    secrets,
  });
  const registry = new PluginRegistry();
  const logger = options.logger || createTestLogger(options.silent !== false);
  const runtimePluginDir = path.join(tempRoot, "plugin-dir");
  await ensureDir(runtimePluginDir);
  if (options.configOverrides) {
    const overrideDir = path.join(dataDir, pluginId);
    await ensureDir(overrideDir);
    await fs.writeFile(
      path.join(overrideDir, "config.json"),
      `${JSON.stringify(options.configOverrides, null, 2)}\n`,
      "utf8",
    );
  }
  let ctx = null;
  const manager = new PluginManager({
    registry,
    pluginDir: runtimePluginDir,
    cacheDir,
    dataDir,
    contextFactory: (manifest) => {
      ctx = {
        config,
        eventBus,
        taskStore,
        registry,
        secrets,
        pluginConfig,
        logger,
        manifest,
        runtime,
        scheduler,
        api: apiRouter,
        pluginManager: manager,
        protocol: protocolBridge,
        pluginDir: path.join(runtimePluginDir, manifest.id),
        cacheDir: null,
        dataDir: path.join(dataDir, manifest.id),
        sourceType: "directory",
      };
      return ctx;
    },
  });

  const dependencyIds = await readDependencies(pluginDir, pluginId);
  for (const id of [pluginId, ...dependencyIds]) {
    await fs.cp(path.join(pluginDir, id), path.join(runtimePluginDir, id), {
      recursive: true,
    });
  }
  try {
    await manager.loadAll({ ids: [pluginId, ...dependencyIds] });
  } catch (error) {
    await fs.rm(tempRoot, { recursive: true, force: true });
    throw error;
  }

  const plugin = registry.get(pluginId);
  if (!plugin) {
    await fs.rm(tempRoot, { recursive: true, force: true });
    throw new Error(`Plugin failed to load: ${pluginId}`);
  }

  return {
    pluginId,
    plugin,
    registry,
    manager,
    ctx,
    config,
    eventBus,
    apiRouter,
    protocolBridge,
    taskStore,
    scheduler,
    runtime,
    secrets,
    async invoke(params, context = {}) {
      return registry.invoke(pluginId, params, context);
    },
    async cleanup() {
      scheduler.stop();
      const loaded = registry.list();
      for (const item of loaded) {
        const wrapper = registry.unregister(item.id);
        if (wrapper?.dispose) await wrapper.dispose().catch(() => {});
      }
      await fs.rm(tempRoot, { recursive: true, force: true });
    },
  };
}
