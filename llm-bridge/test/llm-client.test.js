import test from "node:test";
import assert from "node:assert/strict";
import {
  LlmHttpClient,
  normalizeChatResponse,
  normalizeCompletionResponse,
  normalizeOllamaChatResponse,
  normalizeOllamaCompletionResponse,
} from "../lib/llm-client.js";
import { ERROR_CODES } from "../lib/errors.js";

function fakeResponse({ ok = true, status = 200, body = null, text = "" } = {}) {
  return {
    ok,
    status,
    async json() {
      if (body === null) throw new Error("invalid json");
      return body;
    },
    async text() {
      return text;
    },
  };
}

const OPENAI_PROVIDER = { id: "deepseek", type: "openai" };

test("LlmHttpClient sends OpenAI-compatible chat request", async () => {
  const requests = [];
  const client = new LlmHttpClient({
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return fakeResponse({
        body: {
          id: "chatcmpl-1",
          choices: [{ index: 0, message: { role: "assistant", content: "hi" } }],
        },
      });
    },
  });

  const raw = await client.send({
    action: "chat",
    provider: OPENAI_PROVIDER,
    baseUrl: "https://api.deepseek.com",
    apiKey: "secret",
    payload: { model: "deepseek-chat", messages: [{ role: "user", content: "hi" }] },
    timeoutMs: 1000,
    headers: { "X-Custom": "1" },
  });

  assert.equal(requests[0].url, "https://api.deepseek.com/v1/chat/completions");
  assert.equal(requests[0].options.headers.Authorization, "Bearer secret");
  assert.equal(requests[0].options.headers["X-Custom"], "1");
  assert.equal(raw.choices[0].message.content, "hi");
});

test("LlmHttpClient sends Ollama native chat request", async () => {
  const requests = [];
  const client = new LlmHttpClient({
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return fakeResponse({
        body: { model: "qwen2.5:7b", message: { role: "assistant", content: "hi" }, done: true },
      });
    },
  });

  await client.send({
    action: "chat",
    provider: { id: "local", type: "ollama" },
    baseUrl: "http://127.0.0.1:11434",
    apiKey: "",
    payload: { model: "qwen2.5:7b", messages: [] },
    timeoutMs: 1000,
  });

  assert.equal(requests[0].url, "http://127.0.0.1:11434/api/chat");
  assert.equal(JSON.parse(requests[0].options.body).stream, false);
});

test("LlmHttpClient returns PROVIDER_ERROR for non-ok response", async () => {
  const client = new LlmHttpClient({
    fetchImpl: async () => fakeResponse({ ok: false, status: 401, text: "bad key" }),
  });
  await assert.rejects(
    client.send({
      action: "chat",
      provider: OPENAI_PROVIDER,
      baseUrl: "https://example.com/v1",
      apiKey: "bad",
      payload: {},
    }),
    (error) => error.code === ERROR_CODES.PROVIDER_ERROR && error.status === 401,
  );
});

test("LlmHttpClient returns REQUEST_TIMEOUT when request aborts", async () => {
  const client = new LlmHttpClient({
    fetchImpl: async (_url, options) => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      if (options.signal?.aborted) {
        throw Object.assign(new Error("aborted"), { name: "AbortError" });
      }
      return fakeResponse({ body: { choices: [] } });
    },
  });
  await assert.rejects(
    client.send({
      action: "chat",
      provider: OPENAI_PROVIDER,
      baseUrl: "http://127.0.0.1:11434/v1",
      apiKey: "",
      payload: {},
      timeoutMs: 5,
    }),
    (error) => error.code === ERROR_CODES.REQUEST_TIMEOUT,
  );
});

test("LlmHttpClient returns INVALID_RESPONSE for invalid JSON", async () => {
  const client = new LlmHttpClient({
    fetchImpl: async () => fakeResponse(),
  });
  await assert.rejects(
    client.send({
      action: "completion",
      provider: OPENAI_PROVIDER,
      baseUrl: "http://127.0.0.1:11434/v1",
      apiKey: "",
      payload: {},
    }),
    (error) => error.code === ERROR_CODES.INVALID_RESPONSE,
  );
});

test("normalizeChatResponse extracts tool calls without executing", () => {
  const data = normalizeChatResponse(
    {
      id: "1",
      choices: [
        {
          message: {
            role: "assistant",
            content: "",
            tool_calls: [{ id: "call-1", type: "function" }],
          },
        },
      ],
    },
    "deepseek",
    "deepseek-chat",
  );
  assert.equal(data.toolCalls.length, 1);
  assert.equal(data.executedTools, false);
});

test("normalizeCompletionResponse returns text choices", () => {
  const data = normalizeCompletionResponse(
    {
      id: "2",
      choices: [{ text: "hello", finish_reason: "stop" }],
    },
    "local",
    "local-model",
  );
  assert.equal(data.choices[0].text, "hello");
});

test("normalizeOllamaChatResponse converts native chat response", () => {
  const data = normalizeOllamaChatResponse(
    {
      model: "qwen2.5:7b",
      created_at: "2026-01-01T00:00:00Z",
      message: { role: "assistant", content: "hi" },
      done: true,
      prompt_eval_count: 5,
      eval_count: 7,
    },
    "local",
    "qwen2.5:7b",
  );
  assert.equal(data.choices[0].message.content, "hi");
  assert.equal(data.usage.total_tokens, 12);
});

test("normalizeOllamaCompletionResponse converts native generate response", () => {
  const data = normalizeOllamaCompletionResponse(
    { model: "qwen2.5:7b", response: "done", done: true },
    "local",
    "qwen2.5:7b",
  );
  assert.equal(data.choices[0].text, "done");
});
