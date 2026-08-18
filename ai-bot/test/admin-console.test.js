import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

test("admin-console.json declares ai-bot config", async () => {
  const raw = await fs.readFile(
    path.join(here, "../admin-console.json"),
    "utf8",
  );
  const config = JSON.parse(raw);
  assert.equal(config.version, 1);
  assert.equal(config.config.schema.properties.defaultReplyMode.default, "mention");
  assert.equal(config.config.schema.properties.adminUserIds.type, "array");
  assert.equal(config.pages.length, 0);
});
