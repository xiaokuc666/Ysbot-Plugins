import fs from "node:fs/promises";
import path from "node:path";
import { loadPluginConfig } from "./lib/config.js";
import { createPluginLogger } from "./lib/logger.js";
import { MemoryRepository } from "./lib/memory-store.js";

const ACTIONS = new Set([
  "observe",
  "recall",
  "note",
  "list",
  "forget",
  "clear",
  "summarize",
  "stats",
]);

function generateTraceId() {
  return `trace-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

export default class MemoryStorePlugin {
  async init(ctx) {
    this.ctx = ctx;
    this.disposed = false;
    this.config = await loadPluginConfig(ctx);
    this.log = await createPluginLogger(ctx);
    this.memory = new MemoryRepository({
      dataDir: ctx.dataDir,
      config: this.config,
      logger: this.log,
    });
    await this.memory.init();
    this.registerRoutes(ctx.api);
  }

  registerRoutes(api) {
    this.cleanupRoutes(api);
    const register = (method, routePath, handler) => {
      api[method.toLowerCase()](routePath, (helpers) =>
        handler.call(this, helpers),
      );
      const route = api.routes[api.routes.length - 1];
      if (route) route._memoryStore = true;
    };
    register(
      "GET",
      "/api/plugins/memory-store/admin/memory",
      this.handleMemoryPage,
    );
    register(
      "GET",
      "/api/plugins/memory-store/admin/memory.json",
      this.handleMemoryList,
    );
    register(
      "POST",
      "/api/plugins/memory-store/admin/memory/note",
      this.handleMemoryNote,
    );
    register(
      "POST",
      "/api/plugins/memory-store/admin/memory/delete",
      this.handleMemoryDelete,
    );
    register(
      "POST",
      "/api/plugins/memory-store/admin/memory/clear",
      this.handleMemoryClear,
    );
  }

  cleanupRoutes(api) {
    if (!api?.routes) return;
    api.routes = api.routes.filter((route) => {
      if (route._memoryStore) return false;
      return !String(route.path || "").startsWith(
        "/api/plugins/memory-store/admin/memory",
      );
    });
  }

  async handleMemoryPage({ sendHtml }) {
    if (this.disposed) {
      sendHtml(503, "<h1>memory-store is disabled</h1>");
      return;
    }
    sendHtml(200, await this.readPublic("memory-page.html"));
  }

  async handleMemoryList({ url, sendJson }) {
    if (this.disposed) {
      sendJson(503, { ok: false, error: "memory-store is disabled" });
      return;
    }
    const result = await this.memory.list({
      groupId: url.searchParams.get("groupId"),
      userId: url.searchParams.get("userId"),
      query: url.searchParams.get("query"),
      type: url.searchParams.get("type"),
      limit: url.searchParams.get("limit"),
      offset: url.searchParams.get("offset"),
    });
    sendJson(200, { ok: true, ...result });
  }

  async handleMemoryNote({ body, sendJson }) {
    if (this.disposed) {
      sendJson(503, { ok: false, error: "memory-store is disabled" });
      return;
    }
    const traceId = generateTraceId();
    const entry = await this.memory.note({
      groupId: body?.groupId,
      userId: body?.userId,
      content: body?.content,
      type: body?.type,
      actor: { id: "management", origin: "management" },
      traceId,
    });
    sendJson(200, { ok: true, entry, traceId });
  }

  async handleMemoryDelete({ body, sendJson }) {
    if (this.disposed) {
      sendJson(503, { ok: false, error: "memory-store is disabled" });
      return;
    }
    const result = await this.memory.forget({
      id: body?.id,
      groupId: body?.groupId,
      userId: body?.userId,
    });
    sendJson(200, { ok: true, ...result });
  }

  async handleMemoryClear({ body, sendJson }) {
    if (this.disposed) {
      sendJson(503, { ok: false, error: "memory-store is disabled" });
      return;
    }
    const result = await this.memory.clear({
      groupId: body?.groupId,
      userId: body?.userId,
    });
    sendJson(200, { ok: true, ...result });
  }

  async invoke(params = {}, callContext = {}) {
    if (this.disposed) {
      throw new Error("memory-store is disabled");
    }
    const context = { ...callContext, ...(params.context || {}) };
    const action = params.action;
    const requestParams = params.params || {};
    const traceId = context.traceId || params.traceId || generateTraceId();
    const actor = context.actor || null;

    if (!action || typeof action !== "string") {
      throw this.error(400, "action is required");
    }
    if (!ACTIONS.has(action)) {
      throw this.error(400, `Unsupported action: ${action}`);
    }
    this.assertPermission(action, actor, context);

    try {
      let data;
      switch (action) {
        case "observe":
          data = await this.memory.observe({
            event: requestParams.event,
            traceId,
          });
          break;
        case "recall":
          data = await this.memory.recall({
            groupId: requestParams.groupId,
            userId: requestParams.userId,
            query: requestParams.query,
            limit: requestParams.limit,
          });
          break;
        case "note":
          data = await this.memory.note({
            groupId: requestParams.groupId,
            userId: requestParams.userId,
            content: requestParams.content,
            type: requestParams.type,
            actor,
            traceId,
          });
          break;
        case "list":
          data = await this.memory.list({
            groupId: requestParams.groupId,
            userId: requestParams.userId,
            query: requestParams.query,
            type: requestParams.type,
            limit: requestParams.limit,
            offset: requestParams.offset,
          });
          break;
        case "forget":
          data = await this.memory.forget({
            id: requestParams.id,
            groupId: requestParams.groupId,
            userId: requestParams.userId,
          });
          break;
        case "clear":
          data = await this.memory.clear({
            groupId: requestParams.groupId,
            userId: requestParams.userId,
          });
          break;
        case "summarize":
          data = await this.memory.summarize({
            groupId: requestParams.groupId,
            userId: requestParams.userId,
            traceId,
          });
          break;
        case "stats":
          data = this.memory.stats();
          break;
      }
      this.log.info("memory", `${action} ok`, {
        traceId,
        groupId: requestParams.groupId || null,
        userId: requestParams.userId || null,
        action,
        count: Array.isArray(data?.entries)
          ? data.entries.length
          : Array.isArray(data)
            ? data.length
            : data ? 1 : 0,
      });
      return { ok: true, action, data, traceId };
    } catch (error) {
      this.log.warn("memory", `${action} failed: ${error.message}`, {
        traceId,
        groupId: requestParams.groupId || null,
        userId: requestParams.userId || null,
        action,
      });
      throw error;
    }
  }

  assertPermission(action, actor, context) {
    const isTrusted =
      context.trusted === true ||
      actor?.id === "ai-bot" ||
      (actor?.origin === "system" && actor?.admin === true);
    const isAdmin =
      actor?.admin === true ||
      actor?.origin === "management" ||
      context.approved === true;
    if (action === "observe" || action === "recall") {
      if (!isTrusted) {
        throw this.error(403, "observe/recall requires trusted caller");
      }
      return;
    }
    if (!isAdmin) {
      throw this.error(403, `${action} requires admin`);
    }
  }

  error(status, message) {
    const error = new Error(message);
    error.statusCode = status;
    return error;
  }

  async readPublic(name) {
    const file = path.join(this.ctx.pluginDir, "public", name);
    try {
      return await fs.readFile(file, "utf8");
    } catch {
      throw this.error(404, `Public page not found: ${name}`);
    }
  }

  async dispose() {
    this.disposed = true;
    this.cleanupRoutes(this.ctx?.api);
    await this.memory.rewrite();
    this.log.info("index", "disposed");
    await this.log.flush();
    await this.log.unregister();
  }
}
