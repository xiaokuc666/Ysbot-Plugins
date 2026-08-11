import fs from "node:fs/promises";
import path from "node:path";
import { importCoreModule } from "./core.js";
import { pluginsDir, pathExists } from "./workspace.js";

export const PLUGIN_TYPES = [
  "motivation",
  "capability",
  "protocol",
  "action",
  "feedback",
  "policy",
  "system",
];

export async function listPluginDirs(root = pluginsDir) {
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const dirs = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const manifestPath = path.join(root, entry.name, "plugin.json");
    if (await pathExists(manifestPath)) dirs.push(path.join(root, entry.name));
  }
  return dirs.sort();
}

export async function loadPluginManifest(pluginDir) {
  const manifestPath = path.join(pluginDir, "plugin.json");
  if (!(await pathExists(manifestPath))) {
    throw new Error(`Missing plugin.json in ${pluginDir}`);
  }
  return JSON.parse(await fs.readFile(manifestPath, "utf8"));
}

export async function listPlugins(root = pluginsDir) {
  const dirs = await listPluginDirs(root);
  const plugins = [];
  for (const dir of dirs) {
    const manifest = await loadPluginManifest(dir);
    plugins.push({
      id: manifest.id,
      type: manifest.type,
      name: manifest.name || manifest.id,
      version: manifest.version || "0.0.0",
      description: manifest.description || "",
      enabled: manifest.enabled !== false,
      role: manifest.role || "user",
      dependencies: manifest.dependencies || [],
      dir,
      manifestPath: path.join(dir, "plugin.json"),
      indexPath: path.join(dir, "index.js"),
      hasIndex: await pathExists(path.join(dir, "index.js")),
      hasTest: await pathExists(path.join(dir, "test")),
    });
  }
  return plugins.sort((a, b) => a.id.localeCompare(b.id));
}

export async function findPlugin(id, root = pluginsDir) {
  const plugins = await listPlugins(root);
  return plugins.find((plugin) => plugin.id === id) || null;
}

export async function validatePlugins(coreDir, ids = null, root = pluginsDir) {
  const plugins = (await listPlugins(root)).filter(
    (plugin) => !ids || ids.includes(plugin.id),
  );
  const { validatePluginManifest } = await importCoreModule(
    coreDir,
    "src/core/plugin-loader.js",
  );

  const results = [];
  for (const plugin of plugins) {
    const errors = [];
    try {
      validatePluginManifest(JSON.parse(JSON.stringify(plugin)));
    } catch (error) {
      errors.push(error.message);
    }
    if (!plugin.hasIndex) {
      errors.push("missing index.js");
    }
    if (plugin.type && !PLUGIN_TYPES.includes(plugin.type)) {
      errors.push(`unsupported type: ${plugin.type}`);
    }
    results.push({ ...plugin, errors });
  }
  return results;
}
