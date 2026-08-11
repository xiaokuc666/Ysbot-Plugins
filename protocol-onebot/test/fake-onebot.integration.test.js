import http from "node:http";
import test from "node:test";
import assert from "node:assert/strict";
import { WebSocketServer } from "ws";
import { ActionDispatcher } from "../lib/action-dispatcher.js";
import { OneBotHttpClient } from "../lib/http-client.js";
import { OneBotWsClient } from "../lib/ws-client.js";

function waitFor(predicate, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - started > timeout) {
        clearInterval(timer);
        reject(new Error("waitFor timeout"));
      }
    }, 10);
  });
}

test("dispatcher falls back to HTTP when WS action fails", async (t) => {
  const wss = new WebSocketServer({ port: 0 });
  const httpServer = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ status: "ok", retcode: 0, data: { message_id: 2 } }));
  });
  t.after(() => {
    wss.close();
    httpServer.close();
  });
  await new Promise((resolve) => wss.once("listening", resolve));
  await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));

  wss.on("connection", (socket) => {
    socket.on("message", (raw) => {
      const request = JSON.parse(raw.toString());
      socket.send(
        JSON.stringify({
          status: "failed",
          retcode: 100,
          wording: "ws failed",
          echo: request.echo,
        }),
      );
    });
  });

  const wsClient = new OneBotWsClient({
    url: `ws://127.0.0.1:${wss.address().port}`,
  });
  const httpClient = new OneBotHttpClient({
    url: `http://127.0.0.1:${httpServer.address().port}`,
  });
  wsClient.connect();
  await waitFor(() => wsClient.connected);

  const dispatcher = new ActionDispatcher({ wsClient, httpClient });
  const result = await dispatcher.send("send_group_msg", {
    group_id: "1",
    message: "hello",
  });
  assert.equal(result.status, "ok");
  wsClient.close();
});
