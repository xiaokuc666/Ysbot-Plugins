import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  createChatStore,
  messageToText,
} from "../lib/chat-store.js";

test("messageToText extracts text and marks non-text segments", () => {
  assert.equal(
    messageToText({
      message: [
        { type: "text", data: { text: "hello" } },
        { type: "at", data: { qq: "200000001" } },
        { type: "image", data: { file: "a.png" } },
      ],
    }),
    "hello @200000001 [图片 a.png]",
  );
  assert.equal(
    messageToText({ message: [], raw_message: "fallback" }),
    "fallback",
  );
});

test("chat store captures group and private scenes", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ysbot-chat-store-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = await createChatStore({ dataDir: root });
  await store.capture({
    id: "1",
    message_type: "group",
    group_id: "100000001",
    user_id: "200000001",
    sender: { nickname: "a" },
    message: [{ type: "text", data: { text: "群消息" } }],
    timestamp: 1700000000,
    raw: { message_id: "g1" },
  });
  await store.capture({
    id: "2",
    message_type: "private",
    user_id: "300000001",
    sender: { nickname: "b" },
    message: [{ type: "text", data: { text: "私聊" } }],
    timestamp: 1700000001,
    raw: { message_id: "p1" },
  });

  const scenes = store.listScenes();
  assert.equal(scenes.length, 2);
  assert.equal(scenes[0].type, "private");
  const groupMessage = store.listMessages("group", "100000001")[0];
  assert.equal(groupMessage.text, "群消息");
  assert.deepEqual(groupMessage.segments, [
    { type: "text", data: { text: "群消息" } },
  ]);
  assert.equal(groupMessage.raw.message_id, "g1");
  assert.equal(groupMessage.sender.nickname, "a");
  assert.equal(store.listMessages("private", "300000001")[0].text, "私聊");
});

test("chat store deduplicates repeated message events", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ysbot-chat-dedupe-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = await createChatStore({ dataDir: root });
  const event = {
    id: "1",
    message_type: "group",
    group_id: "100000001",
    user_id: "200000001",
    message: [{ type: "text", data: { text: "dup" } }],
    raw: { message_id: "g1" },
  };
  await Promise.all([store.capture(event), store.capture(event)]);
  assert.equal(store.listMessages("group", "100000001").length, 1);
});

test("chat store marks recalled messages", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ysbot-chat-recall-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = await createChatStore({ dataDir: root });
  await store.capture({
    id: "1",
    message_type: "group",
    group_id: "100000001",
    user_id: "200000001",
    sender: { nickname: "a" },
    message: [{ type: "text", data: { text: "hello" } }],
    timestamp: 1700000000,
    raw: { message_id: "g1" },
  });
  assert.equal(store.findByMessageId("g1").recalled, false);
  await store.markRecalled("g1");
  assert.equal(store.findByMessageId("g1").recalled, true);
});

test("chat store records outgoing messages", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ysbot-chat-out-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = await createChatStore({ dataDir: root });
  await store.recordOutgoing({
    messageId: "out-1",
    sceneType: "group",
    sceneId: "100000001",
    text: "test",
  });
  const messages = store.listMessages("group", "100000001");
  assert.equal(messages.length, 1);
  assert.equal(messages[0].direction, "out");
  assert.equal(messages[0].senderName, "我");
  assert.deepEqual(messages[0].segments, [
    { type: "text", data: { text: "test" } },
  ]);
});

test("chat store clears one scene without touching others", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ysbot-chat-clear-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = await createChatStore({ dataDir: root });
  await store.capture({
    id: "1",
    message_type: "group",
    group_id: "100000001",
    user_id: "200000001",
    message: [{ type: "text", data: { text: "a" } }],
    raw: { message_id: "g1" },
  });
  await store.capture({
    id: "2",
    message_type: "private",
    user_id: "300000001",
    message: [{ type: "text", data: { text: "b" } }],
    raw: { message_id: "p1" },
  });
  await store.clearScene("group", "100000001");
  assert.equal(store.listMessages("group", "100000001").length, 0);
  assert.equal(store.listMessages("private", "300000001").length, 1);
  assert.equal(store.isSceneRemoved("group", "100000001"), true);

  await store.capture({
    id: "3",
    message_type: "group",
    group_id: "100000001",
    user_id: "200000001",
    message: [{ type: "text", data: { text: "new" } }],
    raw: { message_id: "g2" },
  });
  assert.equal(store.listMessages("group", "100000001").length, 1);
  assert.equal(store.isSceneRemoved("group", "100000001"), false);
});
