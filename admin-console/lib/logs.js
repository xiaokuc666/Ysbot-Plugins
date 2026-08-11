import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";

const LEVEL_ORDER = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const SENSITIVE_PATTERN =
  /(["']?(?:api[_-]?key|apikey|password|secret|token|authorization)["']?\s*[:=]\s*["']?)([^"'\n,;]*)/gi;
const BEARER_PATTERN = /(Bearer\s+)([A-Za-z0-9._~+/=-]+)/gi;

function sanitizeText(text) {
  return String(text || "")
    .replace(BEARER_PATTERN, "$1[REDACTED]")
    .replace(SENSITIVE_PATTERN, "$1[REDACTED]");
}

function extractModule(message) {
  const match = /^\[([^\]]+)\]/.exec(message || "");
  return match ? match[1] : "core";
}

export function logFileCandidates(ctx) {
  const candidates = [];
  if (process.env.YSBOT_CORE_DIR) {
    candidates.push(
      path.join(process.env.YSBOT_CORE_DIR, "data", "logs", "aibot.jsonl"),
    );
  }
  const pluginDir = ctx.pluginDir || ctx.config.pluginDir;
  if (pluginDir) {
    for (let depth = 2; depth <= 4; depth += 1) {
      const root = path.resolve(pluginDir, ...Array(depth).fill(".."));
      candidates.push(path.join(root, "data", "logs", "aibot.jsonl"));
    }
  }
  candidates.push(path.join(ctx.config.dataDir, "logs", "aibot.jsonl"));
  return [...new Set(candidates)];
}

export function logFilePath(ctx) {
  const candidates = logFileCandidates(ctx);
  return candidates.find((candidate) => fsSync.existsSync(candidate)) || candidates[0];
}

export async function getLogs({ logFile, limit = 200, level = "debug", q = "" }) {
  let raw = "";
  try {
    raw = await fs.readFile(logFile, "utf8");
  } catch {
    return [];
  }

  const minLevel = LEVEL_ORDER[level] ?? LEVEL_ORDER.debug;
  const query = String(q || "").trim().toLowerCase();
  const entries = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if ((LEVEL_ORDER[entry.level] ?? 0) < minLevel) continue;
    const message = sanitizeText(entry.message || "");
    const module = extractModule(message);
    const text = `${module} ${message}`.toLowerCase();
    if (query && !text.includes(query)) continue;
    entries.push({
      ts: entry.ts || "",
      level: entry.level || "info",
      module,
      message,
    });
  }
  return entries.slice(-Math.max(1, Math.min(1000, Number(limit) || 200))).reverse();
}

export async function clearLogs(logFile) {
  await fs.mkdir(path.dirname(logFile), { recursive: true });
  await fs.writeFile(logFile, "", "utf8");
  return { ok: true };
}
