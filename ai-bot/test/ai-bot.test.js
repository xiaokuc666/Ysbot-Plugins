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

function installFakes(harness, replyQueue = ["你好，我是 AI Bot"]) {
  const calls = [];
  const replies = [...replyQueue];

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
        return { ok: true, data: [{ text: "旧的群聊记忆" }] };
      }
      if (params.action === "list") {
        return {
          ok: true,
          data: {
            entries: [
              {
                id: "mem-1",
                ts: "2026-08-19T00:00:00.000Z",
                type: "note",
                content: "测试记忆",
              },
            ],
            total: 1,
          },
        };
      }
      if (params.action === "clear") {
        return { ok: true, data: { removed: 2 } };
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

test("reply strips speaker prefix before sending", async (t) => {
  const harness = await makeHarness(t, {
    defaultEnabled: true,
    defaultReplyMode: "mention",
  });
  const calls = installFakes(harness, ["烟散：你好呀"]);

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
  const send = calls.find((call) => call.kind === "action");
  const text = send.params.params.message.find(
    (segment) => segment.type === "text",
  ).data.text;
  assert.equal(text, "你好呀");
});

test("direct reply includes memory, history and event context", async (t) => {
  const harness = await makeHarness(t, {
    defaultEnabled: true,
    defaultReplyMode: "mention",
    curiosityEnabled: false,
    curiosityMemoryEnabled: true,
    llmTools: [
      {
        name: "recall_memory",
        description: "召回记忆",
        plugin: "memory-store",
        action: "recall",
        adminOnly: false,
      },
    ],
  });
  const calls = installFakes(harness, ["第一条回复", "第二条回复"]);
  installMemoryStore(harness, calls);

  harness.eventBus.emit("onebot.message", {
    message_type: "group",
    group_id: "100000001",
    user_id: "200000001",
    sender: { nickname: "Alice", role: "member" },
    message: [
      { type: "at", data: { qq: "bot" } },
      { type: "text", data: { text: "你好" } },
    ],
    raw_message: "@bot 你好",
  });
  await waitFor(
    () =>
      calls.filter(
        (call) => call.kind === "action" && call.params.action === "send_group_msg",
      ).length === 1,
  );

  harness.eventBus.emit("onebot.message", {
    message_type: "group",
    group_id: "100000001",
    user_id: "300000001",
    sender: { nickname: "Bob", role: "member" },
    message: [
      { type: "reply", data: { id: "123" } },
      { type: "at", data: { qq: "bot" } },
      { type: "text", data: { text: "在吗" } },
    ],
    raw_message: "@bot 在吗",
  });
  await waitFor(
    () =>
      calls.filter(
        (call) => call.kind === "action" && call.params.action === "send_group_msg",
      ).length === 2,
  );

  const llmCalls = calls.filter((call) => call.kind === "llm");
  assert.equal(llmCalls.length, 2);
  const messages = llmCalls[1].params.params.messages;
  assert.ok(
    messages.some((message) =>
      String(message.content || "").includes("近期记忆"),
    ),
  );
  assert.ok(
    messages.some((message) =>
      String(message.content || "").includes("Alice: 你好"),
    ),
  );
  assert.ok(
    messages.some((message) =>
      String(message.content || "").includes("当前事件上下文"),
    ),
  );
  assert.deepEqual(
    llmCalls[1].params.params.tools[0],
    {
      name: "recall_memory",
      description: "召回记忆",
      plugin: "memory-store",
      action: "recall",
      adminOnly: false,
    },
  );
  assert.equal(llmCalls[1].params.params.executeTools, true);

  const secondSend = calls.filter(
    (call) => call.kind === "action" && call.params.action === "send_group_msg",
  )[1];
  assert.equal(secondSend.params.params.message[0].type, "reply");
  assert.equal(secondSend.params.params.message[1].type, "at");
  assert.equal(secondSend.params.params.message[2].type, "text");
});

test("history store writes lists and clears scenes", async (t) => {
  const harness = await makeHarness(t);
  const history = harness.registry.get("ai-bot").instance.history;

  await history.append(
    {
      scene: { type: "group", id: "100000001" },
      userId: "200000001",
      nickname: "Alice",
      role: "member",
      text: "晚上好",
    },
    { maxEntries: 20, maxAgeMs: 3600000 },
  );
  let entries = await history.list("group:100000001", {
    maxEntries: 20,
    maxAgeMs: 3600000,
  });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].text, "晚上好");

  await history.clear("group:100000001");
  entries = await history.list("group:100000001", {
    maxEntries: 20,
    maxAgeMs: 3600000,
  });
  assert.equal(entries.length, 0);
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

test("curiosity direct reply accepts real memory-store recall array", async (t) => {
  const harness = await makeHarness(t, {
    defaultEnabled: true,
    curiosityEnabled: true,
    curiosityMemoryEnabled: true,
    curiosityRandomReplyProbability: 0,
    curiosityDirectCooldownMs: 60000,
  });
  const calls = installFakes(harness);
  installMemoryStore(harness, calls);

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
  assert.ok(
    calls.some(
      (call) => call.kind === "memory" && call.params.action === "recall",
    ),
  );
  assert.ok(calls.some((call) => call.kind === "llm"));
  const llmCall = calls.find((call) => call.kind === "llm");
  assert.equal(llmCall.params.params.executeTools, true);
  assert.ok(
    llmCall.params.params.messages.some((message) =>
      String(message.content || "").includes("当前事件上下文"),
    ),
  );
});

test("curiosity observe without event does not crash", async (t) => {
  const harness = await makeHarness(t, {
    defaultEnabled: true,
    curiosityEnabled: true,
    curiosityMemoryEnabled: true,
    curiosityRandomReplyProbability: 0,
  });
  const calls = installFakes(harness);
  installMemoryStore(harness, calls);

  await harness.registry.get("ai-bot").instance.handleCuriosityDecision({
    shouldAct: false,
    motivation: {
      type: "periodic_probe",
      groupId: "100000001",
      payload: { traceId: "trace-observe-empty" },
    },
  });

  const observe = calls.find(
    (call) => call.kind === "memory" && call.params.action === "observe",
  );
  assert.ok(observe);
  assert.deepEqual(observe.params.params.event, {});
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

test("admin /ai memory lists memory-store entries", async (t) => {
  const harness = await makeHarness(t);
  const calls = installFakes(harness);
  installMemoryStore(harness, calls);

  harness.eventBus.emit("onebot.message", {
    message_type: "private",
    user_id: "300000001",
    message: [{ type: "text", data: { text: "/ai memory 100000001" } }],
    raw_message: "/ai memory 100000001",
  });

  await waitFor(() => calls.some((call) => call.kind === "memory"));
  assert.ok(calls.some((call) => call.kind === "memory" && call.params.action === "list"));
  assert.ok(calls.some((call) => call.kind === "action"));
});

test("admin /ai note writes memory-store note", async (t) => {
  const harness = await makeHarness(t);
  const calls = installFakes(harness);
  installMemoryStore(harness, calls);

  harness.eventBus.emit("onebot.message", {
    message_type: "private",
    user_id: "300000001",
    message: [{ type: "text", data: { text: "/ai note 100000001 管理员笔记" } }],
    raw_message: "/ai note 100000001 管理员笔记",
  });

  await waitFor(() => calls.some((call) => call.kind === "memory"));
  const noteCall = calls.find(
    (call) => call.kind === "memory" && call.params.action === "note",
  );
  assert.ok(noteCall);
  assert.equal(noteCall.params.params.groupId, "100000001");
  assert.equal(noteCall.params.params.content, "管理员笔记");
});

test("admin /ai memory clear clears memory-store", async (t) => {
  const harness = await makeHarness(t);
  const calls = installFakes(harness);
  installMemoryStore(harness, calls);

  harness.eventBus.emit("onebot.message", {
    message_type: "private",
    user_id: "300000001",
    message: [{ type: "text", data: { text: "/ai memory clear 100000001" } }],
    raw_message: "/ai memory clear 100000001",
  });

  await waitFor(() => calls.some((call) => call.kind === "memory"));
  assert.ok(calls.some((call) => call.kind === "memory" && call.params.action === "clear"));
});

test("admin memory command gives friendly message when memory-store missing", async (t) => {
  const harness = await makeHarness(t);
  const calls = installFakes(harness);

  harness.eventBus.emit("onebot.message", {
    message_type: "private",
    user_id: "300000001",
    message: [{ type: "text", data: { text: "/ai memory 100000001" } }],
    raw_message: "/ai memory 100000001",
  });

  await waitFor(() => calls.some((call) => call.kind === "action"));
  const send = calls.find((call) => call.kind === "action");
  const text = send.params.params.message[0].data.text;
  assert.match(text, /memory-store 未安装/);
  assert.equal(calls.some((call) => call.kind === "memory"), false);
});
