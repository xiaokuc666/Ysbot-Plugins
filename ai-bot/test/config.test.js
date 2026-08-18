import test from "node:test";
import assert from "node:assert/strict";
import { CONFIG_SCHEMA, groupEnabled } from "../lib/config.js";

test("CONFIG_SCHEMA exposes ai-bot defaults", () => {
  assert.equal(CONFIG_SCHEMA.properties.defaultEnabled.default, false);
  assert.equal(CONFIG_SCHEMA.properties.defaultReplyMode.default, "mention");
  assert.equal(CONFIG_SCHEMA.properties.cooldownSeconds.default, 3);
});

test("groupEnabled respects explicit disabled and enabled groups", () => {
  const config = {
    defaultEnabled: false,
    enabledGroups: ["10001"],
    disabledGroups: ["10002"],
  };
  assert.equal(groupEnabled(config, "10001"), true);
  assert.equal(groupEnabled(config, "10002"), false);
  assert.equal(groupEnabled(config, "10003"), false);

  const enabledByDefault = {
    defaultEnabled: true,
    enabledGroups: [],
    disabledGroups: ["10002"],
  };
  assert.equal(groupEnabled(enabledByDefault, "10001"), true);
  assert.equal(groupEnabled(enabledByDefault, "10002"), false);
});
