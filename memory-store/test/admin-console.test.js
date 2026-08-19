import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

test("admin-console.json declares memory config and page", async () => {
  const raw = await fs.readFile(
    path.join(here, "../admin-console.json"),
    "utf8",
  );
  const config = JSON.parse(raw);
  assert.equal(config.pages[0].id, "memory");
  assert.equal(
    config.pages[0].entry,
    "/api/plugins/memory-store/admin/memory",
  );
  assert.equal(config.config.schema.properties.enabled.default, true);
});
