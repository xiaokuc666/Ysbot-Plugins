import test from "node:test";
import assert from "node:assert/strict";
import { loadPluginHarness } from "../../test/plugin-harness.js";
import { CONFIG_SCHEMA } from "../lib/config.js";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeout = 3000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (predicate()) return;
    await delay(10);
  }
  throw new Error("waitFor timeout");
}

async function makeHarness(t, configOverrides = {}) {
  const harness = await loadPluginHarness("ai-bot", {
    pluginConfigOverrides: {
      "ai-bot": {
        defaultEnabled: false,
        privateEnabled: false,
        defaultReplyMode: "mention",
        enabledGroups: [],
        disabledGroups: [],
        adminUserIds: ["300000001"],
        systemPrompt: "You are YSbot.",
        cooldownSeconds: 0,
        maxReplyLength: 2000,
        llmProvider: "",
        llmModel: "",
        ...configOverrides,
      },
      "protocol-onebot": { autoConnect: false },
    },
  });
  t.after(() => harness.cleanup());
  return harness;
}

function installFakes(harness) {
  const calls = [];
  const replies = ["你好，我是 AI Bot"];

  harness.registry.unregister("llm-bridge");
  harness.registry.register({
    id: "llm-bridge",
    type: "capability",
    name: "Fake LLM",
    version: "0.1.0",
    enabled: true,
    status: "ready",
    manifest: { id: "llm-bridge", dependencies: [] },
    async invoke(params) {
      calls.push({ kind: "llm", params });
      return {
        ok: true,
        action: "chat",
        data: {
          choices: [{ message: { content: replies.shift() || "" } }],
        },
      };
    },
    async dispose() {},
  });

  harness.registry.unregister("action-qq");
  harness.registry.register({
    id: "action-qq",
    type: "action",
    name: "Fake Action",
    version: "1.0.0",
    enabled: true,
    status: "ready",
    manifest: { id: "action-qq", dependencies: [] },
    async invoke(params) {
      calls.push({ kind: "action", params });
      return { ok: true, action: params.action, data: { message_id: 1 } };
    },
    async dispose() {},
  });

  return calls;
}

function installMemoryStore(harness, calls) {
  harness.registry.unregister("memory-store");
  harness.registry.register({
    id: "memory-store",
    type: "capability",
    name: "Fake Memory",
    version: "0.1.0",
    enabled: true,
    status: "ready",
    manifest: { id: "memory-store", dependencies: [] },
    async invoke(params) {
      calls.push({ kind: "memory", params });
      if (params.action === "recall") {
        return { ok: true, data: { entries: [{ text: "旧的群聊记忆" }] } };
      }
      return { ok: true, data: {} };
    },
    async dispose() {},
  });
}

test("ai-bot registers log source", async (t) => {
  const harness = await makeHarness(t);
  assert.ok(harness.logging.list().some((source) => source.id === "ai-bot"));
});

test("group @ message triggers llm and action send", async (t) => {
  const harness = await makeHarness(t, {
    defaultEnabled: true,
    defaultReplyMode: "mention",
  });
  const calls = installFakes(harness);

  harness.eventBus.emit("onebot.message", {
    message_type: "group",
    group_id: "100000001",
    user_id: "200000001",
    sender: { role: "member" },
    message: [
      { type: "at", data: { qq: "bot" } },
      { type: "text", data: { text: "你好" } },
    ],
    raw_message: "@bot 你好",
  });

  await waitFor(() => calls.some((call) => call.kind === "action"));
  assert.ok(calls.some((call) => call.kind === "llm"));
  const send = calls.find((call) => call.kind === "action");
  assert.equal(send.params.action, "send_group_msg");
  assert.equal(send.params.params.group_id, "100000001");
});

test("mention mode ignores normal group message", async (t) => {
  const harness = await makeHarness(t, {
    defaultEnabled: true,
    defaultReplyMode: "mention",
  });
  const calls = installFakes(harness);

  harness.eventBus.emit("onebot.message", {
    message_type: "group",
    group_id: "100000001",
    user_id: "200000001",
    sender: { role: "member" },
    message: [{ type: "text", data: { text: "普通消息" } }],
    raw_message: "普通消息",
  });

  await delay(80);
  assert.equal(calls.length, 0);
});

