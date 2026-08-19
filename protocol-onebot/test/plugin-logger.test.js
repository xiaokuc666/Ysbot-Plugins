import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { createPluginLogger } from "../lib/plugin-logger.js";

test("plugin logger rotates by entry count and reads backups", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ysbot-plugin-logger-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const ctx = {
    manifest: { id: "protocol-onebot" },
    dataDir: root,
  };
  const logger = await createPluginLogger(ctx, {
    maxEntries: 2,
    maxBackups: 2,
  });

  for (const message of ["one", "two", "three", "four", "five"]) {
    logger.info("rotation", message);
  }
  await logger.flush();

  const active = await fs.readFile(logger.file, "utf8");
  const backup1 = await fs.readFile(`${logger.file}.1`, "utf8");
  const backup2 = await fs.readFile(`${logger.file}.2`, "utf8");
  assert.equal(active.trim().split(/\r?\n/).length, 1);
  assert.ok(active.includes("five"));
  assert.ok(backup1.includes("three"));
  assert.ok(backup1.includes("four"));
  assert.ok(backup2.includes("one"));
  assert.ok(backup2.includes("two"));

  const entries = await logger.read({ limit: 10 });
  assert.deepEqual(
    entries.map((entry) => entry.message),
    ["five", "four", "three", "two", "one"],
  );

  await logger.clear();
  assert.equal(await fs.readFile(logger.file, "utf8"), "");
  await assert.rejects(fs.access(`${logger.file}.1`));
  await assert.rejects(fs.access(`${logger.file}.2`));
  await logger.unregister();
});
