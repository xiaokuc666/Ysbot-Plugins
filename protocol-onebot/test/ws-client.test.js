import test from "node:test";
import assert from "node:assert/strict";
import { OneBotWsClient } from "../lib/ws-client.js";

class FakeWebSocket {
  constructor(url, behavior = {}) {
    this.url = url;
    this.behavior = behavior;
    this.readyState = 0;
    this.sent = [];
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.({});
      if (this.behavior.event) {
        this.onmessage?.({ data: JSON.stringify(this.behavior.event) });
      }
    }, 0);
  }

  send(raw) {
    const request = JSON.parse(raw);
    this.sent.push(request);
    setTimeout(() => {
      this.behavior.onRequest?.(request, this);
    }, 0);
  }

  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}

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

test("ws client receives events and resolves echo actions", async () => {
  const received = [];
  const statuses = [];
  const fake = new FakeWebSocket("ws://fake", {
    event: {
      post_type: "message",
      message_type: "group",
      message_id: 1,
      group_id: 1,
      user_id: 2,
      sender: { user_id: 2, nickname: "a" },
      message: [],
      time: 1700000000,
    },
    onRequest(request, socket) {
      socket.onmessage?.({
        data: JSON.stringify({
          status: "ok",
          retcode: 0,
          data: { message_id: 9 },
          echo: request.echo,
        }),
      });
    },
  });

  const client = new OneBotWsClient({
    url: "ws://fake",
    onEvent: (event) => received.push(event),
    onStatus: (status) => statuses.push(status),
    WebSocketImpl: class extends FakeWebSocket {
      constructor(url) {
        super(url, fake.behavior);
      }
    },
  });
  client.connect();

  await waitFor(() => statuses.some((status) => status.connected === true));
  await waitFor(() => received.length === 1);
  const result = await client.send("send_group_msg", {
    group_id: 1,
    message: "hi",
  });
  assert.equal(result.status, "ok");
  assert.equal(received[0].message_type, "group");
  client.close();
});
