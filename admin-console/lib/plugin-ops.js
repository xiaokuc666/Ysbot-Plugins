import fs from "node:fs/promises";
import path from "node:path";
import { httpError, parsePlgPayload, readPlgFile } from "./plg.js";

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
    String(version).trim(),
  );
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] || null,
  };
}

function comparePrerelease(a, b) {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  const left = String(a).split(".");
  const right = String(b).split(".");
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const l = left[index];
    const r = right[index];
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    const lNum = /^\d+$/.test(l) ? Number(l) : null;
    const rNum = /^\d+$/.test(r) ? Number(r) : null;
    if (lNum !== null && rNum !== null) {
      if (lNum !== rNum) return lNum < rNum ? -1 : 1;
    } else if (lNum !== null) {
      return -1;
    } else if (rNum !== null) {
      return 1;
    } else if (l !== r) {
      return l < r ? -1 : 1;
    }
  }
  return 0;
}

function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) {
    throw httpError(400, `Invalid plugin version: ${a} or ${b}`);
  }
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  if (left.patch !== right.patch) return left.patch - right.patch;
  return comparePrerelease(left.prerelease, right.prerelease);
}

function safeFileName(id, version) {
  return `${id}-${String(version).replace(/[^0-9A-Za-z._-]/g, "_")}.plg`;
}

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function readPlgManifest(file) {
  try {
    const buffer = await fs.readFile(file);
    const manifestBuffer = readPlgFile(buffer, "plugin.json");
    if (!manifestBuffer) return null;
    return JSON.parse(manifestBuffer.toString("utf8"));
  } catch {
    return null;
  }
}

async function isValidPlgFile(file) {
  try {
    const buffer = await fs.readFile(file);
    return Boolean(readPlgFile(buffer, "plugin.json") && readPlgFile(buffer, "index.js"));
  } catch {
    return false;
  }
}

async function findPlgFile(ctx, state, id) {
  const fromState = state.data.plgFiles?.[id];
  if (fromState) {
    const candidate = path.join(ctx.config.pluginDir, path.basename(fromState));
    if (await pathExists(candidate)) {
      const manifest = await readPlgManifest(candidate);
      if (manifest?.id === id && (await isValidPlgFile(candidate))) {
        return candidate;
      }
    }
  }

  const pluginDir = ctx.config.pluginDir;
  let files = [];
  try {
    files = await fs.readdir(pluginDir);
  } catch {
    return null;
  }
  for (const file of files) {
    if (!file.toLowerCase().endsWith(".plg")) continue;
    const filePath = path.join(pluginDir, file);
    const manifest = await readPlgManifest(filePath);
    if (manifest?.id === id && (await isValidPlgFile(filePath))) {
      return filePath;
    }
  }
  return null;
}

async function quarantinePluginFile(pluginDir, target) {
  const quarantineDir = path.join(pluginDir, ".quarantine");
  await fs.mkdir(quarantineDir, { recursive: true });
  const name = path.basename(target);
  const destination = path.join(
    quarantineDir,
    `${Date.now()}-${Math.random().toString(16).slice(2, 8)}-${name}`,
  );
  await fs.rename(target, destination);
  return destination;
}

export async function reconcilePlgFiles(ctx) {
  const pluginDir = ctx.config.pluginDir;
  let files = [];
  try {
    files = await fs.readdir(pluginDir);
  } catch {
    return { quarantined: [] };
  }
  const groups = new Map();
  const quarantined = [];
  for (const file of files) {
    if (file.endsWith(".plg.bak") || (file.endsWith(".plg") && !file.startsWith("."))) {
      const filePath = path.join(pluginDir, file);
      const manifest = await readPlgManifest(filePath);
      if (manifest && (await isValidPlgFile(filePath))) {
        const list = groups.get(manifest.id) || [];
        list.push({
          file: filePath,
          version: manifest.version || "0.0.0",
        });
        groups.set(manifest.id, list);
      } else {
        try {
          quarantined.push(await quarantinePluginFile(pluginDir, filePath));
        } catch {
          // Leave file in place if quarantine fails.
        }
      }
      continue;
    }
  }
  for (const [id, matches] of groups) {
    if (matches.length <= 1) continue;
    const source = ctx.pluginManager.sources?.get(id);
    let keep = source?.plgPath
      ? matches.find(
          (item) => path.resolve(item.file) === path.resolve(source.plgPath),
        )
      : null;
    if (!keep) continue;
    for (const item of matches) {
      if (item.file === keep.file) continue;
      try {
        quarantined.push(await quarantinePluginFile(pluginDir, item.file));
      } catch {
        // Keep plugin list functional even if quarantine fails.
      }
    }
  }
  return { quarantined };
}

async function loadAndValidate(ctx, fileName) {
  await ctx.pluginManager.loadPlgFile(fileName);
  await ctx.pluginManager.validateDependencies();
}

function missingDependencies(ctx, manifest) {
  return (manifest.dependencies || []).filter((dependencyId) => {
    const dependency = ctx.registry.get(dependencyId);
    return (
      !dependency ||
      dependency.enabled === false ||
      dependency.status !== "ready"
    );
  });
}

