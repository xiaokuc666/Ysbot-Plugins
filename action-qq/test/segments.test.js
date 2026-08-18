import test from "node:test";
import assert from "node:assert/strict";
import { assertMessageLength, normalizeMessage } from "../lib/segments.js";

test("segments normalize string messages", () => {
  assert.deepEqual(normalizeMessage("hello"), [
    { type: "text", data: { text: "hello" } },
  ]);
});

test("segments accept standard OneBot message arrays", () => {
  const message = [
    { type: "text", data: { text: "hi" } },
    { type: "at", data: { qq: "200000001" } },
    { type: "reply", data: { id: "123" } },
    { type: "image", data: { file: "https://example.com/a.png" } },
  ];
  assert.deepEqual(normalizeMessage(message), message);
});

test("segments reject malformed messages", () => {
  assert.throws(() => normalizeMessage({}), /message must be/);
  assert.throws(() => normalizeMessage([]), /must not be empty/);
  assert.throws(
    () => normalizeMessage([{ type: "text" }]),
    /text segment requires data.text/,
  );
  assert.throws(
    () => normalizeMessage([{ type: "at", data: {} }]),
    /at segment requires data.qq/,
  );
  assert.throws(
    () => normalizeMessage([{ type: "reply", data: {} }]),
    /reply segment requires data.id/,
  );
  assert.throws(
    () => normalizeMessage([{ type: "image", data: {} }]),
    /image segment requires data.file/,
  );
});

test("segments enforce max text length", () => {
  assert.throws(
    () => assertMessageLength([{ type: "text", data: { text: "x".repeat(11) } }], 10),
    /exceeds limit 10/,
  );
  assert.doesNotThrow(() =>
    assertMessageLength([{ type: "text", data: { text: "x".repeat(10) } }], 10),
  );
});