test("disabled group does not reply", async (t) => {
  const harness = await makeHarness(t, {
    defaultEnabled: false,
    enabledGroups: [],
    disabledGroups: [],
  });
  const calls = installFakes(harness);

  harness.eventBus.emit("onebot.message", {
    message_type: "group",
    group_id: "100000001",
    user_id: "200000001",
    message: [{ type: "at", data: { qq: "bot" } }],
    raw_message: "@bot",
  });

  await delay(80);
  assert.equal(calls.length, 0);
});

test("admin private command enables a group", async (t) => {
  const harness = await makeHarness(t);
  const calls = installFakes(harness);

  harness.eventBus.emit("onebot.message", {
    message_type: "private",
    user_id: "300000001",
    message: [{ type: "text", data: { text: "/ai on 200000001" } }],
    raw_message: "/ai on 200000001",
  });

  await waitFor(() => calls.some((call) => call.kind === "action"));
  const config = await harness.ctx.pluginConfig.get("ai-bot", CONFIG_SCHEMA);
  assert.ok(config.enabledGroups.includes("200000001"));
  const send = calls.find((call) => call.kind === "action");
  assert.equal(send.params.params.user_id, "300000001");
});

test("non-admin private command is rejected", async (t) => {
  const harness = await makeHarness(t);
  const calls = installFakes(harness);

  harness.eventBus.emit("onebot.message", {
    message_type: "private",
    user_id: "999999",
    message: [{ type: "text", data: { text: "/ai status" } }],
    raw_message: "/ai status",
  });

  await waitFor(() => calls.some((call) => call.kind === "action"));
  const config = await harness.ctx.pluginConfig.get("ai-bot", CONFIG_SCHEMA);
  assert.deepEqual(config.enabledGroups, []);
  const send = calls.find((call) => call.kind === "action");
  assert.equal(send.params.params.user_id, "999999");
});

test("curiosity direct interaction replies through decision handler", async (t) => {
  const harness = await makeHarness(t, {
    defaultEnabled: true,
    curiosityEnabled: true,
    curiosityMemoryEnabled: false,
    curiosityRandomReplyProbability: 0,
    curiosityDirectCooldownMs: 60000,
  });
  const calls = installFakes(harness);

  harness.eventBus.emit("onebot.message", {
    message_type: "group",
    group_id: "100000001",
    user_id: "200000001",
    sender: { role: "member" },
    message: [
      { type: "at", data: { qq: "bot" } },
      { type: "text", data: { text: "你好" } },
    ],
    raw_message: "@bot 你好",
  });

  await waitFor(() => calls.some((call) => call.kind === "action"));
  assert.ok(calls.some((call) => call.kind === "llm"));
  const send = calls.find((call) => call.kind === "action");
  assert.equal(send.params.action, "send_group_msg");
});

test("curiosity shouldAct false writes observation to memory-store", async (t) => {
  const harness = await makeHarness(t, {
    defaultEnabled: true,
    curiosityEnabled: true,
    curiosityMemoryEnabled: true,
    curiosityRandomReplyProbability: 0,
  });
  const calls = installFakes(harness);
  installMemoryStore(harness, calls);

  harness.eventBus.emit("onebot.message", {
    message_type: "group",
    group_id: "100000001",
    user_id: "200000001",
    sender: { role: "member" },
    message: [{ type: "text", data: { text: "普通消息" } }],
    raw_message: "普通消息",
  });

  await waitFor(() => calls.some((call) => call.kind === "memory"));
  const memoryCall = calls.find((call) => call.kind === "memory");
  assert.equal(memoryCall.params.action, "observe");
});

test("curiosity cooldown suppresses repeated direct reply", async (t) => {
  const harness = await makeHarness(t, {
    defaultEnabled: true,
    curiosityEnabled: true,
    curiosityMemoryEnabled: false,
    curiosityRandomReplyProbability: 0,
    curiosityDirectCooldownMs: 60000,
  });
  const calls = installFakes(harness);

  const emitDirect = () => {
    harness.eventBus.emit("onebot.message", {
      message_type: "group",
      group_id: "100000001",
      user_id: "200000001",
      sender: { role: "member" },
      message: [{ type: "at", data: { qq: "bot" } }],
      raw_message: "@bot",
    });
  };
  emitDirect();
  await waitFor(
    () =>
      calls.filter(
        (call) =>
          call.kind === "action" && call.params.action === "send_group_msg",
      ).length === 1,
  );
  emitDirect();
  await delay(120);
  const sends = calls.filter(
    (call) =>
      call.kind === "action" && call.params.action === "send_group_msg",
  );
  assert.equal(sends.length, 1);
});
