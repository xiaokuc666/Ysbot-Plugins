import fs from "node:fs/promises";
import path from "node:path";

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const SENSITIVE_PATTERN =
  /(["']?(?:api[_-]?key|apikey|password|secret|token|access[_-]?token)["']?\s*[:=]\s*["']?)([^"'\n,;]*)/gi;
const BEARER_PATTERN = /(Bearer\s+)([A-Za-z0-9._~+/=-]+)/gi;

function redactText(value) {
  return String(value ?? "")
    .replace(BEARER_PATTERN, "$1[REDACTED]")
    .replace(SENSITIVE_PATTERN, "$1[REDACTED]");
}

function redactValue(value) {
  if (typeof value === "string") return redactText(value);
  if (value instanceof Error) return redactText(`${value.name}: ${value.message}`);
  if (Array.isArray(value)) return value.map(redactValue);
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

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

export async function createPluginLogger(
  ctx,
  {
    maxFileBytes = 5 * 1024 * 1024,
    maxEntries = 10000,
    maxBackups = 3,
  } = {},
) {
  const pluginId = ctx.manifest.id;
  const file = path.join(ctx.dataDir, "logs", `${pluginId}.jsonl`);
  let writeChain = Promise.resolve();

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
    writeChain = writeChain.then(async () => {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.appendFile(file, `${JSON.stringify(entry)}\n`, "utf8");
    }).catch(() => {});
  }

  async function read({ level = "debug", limit = 200, q = "" } = {}) {
    await writeChain.catch(() => {});
    const raw = await fs.readFile(file, "utf8").catch(() => "");
    const min = LEVELS[level] ?? LEVELS.debug;
    const query = String(q || "").toLowerCase();
    const entries = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .filter((entry) => (LEVELS[entry.level] ?? 0) >= min)
      .filter((entry) =>
        query
          ? `${entry.module || ""} ${entry.message || ""}`
              .toLowerCase()
              .includes(query)
          : true,
      );
    return entries
      .slice(-Math.max(1, Math.min(1000, Number(limit) || 200)))
      .reverse();
  }

  async function clear() {
    await writeChain.catch(() => {});
    await fs.mkdir(path.dirname(file), { recursive: true });
    for (let index = 1; index <= maxBackups; index += 1) {
      await fs.rm(`${file}.${index}`, { force: true });
    }
    await fs.writeFile(file, "", "utf8");
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
    read,
    clear,
    debug(module, message, context) {
      write("debug", module, message, context);
    },
    info(module, message, context) {
      write("info", module, message, context);
    },
    warn(module, message, context, error) {
      write("warn", module, message, context, error);
    },
    error(module, message, context, error) {
      write("error", module, message, context, error);
    },
    async flush() {
      await writeChain.catch(() => {});
    },
    async unregister() {
      if (unregister) await unregister();
      await writeChain.catch(() => {});
    },
  };
}
