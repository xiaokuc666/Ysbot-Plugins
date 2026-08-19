import test from "node:test";
import assert from "node:assert/strict";
import { CONFIG_SCHEMA } from "../lib/config.js";

test("CONFIG_SCHEMA exposes memory defaults", () => {
  assert.equal(CONFIG_SCHEMA.properties.enabled.default, true);
  assert.equal(CONFIG_SCHEMA.properties.maxEntriesPerGroup.default, 500);
  assert.equal(CONFIG_SCHEMA.properties.recallDefaultLimit.default, 20);
  assert.equal(CONFIG_SCHEMA.properties.summaryAfterEntries.default, 50);
});
