import test from "node:test";
import assert from "node:assert/strict";
import { loadPluginHarness } from "../../test/plugin-harness.js";
import { LlmHttpClient } from "../lib/llm-client.js";
import { CONFIG_SCHEMA } from "../lib/config.js";
import { ERROR_CODES } from "../lib/errors.js";

function chatResponse(overrides = {}) {
  return {
    id: "chatcmpl-test",
    object: "chat.completion",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: "hello" },
        finish_reason: "stop",
      },
    ],
    usage: { total_tokens: 4 },
    ...overrides,
  };
}

function completionResponse(overrides = {}) {
  return {
    id: "cmpl-test",
    object: "text_completion",
    choices: [{ index: 0, text: "done", finish_reason: "stop" }],
    usage: { total_tokens: 4 },
    ...overrides,
  };
}

const PROVIDERS = [
  {
    id: "deepseek",
    name: "DeepSeek",
    type: "openai",
    baseUrl: "http://fake.local",
    model: "deepseek-chat",
    enabled: true,
    apiKeyRequired: true,
  },
  {
    id: "openai",
    name: "OpenAI",
    type: "openai",
    baseUrl: "http://openai.local/v1",
    model: "gpt-test",
    enabled: true,
    apiKeyRequired: true,
  },
  {
    id: "local",
    name: "Local",
    type: "openai",
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "local-model",
    enabled: true,
    apiKeyRequired: false,
  },
];

async function makeHarness(t) {
  const harness = await loadPluginHarness("llm-bridge", {
    pluginConfigOverrides: {
      "llm-bridge": {
        defaultProvider: "deepseek",
        defaultModel: "",
        timeoutMs: 2000,
        allowTools: true,
        providers: PROVIDERS,
      },
    },
  });
  t.after(() => harness.cleanup());
  await harness.ctx.pluginConfig.setSecret(
    "llm-bridge",
    "providerApiKeys",
    JSON.stringify({ deepseek: "test-key", openai: "openai-key" }),
  );
  return harness;
}

function installFakeClient(harness, { chat = chatResponse(), completion = completionResponse() } = {}) {
  const requests = [];
  harness.registry.get("llm-bridge").instance.httpClient = new LlmHttpClient({
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      const data = url.includes("/completions") && !url.includes("/chat/")
        ? completion
        : chat;
      return {
        ok: true,
        status: 200,
        async json() {
          return data;
        },
        async text() {
          return "";
        },
      };
    },
  });
  return requests;
}

