import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { importCoreModule } from "../../tools/lib/core.js";
import { resolveCoreDir } from "../../tools/lib/workspace.js";
import {
  CONFIG_SCHEMA,
  loadPluginConfig,
  loadProviderKeys,
  providerCatalog,
  providerDefinition,
  resolveEndpoint,
  resolveModel,
  resolveOllamaEndpoint,
} from "../lib/config.js";
import { ERROR_CODES } from "../lib/errors.js";

test("config loads default provider registry", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ysbot-llm-config-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const { SecretsStore } = await importCoreModule(
    resolveCoreDir(),
    "src/core/secrets.js",
  );
  const { PluginConfigStore } = await importCoreModule(
    resolveCoreDir(),
    "src/core/plugin-config.js",
  );
  const ctx = {
    manifest: { id: "llm-bridge" },
    pluginConfig: new PluginConfigStore({
      dataDir: path.join(root, "plugins"),
      secrets: new SecretsStore(path.join(root, "secrets")),
    }),
  };

  const config = await loadPluginConfig(ctx);
  assert.equal(config.defaultProvider, "deepseek");
  assert.equal(config.timeoutMs, 30000);
  assert.equal(config.allowTools, true);
  assert.equal(config.providers.length, 3);
  assert.equal(config.providers[0].id, "deepseek");
  assert.equal(config.providers[0].baseUrl, "https://api.deepseek.com");
});

test("providerDefinition resolves user-defined providers by id", () => {
  const config = {
    defaultProvider: "deepseek",
    providers: [
      {
        id: "custom",
        name: "Custom",
        type: "openai",
        baseUrl: "https://example.com/v1",
        model: "custom-model",
        apiKeyRequired: true,
      },
    ],
  };
  const provider = providerDefinition(config, "custom");
  assert.equal(provider.id, "custom");
  assert.equal(provider.baseUrl, "https://example.com/v1");
  assert.equal(provider.type, "openai");
  assert.equal(provider.apiKeyRequired, true);
});

test("providerDefinition rejects unknown or disabled providers", () => {
  const config = {
    defaultProvider: "missing",
    providers: [{ id: "a", baseUrl: "http://a", enabled: false }],
  };
  assert.throws(
    () => providerDefinition(config, "missing"),
    (error) => error.code === ERROR_CODES.PROVIDER_NOT_CONFIGURED,
  );
});

test("providerCatalog returns only enabled providers", () => {
  const config = {
    providers: [
      { id: "a", enabled: true },
      { id: "b", enabled: false },
    ],
  };
  assert.deepEqual(
    providerCatalog(config).map((item) => item.id),
    ["a"],
  );
});

test("resolveModel prefers request model then default model", () => {
  const config = { defaultModel: "global-model" };
  assert.equal(
    resolveModel(config, { model: "provider-model" }, ""),
    "global-model",
  );
  assert.equal(resolveModel(config, { model: "provider-model" }, "req-model"), "req-model");
  assert.equal(resolveModel(config, { model: "" }, ""), "global-model");
});

test("resolveEndpoint handles versioned and unversioned base URLs", () => {
  assert.equal(
    resolveEndpoint("https://api.deepseek.com", "chat/completions"),
    "https://api.deepseek.com/v1/chat/completions",
  );
  assert.equal(
    resolveEndpoint("http://127.0.0.1:11434/v1", "chat/completions"),
    "http://127.0.0.1:11434/v1/chat/completions",
  );
  assert.equal(
    resolveEndpoint("https://example.com/v1", "completions"),
    "https://example.com/v1/completions",
  );
});

test("resolveOllamaEndpoint maps base URLs to native API paths", () => {
  assert.equal(
    resolveOllamaEndpoint("http://127.0.0.1:11434", "chat"),
    "http://127.0.0.1:11434/api/chat",
  );
  assert.equal(
    resolveOllamaEndpoint("http://127.0.0.1:11434/v1", "generate"),
    "http://127.0.0.1:11434/api/generate",
  );
});

test("CONFIG_SCHEMA stores providers without secret material", () => {
  assert.equal(CONFIG_SCHEMA.type, "object");
  assert.equal(CONFIG_SCHEMA.properties.providers.type, "array");
  assert.equal(CONFIG_SCHEMA.properties.providerApiKeys, undefined);
});

test("loadProviderKeys accepts a plain key for the fallback provider", async () => {
  const ctx = {
    manifest: { id: "llm-bridge" },
    pluginConfig: {
      getSecret: async () => "sk-plain",
    },
  };
  assert.deepEqual(await loadProviderKeys(ctx, "deepseek"), {
    deepseek: "sk-plain",
  });
});
