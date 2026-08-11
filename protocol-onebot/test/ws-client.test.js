import test from "node:test";
import assert from "node:assert/strict";
import { WebSocketServer } from "ws";
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

test("ws client receives events and resolves echo actions", async (t) => {
  const server = new WebSocketServer({ port: 0 });
  t.after(() => server.close());
  await new Promise((resolve) => server.once("listening", resolve));
  const port = server.address().port;
  const received = [];
  const statuses = [];

  server.on("connection", (socket) => {
    socket.send(
      JSON.stringify({
        post_type: "message",
        message_type: "group",
        message_id: 1,
        group_id: 1,
        user_id: 2,
        sender: { user_id: 2, nickname: "a" },
        message: [],
        time: 1700000000,
      }),
    );
    socket.on("message", (raw) => {
      const request = JSON.parse(raw.toString());
      socket.send(
        JSON.stringify({
          status: "ok",
          retcode: 0,
          data: { message_id: 9 },
          echo: request.echo,
        }),
      );
    });
  });

  const client = new OneBotWsClient({
    url: `ws://127.0.0.1:${port}`,
    onEvent: (event) => received.push(event),
    onStatus: (status) => statuses.push(status),
  });
  client.connect();

  await waitFor(() => statuses.some((status) => status.connected === true));
  await waitFor(() => received.length === 1);
  const result = await client.send("send_group_msg", { group_id: 1, message: "hi" });
  assert.equal(result.status, "ok");
  assert.equal(received[0].message_type, "group");
  client.close();
});
