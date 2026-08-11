import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeOneBotEvent,
  normalizeOneBotMessage,
} from "../lib/event-normalizer.js";

test("normalizes group message with actor and scene", () => {
  const normalized = normalizeOneBotMessage({
    post_type: "message",
    message_type: "group",
    message_id: 100,
    group_id: 100000001,
    user_id: 200000001,
    sender: {
      user_id: 200000001,
      nickname: "cola",
      role: "admin",
    },
    message: [{ type: "text", data: { text: "hello" } }],
    raw_message: "hello",
    time: 1700000000,
  });
  assert.equal(normalized.id, "100");
  assert.equal(normalized.type, "message");
  assert.equal(normalized.message_type, "group");
  assert.equal(normalized.group_id, "100000001");
  assert.equal(normalized.actor.id, "200000001");
  assert.equal(normalized.actor.admin, true);
  assert.deepEqual(normalized.scene, {
    type: "group",
    id: "100000001",
  });
});

test("normalizes private message scene", () => {
  const normalized = normalizeOneBotEvent({
    post_type: "message",
    message_type: "private",
    message_id: 2,
    user_id: 123,
    sender: { user_id: 123, nickname: "u" },
    message: [],
    time: 1700000001,
  });
  assert.equal(normalized.message_type, "private");
  assert.deepEqual(normalized.scene, { type: "private", id: "123" });
});

test("normalizes notice and request events", () => {
  const notice = normalizeOneBotEvent({
    post_type: "notice",
    notice_type: "group_recall",
    group_id: 1,
    user_id: 2,
    operator_id: 3,
    time: 1700000002,
  });
  assert.equal(notice.type, "notice");
  assert.equal(notice.notice_type, "group_recall");

  const request = normalizeOneBotEvent({
    post_type: "request",
    request_type: "friend",
    user_id: 4,
    flag: "flag-1",
    comment: "hello",
    time: 1700000003,
  });
  assert.equal(request.type, "request");
  assert.equal(request.request_type, "friend");
  assert.equal(request.actor.id, "4");
});
