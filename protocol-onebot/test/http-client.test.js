import http from "node:http";
import test from "node:test";
import assert from "node:assert/strict";
import { OneBotHttpClient } from "../lib/http-client.js";

test("http client sends actions and parses OneBot response", async (t) => {
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      assert.equal(req.url, "/send_group_msg");
      assert.equal(req.headers.authorization, "Bearer token");
      assert.ok(body.includes("group_id"));
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ status: "ok", retcode: 0, data: { message_id: 1 } }));
    });
  });
  t.after(() => server.close());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  const client = new OneBotHttpClient({
    url: `http://127.0.0.1:${port}`,
    basePath: "/",
    accessToken: "token",
  });
  const result = await client.send("send_group_msg", {
    group_id: "1",
    message: "hi",
  });
  assert.equal(result.status, "ok");
  assert.equal(result.data.message_id, 1);
});
