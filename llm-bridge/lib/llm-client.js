import { ERROR_CODES, LLMBridgeError } from "./errors.js";
import {
  resolveEndpoint,
  resolveOllamaEndpoint,
} from "./config.js";

export class LlmHttpClient {
  constructor({ fetchImpl = globalThis.fetch, defaultTimeoutMs = 30000 } = {}) {
    this.fetchImpl = fetchImpl;
    this.defaultTimeoutMs = defaultTimeoutMs;
  }

  async send({
    action,
    provider,
    baseUrl,
    apiKey,
    payload,
    timeoutMs,
    headers = {},
  }) {
    const isOllama = provider?.type === "ollama";
    const path = action === "chat" ? "chat" : "generate";
    const url = isOllama
      ? resolveOllamaEndpoint(baseUrl, path)
      : resolveEndpoint(
          baseUrl,
          action === "chat" ? "chat/completions" : "completions",
        );
    const timeout = timeoutMs || this.defaultTimeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const requestHeaders = {
      "Content-Type": "application/json",
      ...headers,
    };
    if (apiKey) {
      requestHeaders.Authorization = isOllama
        ? `Bearer ${apiKey}`
        : `Bearer ${apiKey}`;
    }

    let response;
    try {
      response = await this.fetchImpl(url, {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify({
          ...payload,
          stream: false,
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new LLMBridgeError(
          ERROR_CODES.REQUEST_TIMEOUT,
          `LLM request timeout after ${timeout}ms`,
          { action, provider: provider?.id, cause: error, retriable: true },
        );
      }
      throw new LLMBridgeError(
        ERROR_CODES.CONNECTION_LOST,
        `LLM request failed: ${error?.message || "network error"}`,
        { action, provider: provider?.id, cause: error, retriable: true },
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      let wording = "";
      try {
        wording = (await response.text()).slice(0, 500);
      } catch {
        // Keep the HTTP status as the primary error.
      }
      const detail = wording ? `: ${wording.slice(0, 200)}` : "";
      throw new LLMBridgeError(
        ERROR_CODES.PROVIDER_ERROR,
        `LLM provider returned HTTP ${response.status}${detail}`,
        {
          action,
          provider: provider?.id,
          status: response.status,
          wording,
        },
      );
    }

    let data;
    try {
      data = await response.json();
    } catch (error) {
      throw new LLMBridgeError(
        ERROR_CODES.INVALID_RESPONSE,
        "LLM provider returned invalid JSON",
        { action, provider: provider?.id, cause: error },
      );
    }
    if (data?.error) {
      throw new LLMBridgeError(
        ERROR_CODES.PROVIDER_ERROR,
        data.error?.message || "LLM provider error",
        {
          action,
          provider: provider?.id,
          wording: data.error?.message || null,
        },
      );
    }
    return data;
  }
}

export function normalizeChatResponse(raw, provider, model) {
  if (!Array.isArray(raw?.choices) || !raw.choices[0]?.message) {
    throw new LLMBridgeError(
      ERROR_CODES.INVALID_RESPONSE,
      "LLM chat response is missing choices",
      { provider },
    );
  }
  const first = raw.choices[0];
  const choices = raw.choices.map((choice, index) => ({
    index: choice.index ?? index,
    message: choice.message,
    finish_reason: choice.finish_reason || null,
  }));
  const toolCalls = first.message?.tool_calls || null;
  return {
    id: raw.id || null,
    provider,
    model: raw.model || model,
    object: raw.object || "chat.completion",
    created: raw.created || null,
    choices,
    usage: raw.usage || null,
    toolCalls,
    executedTools: false,
    raw,
  };
}

export function normalizeCompletionResponse(raw, provider, model) {
  if (!Array.isArray(raw?.choices) || !raw.choices[0]?.text) {
    throw new LLMBridgeError(
      ERROR_CODES.INVALID_RESPONSE,
      "LLM completion response is missing choices",
      { provider },
    );
  }
  return {
    id: raw.id || null,
    provider,
    model: raw.model || model,
    object: raw.object || "text_completion",
    created: raw.created || null,
    choices: raw.choices.map((choice, index) => ({
      index: choice.index ?? index,
      text: choice.text,
      finish_reason: choice.finish_reason || null,
    })),
    usage: raw.usage || null,
    raw,
  };
}

export function normalizeOllamaChatResponse(raw, provider, model) {
  if (!raw?.message) {
    throw new LLMBridgeError(
      ERROR_CODES.INVALID_RESPONSE,
      "Ollama chat response is missing message",
      { provider },
    );
  }
  return {
    id: raw.created_at || null,
    provider,
    model: raw.model || model,
    object: "chat.completion",
    created: raw.created_at || null,
    choices: [
      {
        index: 0,
        message: raw.message,
        finish_reason: raw.done ? "stop" : null,
      },
    ],
    usage:
      raw.prompt_eval_count !== undefined
        ? {
            prompt_tokens: raw.prompt_eval_count || 0,
            completion_tokens: raw.eval_count || 0,
            total_tokens: (raw.prompt_eval_count || 0) + (raw.eval_count || 0),
          }
        : null,
    toolCalls: raw.message?.tool_calls || null,
    executedTools: false,
    raw,
  };
}

export function normalizeOllamaCompletionResponse(raw, provider, model) {
  if (typeof raw?.response !== "string") {
    throw new LLMBridgeError(
      ERROR_CODES.INVALID_RESPONSE,
      "Ollama completion response is missing response",
      { provider },
    );
  }
  return {
    id: raw.created_at || null,
    provider,
    model: raw.model || model,
    object: "text_completion",
    created: raw.created_at || null,
    choices: [
      {
        index: 0,
        text: raw.response,
        finish_reason: raw.done ? "stop" : null,
      },
    ],
    usage:
      raw.prompt_eval_count !== undefined
        ? {
            prompt_tokens: raw.prompt_eval_count || 0,
            completion_tokens: raw.eval_count || 0,
            total_tokens: (raw.prompt_eval_count || 0) + (raw.eval_count || 0),
          }
        : null,
    raw,
  };
}
