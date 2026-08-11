import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export const workspaceRoot = path.resolve(here, "../..");
export const pluginsDir = workspaceRoot;
export const templatesDir = path.join(workspaceRoot, "templates");
export const distDir = path.join(workspaceRoot, "dist");
export const defaultCoreDir = path.join(workspaceRoot, "ref");

export function resolveCoreDir(coreDir) {
  const value = coreDir || process.env.YSBOT_CORE_DIR || defaultCoreDir;
  return path.resolve(value);
}

export async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

export async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}
