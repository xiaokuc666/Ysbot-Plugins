import {
  assertProviderConfigured,
  loadPluginConfig,
  loadProviderKeys,
  providerCatalog,
  providerDefinition,
  resolveModel,
} from "./lib/config.js";
import { ERROR_CODES, LLMBridgeError, toLlmBridgeError } from "./lib/errors.js";
import {
  LlmHttpClient,
  normalizeChatResponse,
  normalizeCompletionResponse,
  normalizeOllamaChatResponse,
  normalizeOllamaCompletionResponse,
} from "./lib/llm-client.js";
import { createPluginLogger } from "./lib/logger.js";

const ACTIONS = new Set(["chat", "completion", "providers"]);

function generateTraceId() {
  return `trace-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

export default class LlmBridgePlugin {
  async init(ctx) {
    this.ctx = ctx;
    this.disposed = false;
    this.config = await loadPluginConfig(ctx);
    this.log = await createPluginLogger(ctx);
    this.httpClient = new LlmHttpClient({
      defaultTimeoutMs: this.config.timeoutMs,
    });
    this.stats = {
      calls: 0,
      ok: 0,
      failed: 0,
      lastError: null,
      startedAt: new Date().toISOString(),
    };
    this.registerRoutes(ctx.api);
  }

  registerRoutes(api) {
    this.cleanupRoutes(api);
    const register = (method, routePath, handler) => {
      api[method.toLowerCase()](routePath, (helpers) =>
        handler.call(this, helpers),
      );
      const route = api.routes[api.routes.length - 1];
      if (route) route._llmBridge = true;
    };
    register(
      "GET",
      "/api/plugins/llm-bridge/admin/providers.json",
      this.handleProvidersJson,
    );
    register(
      "POST",
      "/api/plugins/llm-bridge/admin/providers/test",
      this.handleProviderTest,
    );
  }

  cleanupRoutes(api) {
    if (!api?.routes) return;
    api.routes = api.routes.filter((route) => {
      if (route._llmBridge) return false;
      return !String(route.path || "").startsWith(
        "/api/plugins/llm-bridge/admin/providers",
      );
    });
  }

  async handleProvidersJson({ sendJson }) {
    if (this.disposed) {
      sendJson(503, { ok: false, error: "llm-bridge is disabled" });
      return;
    }
    await this.refreshConfig();
    sendJson(200, { ok: true, providers: await this.handleProviders() });
  }

  async handleProviderTest({ body, sendJson }) {
    if (this.disposed) {
      sendJson(503, { ok: false, error: "llm-bridge is disabled" });
      return;
    }
    await this.refreshConfig();
    const providerId = body?.providerId;
    if (!providerId) {
      const error = new Error("providerId is required");
      error.statusCode = 400;
      throw error;
    }
    const traceId = generateTraceId();
    try {
      const provider = providerDefinition(this.config, providerId);
      assertProviderConfigured(provider);
      const model = resolveModel(this.config, provider, body?.model || null);
      if (!model) {
        throw new LLMBridgeError(
          ERROR_CODES.INVALID_PARAMS,
          "model is required",
          { provider: provider.id },
        );
      }
      const providerKeys = await loadProviderKeys(
        this.ctx,
        this.config.defaultProvider,
      );
      const apiKey =
        providerKeys[provider.id] ||
        (await this.ctx.pluginConfig.getSecret(
          this.ctx.manifest.id,
          `${provider.id}ApiKey`,
        ));
      if (provider.apiKeyRequired && !apiKey) {
        throw new LLMBridgeError(
          ERROR_CODES.NO_API_KEY,
          `Missing API key for provider: ${providerId}`,
          { provider: providerId },
        );
      }
      const payload =
        provider.type === "ollama"
          ? {
              model,
              messages: [{ role: "user", content: "ping" }],
              options: { num_predict: 8 },
            }
          : {
              model,
              messages: [{ role: "user", content: "ping" }],
              max_tokens: 8,
            };
      const startedAt = Date.now();
      const raw = await this.httpClient.send({
        action: "chat",
        provider,
        baseUrl: provider.baseUrl,
        apiKey,
        payload,
        timeoutMs: Math.min(
          this.config.timeoutMs || 30000,
          body?.timeoutMs || 15000,
        ),
        headers: provider.headers,
      });
      const data =
        provider.type === "ollama"
          ? normalizeOllamaChatResponse(raw, provider.id, model)
          : normalizeChatResponse(raw, provider.id, model);
      const latencyMs = Date.now() - startedAt;
      this.log.info("providers", "provider test ok", {
        traceId,
        provider: provider.id,
        model,
        latencyMs,
      });
      sendJson(200, {
        ok: true,
        provider: provider.id,
        model,
        latencyMs,
        reply: data.choices?.[0]?.message?.content || data.choices?.[0]?.text || "",
      });
    } catch (error) {
      const llmError = toLlmBridgeError(error, "provider-test", providerId);
      this.log.warn("providers", `provider test failed: ${llmError.message}`, {
        traceId,
        provider: providerId,
        code: llmError.code,
      }, llmError);
      throw llmError;
    }
  }

  async invoke(params = {}, callContext = {}) {
    if (this.disposed) {
      throw new LLMBridgeError(ERROR_CODES.DISPOSED, "llm-bridge is disabled");
    }
    await this.refreshConfig();
    const context = { ...callContext, ...(params.context || {}) };
    const action = params?.action;
    const llmParams = params?.params || {};
    const traceId = context.traceId || params.traceId || generateTraceId();

    try {
      if (!action || typeof action !== "string") {
        throw new LLMBridgeError(
          ERROR_CODES.INVALID_CONTEXT,
          "action is required",
        );
      }
      if (!ACTIONS.has(action)) {
        throw new LLMBridgeError(
          ERROR_CODES.UNSUPPORTED_ACTION,
          `Unsupported action: ${action}`,
        );
      }
      await this.assertPermission(context, action);
      this.stats.calls += 1;

      if (action === "providers") {
        const providers = await this.handleProviders();
        this.stats.ok += 1;
        this.log.info("llm", "providers ok", { traceId });
        return { ok: true, action, providers, traceId };
      }

      const result =
        action === "chat"
          ? await this.chat(llmParams, traceId)
          : await this.completion(llmParams, traceId);
      this.stats.ok += 1;
      this.stats.lastError = null;
      this.log.info("llm", `${action} ok`, {
        action,
        provider: result.provider,
        model: result.model,
        traceId,
      });
      return {
        ok: true,
        action,
        provider: result.provider,
        model: result.model,
        data: result.data,
        traceId,
      };
    } catch (error) {
      const llmError = toLlmBridgeError(error, action || null);
      this.stats.failed += 1;
      this.stats.lastError = llmError.message;
      this.log.warn(
        "llm",
        `${action || "unknown"} failed: ${llmError.message}`,
        {
          action: action || null,
          provider: llmError.provider || null,
          code: llmError.code,
          traceId,
        },
        llmError,
      );
      throw llmError;
    }
  }

  async assertPermission(context, action) {
    if (!this.ctx.permissions) return;
    await this.ctx.permissions.assert("llm-bridge", {
      actor: context.actor,
      scene: context.scene,
      resource: { action },
    });
  }

  async refreshConfig() {
    this.config = await loadPluginConfig(this.ctx);
  }

  async handleProviders() {
    const providers = providerCatalog(this.config);
    const providerKeys = await loadProviderKeys(
      this.ctx,
      this.config.defaultProvider,
    );
    return providers.map((provider) => ({
      ...provider,
      configured: Boolean(
        provider.baseUrl && (provider.model || this.config.defaultModel),
      ),
      keyConfigured: Boolean(
        providerKeys[provider.id] || !provider.apiKeyRequired,
      ),
    }));
  }

  async chat(params, traceId) {
    const providerId = params.provider || this.config.defaultProvider;
    const provider = providerDefinition(this.config, providerId);
    assertProviderConfigured(provider);
    const providerKeys = await loadProviderKeys(this.ctx, provider.id);
    const apiKey =
      providerKeys[provider.id] ||
      (await this.ctx.pluginConfig.getSecret(
        this.ctx.manifest.id,
        `${provider.id}ApiKey`,
      ));
    if (provider.apiKeyRequired && !apiKey) {
      throw new LLMBridgeError(
        ERROR_CODES.NO_API_KEY,
        `Missing API key for provider: ${providerId}`,
        { provider: providerId },
      );
    }
    const model = resolveModel(this.config, provider, params.model);
    if (!model) {
      throw new LLMBridgeError(
        ERROR_CODES.INVALID_PARAMS,
        "model is required",
        { provider: providerId },
      );
    }
    if (!Array.isArray(params.messages) || params.messages.length === 0) {
      throw new LLMBridgeError(
        ERROR_CODES.INVALID_PARAMS,
        "messages must be a non-empty array",
        { provider: providerId },
      );
    }
    const payload = { model, messages: params.messages };
    this.applyCommonParams(payload, params);
    if (Array.isArray(params.tools) && params.tools.length) {
      if (!this.config.allowTools) {
        throw new LLMBridgeError(
          ERROR_CODES.INVALID_PARAMS,
          "tools are disabled by allowTools",
          { provider: providerId },
        );
      }
      payload.tools = params.tools;
      if (params.tool_choice !== undefined) {
        payload.tool_choice = params.tool_choice;
      }
    }
    const raw = await this.httpClient.send({
      action: "chat",
      provider,
      baseUrl: provider.baseUrl,
      apiKey,
      payload,
      timeoutMs: params.timeoutMs || this.config.timeoutMs,
      headers: provider.headers,
    });
    const data =
      provider.type === "ollama"
        ? normalizeOllamaChatResponse(raw, providerId, model)
        : normalizeChatResponse(raw, providerId, model);
    this.log.debug("llm", "chat raw response", {
      traceId,
      provider: providerId,
      model,
      toolCalls: Boolean(data.toolCalls),
    });
    return { provider: providerId, model, data };
  }

  async completion(params, traceId) {
    const providerId = params.provider || this.config.defaultProvider;
    const provider = providerDefinition(this.config, providerId);
    assertProviderConfigured(provider);
    const providerKeys = await loadProviderKeys(this.ctx, provider.id);
    const apiKey =
      providerKeys[provider.id] ||
      (await this.ctx.pluginConfig.getSecret(
        this.ctx.manifest.id,
        `${provider.id}ApiKey`,
      ));
    if (provider.apiKeyRequired && !apiKey) {
      throw new LLMBridgeError(
        ERROR_CODES.NO_API_KEY,
        `Missing API key for provider: ${providerId}`,
        { provider: providerId },
      );
    }
    const model = resolveModel(this.config, provider, params.model);
    if (!model) {
      throw new LLMBridgeError(
        ERROR_CODES.INVALID_PARAMS,
        "model is required",
        { provider: providerId },
      );
    }
    if (typeof params.prompt !== "string" || params.prompt.trim() === "") {
      throw new LLMBridgeError(
        ERROR_CODES.INVALID_PARAMS,
        "prompt must be a non-empty string",
        { provider: providerId },
      );
    }
    const payload = { model, prompt: params.prompt };
    this.applyCommonParams(payload, params);
    const raw = await this.httpClient.send({
      action: "completion",
      provider,
      baseUrl: provider.baseUrl,
      apiKey,
      payload,
      timeoutMs: params.timeoutMs || this.config.timeoutMs,
      headers: provider.headers,
    });
    const data =
      provider.type === "ollama"
        ? normalizeOllamaCompletionResponse(raw, providerId, model)
        : normalizeCompletionResponse(raw, providerId, model);
    this.log.debug("llm", "completion raw response", {
      traceId,
      provider: providerId,
      model,
    });
    return { provider: providerId, model, data };
  }

  applyCommonParams(payload, params) {
    if (params.temperature !== undefined) {
      payload.temperature = params.temperature;
    }
    if (params.max_tokens !== undefined) {
      payload.max_tokens = params.max_tokens;
    } else if (params.maxTokens !== undefined) {
      payload.max_tokens = params.maxTokens;
    }
  }

  status() {
    return { ...this.stats, disposed: this.disposed };
  }

  async dispose() {
    this.disposed = true;
    this.cleanupRoutes(this.ctx?.api);
    this.stats.lastError = "disposed";
    this.log.info("index", "disposed");
    await this.log.flush();
    await this.log.unregister();
  }
}
