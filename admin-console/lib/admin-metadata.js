import fs from "node:fs/promises";
import path from "node:path";
import { httpError } from "./plg.js";

const CONTRACT_VERSION = 1;

function normalizePage(page, pluginId) {
  const id = String(page?.id || "").trim();
  if (!id) throw httpError(400, `admin-console.json page missing id in ${pluginId}`);
  const entry = String(page?.entry || "").trim();
  if (!entry) throw httpError(400, `page ${id} missing entry`);
  const expectedPrefix = `/api/plugins/${pluginId}/admin/`;
  if (!entry.startsWith(expectedPrefix)) {
    throw httpError(
      400,
      `page ${id} entry must start with ${expectedPrefix}`,
    );
  }
  return {
    id,
    title: page.title || id,
    icon: page.icon || "page",
    entry,
    theme: page.theme === "independent" ? "independent" : "shared",
    permission: page.permission || "admin",
  };
}

function normalizeConfig(config, pluginId) {
  if (!config) return null;
  const schema = config.schema && typeof config.schema === "object"
    ? config.schema
    : { type: "object", properties: {} };
  return {
    title: config.title || `${pluginId} 配置`,
    groups: Array.isArray(config.groups) ? config.groups : [],
    schema,
    secrets: Array.isArray(config.secrets) ? config.secrets : [],
  };
}

export function normalizeAdminMetadata(raw, pluginId) {
  if (!raw) return { version: CONTRACT_VERSION, config: null, pages: [] };
  if (raw.version !== CONTRACT_VERSION) {
    throw httpError(
      400,
      `Unsupported admin-console.json version ${raw.version} in ${pluginId}`,
    );
  }
  const pages = Array.isArray(raw.pages)
    ? raw.pages.map((page) => normalizePage(page, pluginId))
    : [];
  return {
    version: raw.version,
    config: normalizeConfig(raw.config, pluginId),
    pages,
  };
}

async function readAdminMetadataFile(ctx, pluginId) {
  const source = ctx.pluginManager.sources?.get(pluginId);
  const baseDir = source?.dir || path.join(ctx.config.pluginDir, pluginId);
  const file = path.join(baseDir, "admin-console.json");
  try {
    const raw = JSON.parse(await fs.readFile(file, "utf8"));
    return normalizeAdminMetadata(raw, pluginId);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function loadAdminMetadata(ctx, pluginId) {
  return readAdminMetadataFile(ctx, pluginId);
}

export async function collectAdminMetadata(ctx, onError) {
  const metadata = new Map();
  for (const plugin of ctx.registry.list()) {
    try {
      const item = await readAdminMetadataFile(ctx, plugin.id);
      if (item) {
        metadata.set(plugin.id, item);
      }
    } catch (error) {
      await onError?.(plugin.id, error);
    }
  }
  return metadata;
}
