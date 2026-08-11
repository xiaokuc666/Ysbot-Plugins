#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { assertCoreAvailable } from "./lib/core.js";
import {
  findPlugin,
  listPlugins,
  validatePlugins,
} from "./lib/manifests.js";
import { packPlugins, writeCatalog } from "./lib/pack.js";
import { createPlugin } from "./lib/scaffold.js";
import {
  distDir,
  ensureDir,
  pluginsDir,
  resolveCoreDir,
  workspaceRoot,
} from "./lib/workspace.js";

const HELP = `YSbot plugin workspace CLI

Usage:
  node tools/ysbot.js <command> [args]

Commands:
  create <type> <id>              Scaffold a new plugin
  list                            List plugins
  validate [id]                   Validate manifests and required files
  check [id]                      Validate plus node --check
  test [id]                       Run workspace and plugin tests
  pack [id] [--out dist]          Build .plg packages
  catalog [--out dist/catalog.json] Generate plugin catalog
  deploy <id> [--mode plg|dir]    Deploy a plugin into Core
  start [id]                      Start Core with this workspace plugins
  help                            Show this help

Options:
  --core <dir>      Override YSbot Core path (default: ../../ref)
  --json            Machine-readable output for list/validate
  --name <name>     Display name when scaffolding
  --description <text>
  --depends <ids>   Comma separated dependency plugin ids
`;

function parseArgv(args) {
  const positionals = [];
  const flags = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq !== -1) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
        continue;
      }
      const key = arg.slice(2);
      const next = args[index + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        index += 1;
      } else {
        flags[key] = true;
      }
    } else {
      positionals.push(arg);
    }
  }
  return { positionals, flags };
}

function waitExit(child) {
  return new Promise((resolve) => {
    child.once("exit", (code, signal) => {
      resolve(code ?? (signal ? 1 : 0));
    });
    child.once("error", (error) => {
      console.error(`[ysbot] child process failed: ${error.message}`);
      resolve(1);
    });
  });
}

async function createCommand(args) {
  const { positionals, flags } = parseArgv(args);
  const [type, id] = positionals;
  if (!type || !id) {
    throw new Error("Usage: node tools/ysbot.js create <type> <id>");
  }
  const target = await createPlugin({
    type,
    id,
    name: flags.name,
    description: flags.description || "",
    role: flags.role,
    depends: String(flags.depends || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  });
  console.log(`Created plugin: ${target}`);
}

async function listCommand(args) {
  const { flags } = parseArgv(args);
  const plugins = await listPlugins();
  if (flags.json) {
    console.log(JSON.stringify(plugins, null, 2));
    return;
  }
  console.log(`Plugins: ${plugins.length}`);
  for (const plugin of plugins) {
    const status = plugin.enabled ? "enabled" : "disabled";
    const deps = plugin.dependencies.length
      ? ` deps=${plugin.dependencies.join(",")}`
      : "";
    console.log(
      `- ${plugin.id} [${plugin.type}] ${plugin.name} v${plugin.version} ${status}${deps}`,
    );
  }
}

async function validateCommand(args) {
  const { positionals, flags } = parseArgv(args);
  const results = await validatePlugins(
    resolveCoreDir(flags.core),
    positionals.length ? positionals : null,
  );
  if (flags.json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    for (const result of results) {
      if (result.errors.length) {
        console.error(`FAIL ${result.id}: ${result.errors.join("; ")}`);
      } else {
        console.log(`OK   ${result.id}`);
      }
    }
  }
  const failed = results.filter((result) => result.errors.length);
  process.exitCode = failed.length ? 1 : 0;
}

async function collectJsFiles(dir, out = []) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectJsFiles(full, out);
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      out.push(full);
    }
  }
  return out;
}

async function checkCommand(args) {
  const { positionals, flags } = parseArgv(args);
  const ids = positionals.length ? positionals : null;
  const validation = await validatePlugins(resolveCoreDir(flags.core), ids);
  let failed = validation.filter((result) => result.errors.length);
  for (const result of failed) {
    console.error(`FAIL ${result.id}: ${result.errors.join("; ")}`);
  }

  const roots = [path.join(workspaceRoot, "tools")];
  if (ids) {
    for (const id of ids) {
      const plugin = await findPlugin(id);
      if (plugin) roots.push(plugin.dir);
    }
  } else {
    roots.push(pluginsDir);
  }
  const files = [];
  for (const root of roots) {
    await collectJsFiles(root, files);
  }
  for (const file of files) {
    const result = spawnSync(process.execPath, ["--check", file], {
      encoding: "utf8",
    });
    if (result.status !== 0) {
      console.error(`FAIL ${path.relative(workspaceRoot, file)}`);
      if (result.stderr.trim()) console.error(result.stderr.trim());
      if (!failed.some((item) => item.file === file)) {
        failed.push({ id: path.basename(file), errors: ["syntax error"], file });
      }
    }
  }
  process.exitCode = failed.length ? 1 : 0;
  if (!failed.length) console.log("check ok");
}

