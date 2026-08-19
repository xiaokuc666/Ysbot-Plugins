import fs from "node:fs/promises";
import path from "node:path";

function sceneKeyOf(record) {
  const scene = record?.scene;
  if (!scene?.type || !scene?.id) return null;
  return `${scene.type}:${scene.id}`;
}

function prune(records, maxAgeMs) {
  const cutoff = Date.now() - maxAgeMs;
  return records.filter((record) => {
    const ts = record?.ts ? Date.parse(record.ts) : 0;
    return Number.isFinite(ts) && ts >= cutoff;
  });
}

export function createHistoryStore({
  dataDir,
  maxEntries = 20,
  maxAgeMs = 3600000,
} = {}) {
  const file = path.join(dataDir, "history.jsonl");
  let writeChain = Promise.resolve();

  async function read() {
    try {
      const raw = await fs.readFile(file, "utf8");
      return raw
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
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  async function write(records) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(
      file,
      `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
      "utf8",
    );
  }

  return {
    file,

    async append(entry, options = {}) {
      const limit = Number(options.maxEntries ?? maxEntries) || 20;
      const age = Number(options.maxAgeMs ?? maxAgeMs) || 3600000;
      const record = {
        id: `hist-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        ts: new Date().toISOString(),
        ...entry,
      };
      writeChain = writeChain.then(async () => {
        const records = prune(await read(), age);
        records.push(record);
        await write(records.slice(-Math.max(1, limit)));
      });
      await writeChain;
      return record;
    },

    async list(sceneKey, options = {}) {
      const limit = Number(options.maxEntries ?? maxEntries) || 20;
      const age = Number(options.maxAgeMs ?? maxAgeMs) || 3600000;
      const records = prune(await read(), age);
      return records
        .filter((record) => sceneKeyOf(record) === sceneKey)
        .slice(-Math.max(1, limit));
    },

    async clear(sceneKey) {
      writeChain = writeChain.then(async () => {
        const records = await read();
        await write(records.filter((record) => sceneKeyOf(record) !== sceneKey));
      });
      await writeChain;
    },
  };
}
