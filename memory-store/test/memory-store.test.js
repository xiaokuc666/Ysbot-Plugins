import test from "node:test";
import assert from "node:assert/strict";
import { loadPluginHarness } from "../../test/plugin-harness.js";

const TRUSTED = {
  id: "ai-bot",
  origin: "system",
  admin: true,
  roles: ["admin"],
};

const ADMIN = {
  id: "management",
  origin: "management",
  admin: true,
  roles: ["admin"],
};

async function makeHarness(t) {
  const harness = await loadPluginHarness("memory-store");
  t.after(() => harness.cleanup());
  return harness;
}

test("memory-store observes and recalls entries", async (t) => {
  const harness = await makeHarness(t);
  await harness.invoke({
    action: "observe",
    params: {
      event: {
        group_id: "100000001",
        user_id: "200000001",
        message: [{ type: "text", data: { text: "我喜欢喝咖啡" } }],
        raw_message: "我喜欢喝咖啡",
      },
    },
    context: { actor: TRUSTED, traceId: "trace-1" },
  });

  const recalled = await harness.invoke({
    action: "recall",
    params: { groupId: "100000001", userId: "200000001", limit: 10 },
    context: { actor: TRUSTED, traceId: "trace-2" },
  });
  assert.equal(recalled.data.length, 1);
  assert.match(recalled.data[0].content, /咖啡/);
});

test("memory-store admin can list, note, forget and clear", async (t) => {
  const harness = await makeHarness(t);
  await harness.invoke({
    action: "note",
    params: { groupId: "100000001", content: "管理员笔记" },
    context: { actor: ADMIN, traceId: "trace-3" },
  });
  const listed = await harness.invoke({
    action: "list",
    params: { groupId: "100000001" },
    context: { actor: ADMIN, traceId: "trace-4" },
  });
  assert.equal(listed.data.total, 1);
  assert.equal(listed.data.entries[0].type, "note");

  const forgotten = await harness.invoke({
    action: "forget",
    params: { id: listed.data.entries[0].id },
    context: { actor: ADMIN, traceId: "trace-5" },
  });
  assert.equal(forgotten.data.removed, 1);
});

test("memory-store rejects non-admin list", async (t) => {
  const harness = await makeHarness(t);
  await assert.rejects(
    harness.invoke({
      action: "list",
      params: {},
      context: { actor: { id: "200000001", roles: ["member"] } },
    }),
    /requires admin/,
  );
});

test("memory-store rejects untrusted observe", async (t) => {
  const harness = await makeHarness(t);
  await assert.rejects(
    harness.invoke({
      action: "observe",
      params: { event: { message: [] } },
      context: { actor: { id: "200000001", roles: ["member"] } },
    }),
    /requires trusted caller/,
  );
});

test("memory-store registers admin routes", async (t) => {
  const harness = await makeHarness(t);
  const paths = harness.apiRouter.routes.map((route) => route.path);
  assert.ok(paths.includes("/api/plugins/memory-store/admin/memory"));
  assert.ok(paths.includes("/api/plugins/memory-store/admin/memory.json"));
  assert.ok(paths.includes("/api/plugins/memory-store/admin/memory/note"));
  assert.ok(paths.includes("/api/plugins/memory-store/admin/memory/delete"));
  assert.ok(paths.includes("/api/plugins/memory-store/admin/memory/clear"));
});