async function collectTestFiles(id) {
  const roots = [];
  if (id) {
    const plugin = await findPlugin(id);
    if (!plugin) throw new Error(`Plugin not found: ${id}`);
    roots.push(plugin.dir);
  } else {
    roots.push(path.join(workspaceRoot, "test"));
    for (const plugin of await listPlugins()) roots.push(plugin.dir);
  }

  const files = [];
  for (const root of roots) {
    await collectJsFiles(root, files);
  }
  return files
    .filter((file) => file.endsWith(".test.js") || file.endsWith(".spec.js"))
    .sort();
}

async function testCommand(args) {
  const { positionals } = parseArgv(args);
  const files = await collectTestFiles(positionals[0]);
  if (!files.length) {
    console.log("No test files found.");
    return;
  }
  const child = spawn(process.execPath, ["--test", ...files], {
    cwd: workspaceRoot,
    stdio: "inherit",
    env: process.env,
  });
  process.exitCode = await waitExit(child);
}

async function packCommand(args) {
  const { positionals, flags } = parseArgv(args);
  const outDir = flags.out ? path.resolve(flags.out) : null;
  const results = await packPlugins(
    positionals.length ? positionals : null,
    outDir,
  );
  if (!results.length) {
    if (positionals.length) {
      throw new Error(`No plugins matched: ${positionals.join(", ")}`);
    }
    console.log("No plugins to pack.");
    return;
  }
  for (const result of results) {
    console.log(
      `packed ${result.id} v${result.version} ${result.file} (${result.bytes} bytes, ${result.entries} entries)`,
    );
  }
}

async function catalogCommand(args) {
  const { flags } = parseArgv(args);
  const outPath = flags.out
    ? path.resolve(flags.out)
    : path.join(distDir, "catalog.json");
  const file = await writeCatalog(outPath);
  console.log(`catalog written: ${file}`);
}

function assertInside(base, target) {
  const resolvedBase = path.resolve(base);
  const resolvedTarget = path.resolve(target);
  const relative = path.relative(resolvedBase, resolvedTarget);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to operate outside ${resolvedBase}: ${target}`);
  }
}

async function removeSamePluginSources(pluginDir, id) {
  const entries = await fs.readdir(pluginDir);
  for (const name of entries) {
    const target = path.join(pluginDir, name);
    if (name === id) {
      assertInside(pluginDir, target);
      await fs.rm(target, { recursive: true, force: true });
      continue;
    }
    if (!name.endsWith(".plg")) continue;
    const base = name.replace(/\.plg$/, "");
    if (base === id || base.startsWith(`${id}-`)) {
      assertInside(pluginDir, target);
      await fs.rm(target, { recursive: true, force: true });
    }
  }
}

async function deployCommand(args) {
  const { positionals, flags } = parseArgv(args);
  const [id] = positionals;
  if (!id) throw new Error("Usage: node tools/ysbot.js deploy <id>");
  const plugin = await findPlugin(id);
  if (!plugin) throw new Error(`Plugin not found: ${id}`);

  const core = await assertCoreAvailable(flags.core);
  const targetPlugins = path.join(core, "plugins");
  await ensureDir(targetPlugins);
  await removeSamePluginSources(targetPlugins, id);

  const mode = flags.mode || "plg";
  if (mode === "dir") {
    const target = path.join(targetPlugins, id);
    assertInside(targetPlugins, target);
    await fs.cp(plugin.dir, target, { recursive: true });
    console.log(`deployed ${id} -> ${target}`);
    return;
  }
  if (mode !== "plg") {
    throw new Error("--mode must be plg or dir");
  }

  const tempDir = path.join(workspaceRoot, ".tmp", "deploy");
  const packed = (await packPlugins([id], tempDir))[0];
  const destination = path.join(targetPlugins, path.basename(packed.file));
  await fs.copyFile(packed.file, destination);
  await fs.rm(tempDir, { recursive: true, force: true });
  console.log(`deployed ${id} v${packed.version} -> ${destination}`);
}

async function startCommand(args) {
  const { positionals, flags } = parseArgv(args);
  const core = await assertCoreAvailable(flags.core);
  const env = {
    ...process.env,
    YSBOT_PLUGIN_DIR: pluginsDir,
    YSBOT_PLUGIN_CACHE_DIR: path.join(workspaceRoot, "data", "cache"),
    YSBOT_PLUGIN_DATA_DIR: path.join(workspaceRoot, "data", "plugins"),
    YSBOT_DATA_DIR: path.join(workspaceRoot, "data"),
    YSBOT_SECRETS_DIR: path.join(workspaceRoot, "data", "secrets"),
    YSBOT_CORE_DIR: core,
  };
  if (positionals[0]) env.YSBOT_PLUGINS = positionals[0];
  if (flags["no-plugins"]) env.YSBOT_NO_PLUGINS = "1";
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: core,
    env,
    stdio: "inherit",
  });
  process.exitCode = await waitExit(child);
}

async function runCommand(command, args) {
  switch (command) {
    case "create":
      return createCommand(args);
    case "list":
      return listCommand(args);
    case "validate":
      return validateCommand(args);
    case "check":
      return checkCommand(args);
    case "test":
      return testCommand(args);
    case "pack":
      return packCommand(args);
    case "catalog":
      return catalogCommand(args);
    case "deploy":
      return deployCommand(args);
    case "start":
      return startCommand(args);
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

try {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(HELP);
  } else {
    await runCommand(command, args);
  }
} catch (error) {
  console.error(`[ysbot] ${error.message}`);
  process.exitCode = 1;
}
