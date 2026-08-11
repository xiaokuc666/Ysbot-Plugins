import fs from "node:fs/promises";
import path from "node:path";

const SENSITIVE_PATTERN =
  /(["']?(?:api[_-]?key|apikey|password|secret|token|authorization)["']?\s*[:=]\s*["']?)([^"'\n,;]*)/gi;
const BEARER_PATTERN = /(Bearer\s+)([A-Za-z0-9._~+/=-]+)/gi;

function sanitizeText(text) {
  return String(text || "")
    .replace(BEARER_PATTERN, "$1[REDACTED]")
    .replace(SENSITIVE_PATTERN, "$1[REDACTED]");
}

export async function createStateStore(dataDir) {
  const file = path.join(dataDir, "state.json");
  let data = {
    plgFiles: {},
    errors: {},
    enabledOverrides: {},
  };
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8"));
    data = {
      plgFiles: parsed.plgFiles || {},
      errors: parsed.errors || {},
      enabledOverrides: parsed.enabledOverrides || {},
    };
  } catch {
    await save();
  }

  async function save() {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    await fs.rename(tmp, file);
  }

  return {
    file,
    data,
    async save() {
      await save();
    },
    async recordError(id, error) {
      const list = data.errors[id] || [];
      list.unshift({
        ts: new Date().toISOString(),
        message: sanitizeText(error?.message || String(error)),
      });
      data.errors[id] = list.slice(0, 10);
      await save();
    },
    async clearError(id) {
      if (data.errors[id]) {
        delete data.errors[id];
        await save();
      }
    },
    getErrors(id) {
      return data.errors[id] || [];
    },
    async setPlgFile(id, fileName) {
      data.plgFiles[id] = fileName;
      await save();
    },
    async deletePlgFile(id) {
      if (data.plgFiles[id]) {
        delete data.plgFiles[id];
        await save();
      }
    },
    async setEnabledOverride(id, enabled) {
      data.enabledOverrides[id] = Boolean(enabled);
      await save();
    },
    async clearEnabledOverride(id) {
      if (data.enabledOverrides[id] !== undefined) {
        delete data.enabledOverrides[id];
        await save();
      }
    },
    getEnabledOverrides() {
      return { ...data.enabledOverrides };
    },
  };
}
