import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { createStateStore } from "../lib/state.js";

test("state store persists enabled overrides", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ysbot-state-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = await createStateStore(root);
  await store.setEnabledOverride("demo", false);
  assert.equal(store.getEnabledOverrides().demo, false);
  const reloaded = await createStateStore(root);
  assert.equal(reloaded.getEnabledOverrides().demo, false);
  await reloaded.clearEnabledOverride("demo");
  assert.equal(reloaded.getEnabledOverrides().demo, undefined);
});
