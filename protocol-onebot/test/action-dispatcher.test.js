import http from "node:http";
import test from "node:test";
import assert from "node:assert/strict";
import { ActionDispatcher } from "../lib/action-dispatcher.js";
import { OneBotActionError } from "../lib/errors.js";
import { OneBotHttpClient } from "../lib/http-client.js";

test("action dispatcher falls back to HTTP when WS send fails", async (t) => {
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      assert.equal(req.url, "/send_group_msg");
      assert.equal(req.headers.authorization, "Bearer token");
      assert.ok(body.includes("100000001"));
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          status: "ok",
          retcode: 0,
          data: { message_id: 42 },
        }),
      );
    });
  });
  t.after(() => server.close());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  let wsCalls = 0;
  const dispatcher = new ActionDispatcher({
    wsClient: {
      connected: true,
      async send() {
        wsCalls += 1;
        throw new OneBotActionError("CONNECTION_LOST", "WebSocket failed");
      },
    },
    httpClient: new OneBotHttpClient({
      url: `http://127.0.0.1:${port}`,
      basePath: "/",
      accessToken: "token",
    }),
  });

  const result = await dispatcher.send("send_group_msg", {
    group_id: "100000001",
    message: "hi",
  });
  assert.equal(result.data.message_id, 42);
  assert.equal(wsCalls, 1);
});

test("action dispatcher reports the last transport error", async () => {
  const dispatcher = new ActionDispatcher({
    wsClient: {
      connected: true,
      async send() {
        throw new OneBotActionError("CONNECTION_LOST", "WebSocket failed");
      },
    },
    httpClient: {
      async send() {
        throw new OneBotActionError("CONNECTION_LOST", "HTTP failed");
      },
    },
  });

  await assert.rejects(
    dispatcher.send("send_group_msg", {}),
    /HTTP failed/,
  );
});

test("action dispatcher fails when no transport is available", async () => {
  const dispatcher = new ActionDispatcher({});
  await assert.rejects(
    dispatcher.send("send_group_msg", {}),
    /No OneBot transport available/,
  );
});
