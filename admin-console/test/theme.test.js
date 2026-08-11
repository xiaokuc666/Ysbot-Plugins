import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  loadTheme,
  saveTheme,
  themeCss,
  THEME_PRESETS,
} from "../lib/theme.js";

test("theme store persists custom colors and emits css variables", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ysbot-theme-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const ctx = { dataDir: root };
  const saved = await saveTheme(ctx, {
    preset: "ocean",
    colors: { primary: "#123456" },
  });
  assert.equal(saved.preset, "ocean");
  assert.equal(saved.primary, "#123456");
  const loaded = await loadTheme(ctx);
  assert.equal(loaded.primary, "#123456");
  assert.ok(themeCss(loaded).includes("--ysbot-primary: #123456"));
});

test("theme store accepts custom preset", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ysbot-theme-custom-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const ctx = { dataDir: root };
  const saved = await saveTheme(ctx, {
    preset: "custom",
    colors: { primary: "#abcdef" },
  });
  assert.equal(saved.preset, "custom");
  assert.equal(saved.primary, "#abcdef");
  assert.ok(Object.keys(THEME_PRESETS).length >= 8);
});
