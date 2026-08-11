import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  getLogs,
  logFileCandidates,
} from "../lib/logs.js";

test("logs redact bearer tokens and key values", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ysbot-logs-"));
  const file = path.join(root, "aibot.jsonl");
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(
    file,
    [
      JSON.stringify({
        ts: "2026-01-01T00:00:00.000Z",
        level: "info",
        message: "Authorization: Bearer abc123",
      }),
      JSON.stringify({
        ts: "2026-01-01T00:00:01.000Z",
        level: "info",
        message: "apiKey=secret-value",
      }),
      JSON.stringify({
        ts: "2026-01-01T00:00:02.000Z",
        level: "info",
        message: "password=my secret value",
      }),
      "",
    ].join("\n"),
    "utf8",
  );

  const logs = await getLogs({ logFile: file, limit: 10 });
  const bearer = logs.find((entry) => entry.message.includes("Authorization"));
  const key = logs.find((entry) => entry.message.includes("apiKey"));
  const password = logs.find((entry) => entry.message.includes("password"));
  assert.ok(bearer);
  assert.equal(bearer.message.includes("abc123"), false);
  assert.ok(bearer.message.includes("[REDACTED]"));
  assert.ok(key);
  assert.equal(key.message.includes("secret-value"), false);
  assert.ok(key.message.includes("[REDACTED]"));
  assert.ok(password);
  assert.equal(password.message.includes("my secret value"), false);
  assert.ok(password.message.includes("[REDACTED]"));
});

test("log candidates prefer YSBOT_CORE_DIR", () => {
  const previous = process.env.YSBOT_CORE_DIR;
  process.env.YSBOT_CORE_DIR = "D:/project_codex/ref";
  try {
    const candidates = logFileCandidates({
      config: { dataDir: "D:/work/data" },
      pluginDir: "D:/work/plugins/admin-console",
    });
    assert.equal(
      candidates[0],
      path.resolve("D:/project_codex/ref", "data", "logs", "aibot.jsonl"),
    );
  } finally {
    if (previous === undefined) delete process.env.YSBOT_CORE_DIR;
    else process.env.YSBOT_CORE_DIR = previous;
  }
});
