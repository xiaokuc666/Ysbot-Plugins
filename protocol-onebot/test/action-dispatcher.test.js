import test from "node:test";
import assert from "node:assert/strict";
import { ActionDispatcher } from "../lib/action-dispatcher.js";
import { OneBotActionError } from "../lib/errors.js";

test("does not fall back to HTTP when WS returns explicit OneBot failure", async () => {
  const wsClient = {
    connected: true,
    send: async () => {
      throw new OneBotActionError("ONEBOT_FAILED", "kick member failed", {
        wording: "kick member failed",
      });
    },
  };
  let httpCalled = false;
  const httpClient = {
    send: async () => {
      httpCalled = true;
      return { status: "ok", data: {} };
    },
  };
  const dispatcher = new ActionDispatcher({ wsClient, httpClient });

  await assert.rejects(
    dispatcher.send("set_group_kick", {}),
    (error) => error.code === "ONEBOT_FAILED",
  );
  assert.equal(httpCalled, false);
});

test("falls back to HTTP when WS transport is unavailable", async () => {
  const httpClient = {
    send: async () => ({ status: "ok", data: { user_id: 1 } }),
  };
  const dispatcher = new ActionDispatcher({
    wsClient: null,
    httpClient,
  });

  assert.deepEqual(await dispatcher.send("get_login_info", {}), {
    status: "ok",
    data: { user_id: 1 },
  });
});
