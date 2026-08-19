import test from "node:test";
import assert from "node:assert/strict";
import { ReconnectManager } from "../lib/reconnect.js";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("reconnect manager retries and stops", async () => {
  let calls = 0;
  const manager = new ReconnectManager({
    baseMs: 2,
    maxMs: 8,
    onReconnect: async () => {
      calls += 1;
    },
  });
  manager.start();
  await delay(40);
  assert.ok(calls > 0);
  manager.stop();
  const stopped = calls;
  await delay(20);
  assert.equal(calls, stopped);
});