export async function installPlg({ ctx, state, fileName, plgBase64 }) {
  const { buffer, manifest } = parsePlgPayload(fileName, plgBase64);
  if (ctx.registry.get(manifest.id)) {
    throw httpError(409, `Plugin already installed: ${manifest.id}`);
  }

  const targetName = safeFileName(manifest.id, manifest.version);
  const target = path.join(ctx.config.pluginDir, targetName);
  await fs.writeFile(target, buffer);
  try {
    await loadAndValidate(ctx, targetName);
    if (!ctx.registry.get(manifest.id)) {
      const missing = missingDependencies(ctx, manifest);
      throw httpError(
        400,
        `Plugin ${manifest.id} failed dependency validation: ${missing.join(", ") || "unknown"}`,
      );
    }
    await state.setPlgFile(manifest.id, targetName);
    return {
      ok: true,
      id: manifest.id,
      version: manifest.version,
      file: targetName,
    };
  } catch (error) {
    const loaded = ctx.registry.get(manifest.id);
    const source = ctx.pluginManager.sources?.get(manifest.id);
    if (loaded?.dispose) await loaded.dispose().catch(() => {});
    ctx.registry.unregister(manifest.id);
    ctx.pluginManager.sources?.delete?.(manifest.id);
    const cacheDir = loaded?.cacheDir || source?.cacheDir;
    if (cacheDir) {
      await fs.rm(cacheDir, { recursive: true, force: true }).catch(() => {});
    }
    await fs.rm(target, { force: true });
    error.pluginId = manifest.id;
    throw error;
  }
}

export async function uninstallPlugin({ ctx, state, id, removeData = false }) {
  if (id === "admin-console") {
    throw httpError(400, "admin-console cannot uninstall itself");
  }
  const wrapper = ctx.registry.get(id);
  if (!wrapper) throw httpError(404, `Plugin not found: ${id}`);

  const plgFile = await findPlgFile(ctx, state, id);
  const source = ctx.pluginManager.sources?.get(id);
  const wasEnabled = wrapper.enabled;
  const wasStatus = wrapper.status;
  if (wrapper.dispose) await wrapper.dispose().catch(() => {});
  ctx.registry.unregister(id);
  ctx.pluginManager.sources?.delete?.(id);

  try {
    if (wrapper.sourceType === "plg") {
      if (wrapper.cacheDir) {
        await fs.rm(wrapper.cacheDir, { recursive: true, force: true });
      }
      if (plgFile) await fs.rm(plgFile, { force: true });
    } else if (wrapper.sourceType === "directory") {
      const sourceDir = path.join(ctx.config.pluginDir, id);
      await fs.rm(sourceDir, { recursive: true, force: true });
    }
  } catch (error) {
    wrapper.enabled = wasEnabled;
    wrapper.status = wasStatus;
    try {
      if (wrapper.sourceType === "plg" && plgFile && (await pathExists(plgFile))) {
        await loadAndValidate(ctx, path.basename(plgFile));
      } else {
        ctx.registry.register(wrapper);
        if (source) ctx.pluginManager.sources?.set(id, source);
      }
    } catch (restoreError) {
      error.restoreError = restoreError.message;
    }
    throw error;
  }

  if (removeData && wrapper.dataDir) {
    await fs.rm(wrapper.dataDir, { recursive: true, force: true }).catch(() => {});
  }
  if (state.deletePlgFile) {
    await state.deletePlgFile(id).catch(() => {});
  }
  return { ok: true, id, removeData: Boolean(removeData) };
}

export async function updatePlugin({ ctx, state, id, fileName, plgBase64 }) {
  const { buffer, manifest } = parsePlgPayload(fileName, plgBase64);
  if (manifest.id !== id) {
    throw httpError(400, `plugin.json id mismatch: expected ${id}, got ${manifest.id}`);
  }
  const wrapper = ctx.registry.get(id);
  if (!wrapper) throw httpError(404, `Plugin not found: ${id}`);
  if (wrapper.sourceType === "directory") {
    throw httpError(400, "Directory plugins cannot be updated with .plg; use reload or reinstall");
  }
  if (compareVersions(manifest.version, wrapper.version) <= 0) {
    throw httpError(
      400,
      `New version must be higher than current ${wrapper.version}`,
    );
  }

  const oldFile = await findPlgFile(ctx, state, id);
  if (!oldFile) {
    throw httpError(400, "Cannot locate installed .plg file for update");
  }
  const newName = safeFileName(id, manifest.version);
  const newFile = path.join(ctx.config.pluginDir, newName);

  try {
    await fs.writeFile(newFile, buffer);
    if (wrapper.dispose) await wrapper.dispose().catch(() => {});
    ctx.registry.unregister(id);
    ctx.pluginManager.sources?.delete?.(id);
    await loadAndValidate(ctx, newName);
    if (!ctx.registry.get(id)) {
      const missing = missingDependencies(ctx, manifest);
      throw httpError(
        400,
        `Plugin ${id} failed dependency validation after update: ${missing.join(", ") || "unknown"}`,
      );
    }
    await state.setPlgFile(id, newName);
    await fs.rm(oldFile, { force: true });
    return {
      ok: true,
      id,
      version: manifest.version,
      file: newName,
    };
  } catch (error) {
    await fs.rm(newFile, { force: true });
    const current = ctx.registry.get(id);
    if (current?.dispose) await current.dispose().catch(() => {});
    ctx.registry.unregister(id);
    ctx.pluginManager.sources?.delete?.(id);
    try {
      await loadAndValidate(ctx, path.basename(oldFile));
      await state.setPlgFile(id, path.basename(oldFile));
    } catch (restoreError) {
      error.restoreError = restoreError.message;
    }
    throw error;
  }
}

export async function locateInstalledPlgFile(ctx, state, id) {
  return findPlgFile(ctx, state, id);
}
