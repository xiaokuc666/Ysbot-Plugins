import { ERROR_CODES, LLMBridgeError } from "./errors.js";

export const DEFAULT_PROVIDERS = [
  {
    id: "deepseek",
    name: "DeepSeek",
    type: "openai",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-chat",
    enabled: true,
    apiKeyRequired: true,
  },
  {
    id: "openai",
    name: "OpenAI",
    type: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    enabled: false,
    apiKeyRequired: true,
  },
  {
    id: "local",
    name: "Local",
    type: "openai",
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "",
    enabled: false,
    apiKeyRequired: false,
  },
];

export const CONFIG_SCHEMA = {
  type: "object",
  properties: {
    defaultProvider: { type: "string", default: "deepseek" },
    defaultModel: { type: "string", default: "" },
    timeoutMs: { type: "integer", default: 30000 },
    allowTools: { type: "boolean", default: true },
    allowToolExecution: { type: "boolean", default: true },
    defaultMaxToolRounds: { type: "integer", default: 3 },
    providers: { type: "array", default: DEFAULT_PROVIDERS },
  },
};

export async function loadPluginConfig(ctx) {
  return ctx.pluginConfig.get(ctx.manifest.id, CONFIG_SCHEMA);
}

export async function loadProviderKeys(ctx, fallbackProviderId = "deepseek") {
  const raw = await ctx.pluginConfig.getSecret(
    ctx.manifest.id,
    "providerApiKeys",
  );
  if (!raw) return {};
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { [fallbackProviderId]: String(raw).trim() };
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed;
  }
  if (typeof parsed === "string" && parsed.trim()) {
    return { [fallbackProviderId]: parsed.trim() };
  }
  return {};
}

export function normalizeProvider(provider) {
  return {
    id: String(provider.id || "").trim(),
    name: String(provider.name || provider.id || "").trim(),
    type: provider.type === "ollama" ? "ollama" : "openai",
    baseUrl: String(provider.baseUrl || "").trim(),
    model: String(provider.model || "").trim(),
    headers:
      provider.headers && typeof provider.headers === "object"
        ? provider.headers
        : {},
    apiKeyRequired: provider.apiKeyRequired !== false,
    enabled: provider.enabled !== false,
  };
}

export function providerDefinition(config, providerId) {
  const providers = Array.isArray(config.providers)
    ? config.providers.map(normalizeProvider)
    : [];
  const selectedId = providerId || config.defaultProvider;
  const selected = providers.find(
    (provider) => provider.id === selectedId && provider.enabled,
  );
  if (!selected) {
    throw new LLMBridgeError(
      ERROR_CODES.PROVIDER_NOT_CONFIGURED,
      `Provider is not configured or disabled: ${selectedId || "(none)"}`,
      { provider: selectedId || null },
    );
  }
  return selected;
}

export function providerCatalog(config) {
  return (Array.isArray(config.providers) ? config.providers : [])
    .map(normalizeProvider)
    .filter((provider) => provider.enabled)
    .map((provider) => ({
      id: provider.id,
      name: provider.name,
      type: provider.type,
      baseUrl: provider.baseUrl,
      model: provider.model,
      apiKeyRequired: provider.apiKeyRequired,
    }));
}

export function assertProviderConfigured(provider) {
  if (!provider.baseUrl) {
    throw new LLMBridgeError(
      ERROR_CODES.PROVIDER_NOT_CONFIGURED,
      `Provider is not configured: ${provider.id}`,
      { provider: provider.id },
    );
  }
}

export function resolveModel(config, provider, requestModel) {
  return String(
    requestModel || config.defaultModel || provider.model || "",
  ).trim();
}

export function resolveEndpoint(baseUrl, path) {
  const root = String(baseUrl || "").replace(/\/+$/, "");
  if (/\/chat\/completions$/.test(root) || /\/completions$/.test(root)) {
    return root;
  }
  if (/\/v\d+$/i.test(root)) {
    return `${root}/${path}`;
  }
  return `${root}/v1/${path}`;
}

export function resolveOllamaEndpoint(baseUrl, path) {
  const root = String(baseUrl || "").replace(/\/+$/, "");
  if (root.endsWith("/api")) return `${root}/${path}`;
  if (root.endsWith("/v1")) return `${root.replace(/\/v1$/, "")}/api/${path}`;
  return `${root}/api/${path}`;
}