test("llm-bridge loads and exposes configured providers", async (t) => {
  const harness = await makeHarness(t);
  const result = await harness.invoke({
    action: "providers",
    params: {},
    context: { traceId: "trace-providers" },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.providers.map((item) => item.id),
    ["deepseek", "openai", "local"],
  );
  assert.equal(result.providers[0].keyConfigured, true);
  assert.equal(result.providers[2].baseUrl, "http://127.0.0.1:11434/v1");
});

test("llm-bridge chat calls fake provider and returns normalized data", async (t) => {
  const harness = await makeHarness(t);
  const requests = installFakeClient(harness);

  const result = await harness.invoke({
    action: "chat",
    params: {
      messages: [{ role: "user", content: "hi" }],
      temperature: 0.2,
      max_tokens: 64,
    },
    context: {
      actor: { id: "caller", roles: ["admin"] },
      scene: { type: "group", id: "100000001" },
      traceId: "trace-chat",
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.provider, "deepseek");
  assert.equal(result.data.choices[0].message.content, "hello");
  assert.equal(result.traceId, "trace-chat");
  assert.equal(requests[0].url, "http://fake.local/v1/chat/completions");
  const body = JSON.parse(requests[0].options.body);
  assert.equal(body.temperature, 0.2);
  assert.equal(body.max_tokens, 64);
});

test("llm-bridge completion calls fake provider", async (t) => {
  const harness = await makeHarness(t);
  installFakeClient(harness, { completion: completionResponse() });

  const result = await harness.invoke({
    action: "completion",
    params: { prompt: "hello", provider: "openai" },
    context: { traceId: "trace-completion" },
  });
  assert.equal(result.provider, "openai");
  assert.equal(result.data.choices[0].text, "done");
});

test("llm-bridge accepts a plain providerApiKeys value for default provider", async (t) => {
  const harness = await makeHarness(t);
  await harness.ctx.pluginConfig.setSecret(
    "llm-bridge",
    "providerApiKeys",
    "test-key",
  );
  const requests = installFakeClient(harness);

  const result = await harness.invoke({
    action: "chat",
    params: { messages: [{ role: "user", content: "hi" }] },
    context: { traceId: "trace-plain-key" },
  });
  assert.equal(result.provider, "deepseek");
  assert.equal(requests[0].options.headers.Authorization, "Bearer test-key");
});

test("llm-bridge returns NO_API_KEY when provider key is missing", async (t) => {
  const harness = await makeHarness(t);
  await harness.ctx.pluginConfig.setSecret(
    "llm-bridge",
    "providerApiKeys",
    JSON.stringify({ deepseek: "test-key" }),
  );
  await assert.rejects(
    harness.invoke({
      action: "chat",
      params: { provider: "openai", messages: [{ role: "user", content: "hi" }] },
      context: { traceId: "trace-no-key" },
    }),
    (error) => error.code === ERROR_CODES.NO_API_KEY,
  );
});

test("llm-bridge returns INVALID_PARAMS for empty messages", async (t) => {
  const harness = await makeHarness(t);
  await assert.rejects(
    harness.invoke({
      action: "chat",
      params: { messages: [] },
      context: { traceId: "trace-bad-params" },
    }),
    (error) => error.code === ERROR_CODES.INVALID_PARAMS,
  );
});

test("llm-bridge passes tool calls through without executing", async (t) => {
  const harness = await makeHarness(t);
  installFakeClient(harness, {
    chat: chatResponse({
      choices: [
        {
          message: {
            role: "assistant",
            content: "",
            tool_calls: [{ id: "call-1", type: "function" }],
          },
        },
      ],
    }),
  });

  const result = await harness.invoke({
    action: "chat",
    params: {
      messages: [{ role: "user", content: "use tool" }],
      tools: [{ type: "function", function: { name: "echo" } }],
    },
    context: { traceId: "trace-tool" },
  });
  assert.equal(result.data.toolCalls.length, 1);
  assert.equal(result.data.executedTools, false);
});

test("llm-bridge supports user-defined custom providers", async (t) => {
  const harness = await makeHarness(t);
  const instance = harness.registry.get("llm-bridge").instance;
  const custom = {
    id: "custom",
    name: "Custom",
    type: "openai",
    baseUrl: "http://custom.local/v1",
    model: "custom-model",
    enabled: true,
    apiKeyRequired: true,
  };
  await harness.ctx.pluginConfig.set(
    "llm-bridge",
    {
    ...instance.config,
    providers: [...PROVIDERS, custom],
    },
    CONFIG_SCHEMA,
  );
  await instance.refreshConfig();
  await harness.ctx.pluginConfig.setSecret(
    "llm-bridge",
    "providerApiKeys",
    JSON.stringify({ deepseek: "test-key", custom: "custom-key" }),
  );
  const requests = installFakeClient(harness);

  const result = await harness.invoke({
    action: "chat",
    params: {
      provider: "custom",
      messages: [{ role: "user", content: "hi" }],
    },
    context: { traceId: "trace-custom" },
  });
  assert.equal(result.provider, "custom");
  assert.equal(requests[0].url, "http://custom.local/v1/chat/completions");
});

test("llm-bridge registers provider test admin routes", async (t) => {
  const harness = await makeHarness(t);
  const paths = harness.apiRouter.routes.map((route) => route.path);
  assert.ok(
    paths.includes("/api/plugins/llm-bridge/admin/providers.json"),
  );
  assert.ok(
    paths.includes("/api/plugins/llm-bridge/admin/providers/test"),
  );
});

test("llm-bridge provider test returns success with fake provider", async (t) => {
  const harness = await makeHarness(t);
  const requests = installFakeClient(harness);
  const instance = harness.registry.get("llm-bridge").instance;
  let response = null;

  await instance.handleProviderTest({
    body: { providerId: "deepseek" },
    sendJson: (status, data) => {
      response = { status, data };
    },
  });

  assert.equal(response.status, 200);
  assert.equal(response.data.ok, true);
  assert.equal(response.data.provider, "deepseek");
  assert.equal(typeof response.data.latencyMs, "number");
  assert.equal(requests[0].url, "http://fake.local/v1/chat/completions");
});

test("llm-bridge provider test reports missing key", async (t) => {
  const harness = await makeHarness(t);
  await harness.ctx.pluginConfig.setSecret(
    "llm-bridge",
    "providerApiKeys",
    JSON.stringify({ deepseek: "test-key" }),
  );
  const instance = harness.registry.get("llm-bridge").instance;

  await assert.rejects(
    instance.handleProviderTest({
      body: { providerId: "openai" },
      sendJson: () => {},
    }),
    (error) => error.code === ERROR_CODES.NO_API_KEY,
  );
});

test("llm-bridge rejects unsupported actions", async (t) => {
  const harness = await makeHarness(t);
  await assert.rejects(
    harness.invoke({
      action: "unknown",
      params: {},
      context: {},
    }),
    (error) => error.code === ERROR_CODES.UNSUPPORTED_ACTION,
  );
});

test("llm-bridge registers log source and disposes cleanly", async (t) => {
  const harness = await makeHarness(t);
  assert.ok(harness.logging.list().some((source) => source.id === "llm-bridge"));
  const instance = harness.registry.get("llm-bridge").instance;
  await instance.dispose();
  assert.equal(
    harness.logging.list().some((source) => source.id === "llm-bridge"),
    false,
  );
});
