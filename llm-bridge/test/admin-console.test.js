import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

test("admin-console.json declares flexible providers and one secret map", async () => {
  const raw = await fs.readFile(
    path.join(here, "../admin-console.json"),
    "utf8",
  );
  const config = JSON.parse(raw);
  assert.equal(config.version, 1);
  assert.deepEqual(config.config.secrets, ["providerApiKeys"]);
  assert.equal(config.config.schema.properties.providers.type, "array");
  assert.equal(config.config.schema.properties.providerApiKeys.secret, true);
  assert.equal(config.config.schema.properties.defaultProvider.default, "deepseek");
  assert.equal(config.pages.length, 0);
  assert.equal(config.config.actions.length, 1);
  assert.equal(config.config.actions[0].id, "test-provider");
  assert.equal(
    config.config.actions[0].path,
    "/api/plugins/llm-bridge/admin/providers/test",
  );
});
