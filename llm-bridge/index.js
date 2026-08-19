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

function normalizeToolDefinitions(tools) {
  if (!Array.isArray(tools)) return tools;
  return tools.map((tool) => {
    if (tool?.type === "function" && tool.function?.name) return tool;
    if (tool?.name && tool?.plugin) {
      return {
        type: "function",
        function: {
          name: tool.name,
          description: tool.description || "",
          parameters: {
            type: "object",
            properties: {},
            additionalProperties: true,
          },
        },
      };
    }
    return tool;
  });
}

function toolCallName(toolCall) {
  return (
    toolCall?.function?.name ||
    toolCall?.name ||
    toolCall?.tool_name ||
    null
  );
}

function parseToolArguments(toolCall) {
  const raw =
    toolCall?.function?.arguments ??
    toolCall?.arguments ??
    toolCall?.parameters;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return { _raw: raw };
    }
  }
  if (raw && typeof raw === "object") return raw;
  return {};
}

function isAdminContext(context) {
  return Boolean(
    context?.actor?.admin === true ||
      context?.actor?.origin === "management" ||
      context?.approved === true ||
      (Array.isArray(context?.actor?.roles) &&
        context.actor.roles.includes("admin")),
  );
}

function isWriteToolAction(action) {
  const value = String(action || "");
  return ["send_", "set_", "delete_", "clear", "forget", "note"].some(
    (prefix) => value.startsWith(prefix),
  );
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
          ? await this.chat(llmParams, context, traceId)
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

  async chat(params, context = {}, traceId) {
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
    const toolDefinitions = normalizeToolDefinitions(params.tools);
    const hasTools =
      Array.isArray(toolDefinitions) && toolDefinitions.length > 0;
    if (hasTools) {
      if (!this.config.allowTools) {
        throw new LLMBridgeError(
          ERROR_CODES.INVALID_PARAMS,
          "tools are disabled by allowTools",
          { provider: providerId },
        );
      }
      payload.tools = toolDefinitions;
      if (params.tool_choice !== undefined) {
        payload.tool_choice = params.tool_choice;
      }
    }

    if (params.executeTools !== true) {
      const data = await this.sendChatRequest({
        providerId,
        model,
        payload,
        params,
        provider,
        apiKey,
        traceId,
      });
      return { provider: providerId, model, data };
    }

    if (!this.config.allowToolExecution) {
      throw new LLMBridgeError(
        ERROR_CODES.INVALID_PARAMS,
        "tool execution is disabled by allowToolExecution",
        { provider: providerId },
      );
    }

    const maxToolRounds = Math.max(
      1,
      Math.min(
        10,
        Number(params.maxToolRounds ?? this.config.defaultMaxToolRounds) || 3,
      ),
    );
    const toolTrace = [];
    let messages = params.messages;
    let data = await this.sendChatRequest({
      providerId,
      model,
      payload,
      params,
      provider,
      apiKey,
      traceId,
    });

    for (let round = 0; round < maxToolRounds; round += 1) {
      if (!Array.isArray(data.toolCalls) || data.toolCalls.length === 0) {
        break;
      }
      const assistantMessage = data.choices?.[0]?.message;
      if (assistantMessage) messages = [...messages, assistantMessage];
      for (const toolCall of data.toolCalls) {
        const executed = await this.executeToolCall(
          toolCall,
          params.tools || [],
          context,
          traceId,
        );
        toolTrace.push(executed.trace);
        messages.push({
          role: "tool",
          tool_call_id: executed.toolCallId,
          content: executed.content,
        });
      }
      const nextPayload = { model, messages };
      this.applyCommonParams(nextPayload, params);
      if (hasTools) nextPayload.tools = toolDefinitions;
      data = await this.sendChatRequest({
        providerId,
        model,
        payload: nextPayload,
        params,
        provider,
        apiKey,
        traceId,
      });
    }

    return {
      provider: providerId,
      model,
      data: { ...data, executedTools: true, toolTrace },
      toolTrace,
    };
  }

  async sendChatRequest({
    providerId,
    model,
    payload,
    params,
    provider,
    apiKey,
    traceId,
  }) {
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
    return data;
  }

  async executeToolCall(toolCall, tools, context, traceId) {
    const name = toolCallName(toolCall);
    const toolCallId =
      toolCall?.id || toolCall?.call_id || `call-${Date.now()}`;
    const tool = Array.isArray(tools)
      ? tools.find(
          (item) =>
            String(item?.name || item?.function?.name || "") === String(name || ""),
        )
      : null;
    if (!name || !tool) {
      const error = new LLMBridgeError(
        ERROR_CODES.TOOL_NOT_REGISTERED,
        `Tool is not registered: ${name || "(unknown)"}`,
      );
      return this.toolExecutionResult(toolCallId, name, null, null, error);
    }
    const plugin = tool.plugin || tool.function?.plugin;
    const action = tool.action || tool.function?.action;
    if (!plugin || !action) {
      const error = new LLMBridgeError(
        ERROR_CODES.TOOL_NOT_REGISTERED,
        `Tool has no plugin/action binding: ${name}`,
      );
      return this.toolExecutionResult(toolCallId, name, plugin, action, error);
    }
    if (tool.adminOnly && !isAdminContext(context)) {
      const error = new LLMBridgeError(
        ERROR_CODES.TOOL_PERMISSION_DENIED,
        `Tool requires admin permission: ${name}`,
      );
      return this.toolExecutionResult(toolCallId, name, plugin, action, error);
    }
    if (
      isWriteToolAction(action) &&
      (!context?.actor?.id || !context?.scene?.id)
    ) {
      const error = new LLMBridgeError(
        ERROR_CODES.INVALID_CONTEXT,
        `Tool requires actor and scene: ${name}`,
      );
      return this.toolExecutionResult(toolCallId, name, plugin, action, error);
    }
    const args = parseToolArguments(toolCall);
    try {
      const result = await this.ctx.registry.invoke(plugin, {
        action,
        params: args,
        context: {
          actor: context?.actor || null,
          scene: context?.scene || null,
          traceId,
          approved: context?.approved,
        },
      });
      this.log.info("tools", "tool ok", {
        traceId,
        toolName: name,
        plugin,
        action,
      });
      return this.toolExecutionResult(
        toolCallId,
        name,
        plugin,
        action,
        null,
        result,
      );
    } catch (error) {
      const llmError = toLlmBridgeError(error, action, plugin);
      this.log.warn("tools", `tool failed: ${llmError.message}`, {
        traceId,
        toolName: name,
        plugin,
        action,
        code: llmError.code,
      }, llmError);
      return this.toolExecutionResult(
        toolCallId,
        name,
        plugin,
        action,
        llmError,
      );
    }
  }

  toolExecutionResult(toolCallId, name, plugin, action, error, result = null) {
    const trace = {
      name,
      plugin,
      action,
      status: error ? "error" : "ok",
      ...(error
        ? { code: error.code, error: error.message }
        : { result }),
    };
    const content = error
      ? JSON.stringify({ status: "error", code: error.code, error: error.message })
      : JSON.stringify({ status: "ok", result });
    return { toolCallId, content, trace };
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
