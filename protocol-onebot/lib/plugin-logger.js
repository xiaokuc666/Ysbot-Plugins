import fs from "node:fs/promises";
import path from "node:path";

const LEVELS = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const SENSITIVE_PATTERN =
  /(["']?(?:api[_-]?key|apikey|password|secret|token|access[_-]?token)["']?\s*[:=]\s*["']?)([^"'\n,;]*)/gi;
const BEARER_PATTERN = /(Bearer\s+)([A-Za-z0-9._~+/=-]+)/gi;

const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_ENTRIES = 10000;
const DEFAULT_MAX_BACKUPS = 3;

function backupPath(file, index) {
  return `${file}.${index}`;
}

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function countLines(file) {
  try {
    const raw = await fs.readFile(file, "utf8");
    return raw.split(/\r?\n/).filter((line) => line.trim()).length;
  } catch {
    return 0;
  }
}

function redactText(value) {
  return String(value ?? "")
    .replace(BEARER_PATTERN, "$1[REDACTED]")
    .replace(SENSITIVE_PATTERN, "$1[REDACTED]");
}

function redactValue(value) {
  if (typeof value === "string") return redactText(value);
  if (value instanceof Error) return redactText(`${value.name}: ${value.message}`);
  if (Array.isArray(value)) return value.map((item) => redactValue(item));
  if (value && typeof value === "object") {
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = /(api[_-]?key|apikey|password|secret|token|authorization|access[_-]?token)/i.test(
        key,
      )
        ? "[REDACTED]"
        : redactValue(item);
    }
    return result;
  }
  return value;
}

export async function createPluginLogger(
  ctx,
  {
    maxFileBytes = DEFAULT_MAX_FILE_BYTES,
    maxEntries = DEFAULT_MAX_ENTRIES,
    maxBackups = DEFAULT_MAX_BACKUPS,
  } = {},
) {
  const pluginId = ctx.manifest.id;
  const file = path.join(ctx.dataDir, "logs", `${pluginId}.jsonl`);
  let writeChain = Promise.resolve();
  let lineCount = await countLines(file);

  async function append(entry) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await rotateIfNeeded();
    await fs.appendFile(file, `${JSON.stringify(entry)}\n`, "utf8");
    lineCount += 1;
  }

  async function rotateIfNeeded() {
    let size = 0;
    try {
      size = (await fs.stat(file)).size;
    } catch {
      return;
    }
    if (size <= maxFileBytes && lineCount < maxEntries) return;

    await fs.mkdir(path.dirname(file), { recursive: true });
    for (let index = maxBackups - 1; index >= 1; index -= 1) {
      const source = backupPath(file, index);
      const target = backupPath(file, index + 1);
      await fs.rm(target, { force: true });
      if (await pathExists(source)) {
        await fs.rename(source, target);
      }
    }
    await fs.rm(backupPath(file, 1), { force: true });
    if (await pathExists(file)) {
      await fs.rename(file, backupPath(file, 1));
    }
    await fs.writeFile(file, "", "utf8");
    lineCount = 0;
  }

  function write(level, module, message, context = {}, error = null) {
    const entry = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
      ts: new Date().toISOString(),
      level,
      source: "plugin",
      pluginId,
      module: module || null,
      traceId: context.traceId || null,
      message: redactText(message),
      context: redactValue(context),
      error: error ? redactValue(error) : null,
    };
    writeChain = writeChain.then(() => append(entry)).catch(() => {});
  }

  async function readRaw() {
    const parts = [];
    for (let index = maxBackups; index >= 1; index -= 1) {
      try {
        parts.push(await fs.readFile(backupPath(file, index), "utf8"));
      } catch {
        // A missing backup is expected during early log growth.
      }
    }
    try {
      parts.push(await fs.readFile(file, "utf8"));
    } catch {
      // The active file may not exist yet.
    }
    return parts.filter(Boolean).join("\n");
  }

  async function read({ level = "debug", limit = 200, q = "" } = {}) {
    await writeChain.catch(() => {});
    const raw = await readRaw();
    const min = LEVELS[level] ?? LEVELS.debug;
    const query = String(q || "").toLowerCase();
    const entries = [];
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if ((LEVELS[entry.level] ?? 0) < min) continue;
        if (query && !`${entry.module || ""} ${entry.message || ""}`.toLowerCase().includes(query)) {
          continue;
        }
        entries.push(entry);
      } catch {
        // Ignore corrupt lines.
      }
    }
    return entries.slice(-Math.max(1, Math.min(1000, Number(limit) || 200))).reverse();
  }

  async function clear() {
    await writeChain.catch(() => {});
    await fs.mkdir(path.dirname(file), { recursive: true });
    for (let index = 1; index <= maxBackups; index += 1) {
      await fs.rm(backupPath(file, index), { force: true });
    }
    await fs.writeFile(file, "", "utf8");
    lineCount = 0;
  }

  let unregister = null;
  if (ctx.logging?.register) {
    unregister = ctx.logging.register({
      id: pluginId,
      name: `${ctx.manifest.name || pluginId} Logs`,
      read,
      clear,
    });
  }

  return {
    file,
    write,
    read,
    clear,
    debug(module, message, context) {
      write("debug", module, message, context);
    },
    info(module, message, context) {
      write("info", module, message, context);
    },
    warn(module, message, context) {
      write("warn", module, message, context);
    },
    error(module, message, context, error) {
      write("error", module, message, context, error);
    },
    async unregister() {
      if (unregister) await unregister();
      await writeChain.catch(() => {});
    },
    async flush() {
      await writeChain.catch(() => {});
    },
  };
}
