import fs from "node:fs/promises";
import path from "node:path";
import { loadPluginConfig } from "./lib/config.js";
import { IdentityRepository } from "./lib/identity-store.js";
import { createPluginLogger } from "./lib/logger.js";

const ACTIONS = new Set([
  "context",
  "journal",
  "get_card",
  "get_self",
  "update_card",
  "reflect",
  "reset",
  "rollback",
  "stats",
]);

function generateTraceId() {
  return `trace-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

export default class IdentityStorePlugin {
  async init(ctx) {
    this.ctx = ctx;
    this.disposed = false;
    this.config = await loadPluginConfig(ctx);
    this.log = await createPluginLogger(ctx);
    this.store = new IdentityRepository({
      dataDir: ctx.dataDir,
      config: this.config,
      logger: this.log,
    });
    await this.store.init();
    this.registerRoutes(ctx.api);
    this.startAutoReflect();
  }

  registerRoutes(api) {
    this.cleanupRoutes(api);
    const register = (method, routePath, handler) => {
      api[method.toLowerCase()](routePath, (helpers) =>
        handler.call(this, helpers),
      );
      const route = api.routes[api.routes.length - 1];
      if (route) route._identityStore = true;
    };
    register(
      "GET",
      "/api/plugins/identity-store/admin/identity",
      this.handleIdentityPage,
    );
    register(
      "GET",
      "/api/plugins/identity-store/admin/identity.json",
      this.handleIdentityJson,
    );
    register(
      "POST",
      "/api/plugins/identity-store/admin/card",
      this.handleUpdateCard,
    );
    register(
      "POST",
      "/api/plugins/identity-store/admin/reflect",
      this.handleReflect,
    );
    register(
      "POST",
      "/api/plugins/identity-store/admin/reset",
      this.handleReset,
    );
    register(
      "POST",
      "/api/plugins/identity-store/admin/rollback",
      this.handleRollback,
    );
  }

  cleanupRoutes(api) {
    if (!api?.routes) return;
    api.routes = api.routes.filter((route) => {
      if (route._identityStore) return false;
      return !String(route.path || "").startsWith(
        "/api/plugins/identity-store/admin/identity",
      );
    });
  }

  async handleIdentityPage({ sendHtml }) {
    if (this.disposed) {
      sendHtml(503, "<h1>identity-store is disabled</h1>");
      return;
    }
    sendHtml(200, await this.readPublic("identity-page.html"));
  }

  async handleIdentityJson({ sendJson }) {
    if (this.disposed) {
      sendJson(503, { ok: false, error: "identity-store is disabled" });
      return;
    }
    const [card, self, stats] = await Promise.all([
      this.store.getCard(),
      this.store.getSelf(),
      this.store.stats(),
    ]);
    sendJson(200, { ok: true, card, self, stats });
  }

  async handleUpdateCard({ body, sendJson }) {
    if (this.disposed) {
      sendJson(503, { ok: false, error: "identity-store is disabled" });
      return;
    }
    const traceId = generateTraceId();
    const card = await this.store.updateCard(
      body?.patch || body || {},
      { id: "management", origin: "management", admin: true },
      traceId,
    );
    this.log.info("identity", "card updated", { traceId });
    sendJson(200, { ok: true, card, traceId });
  }

  async handleReflect({ body, sendJson }) {
    if (this.disposed) {
      sendJson(503, { ok: false, error: "identity-store is disabled" });
      return;
    }
    const traceId = generateTraceId();
    const result = await this.store.reflect({
      groupId: body?.groupId || null,
      config: this.config,
      traceId,
    });
    this.log.info("identity", "reflect ok", {
      traceId,
      reflected: result.reflected,
      journalCount: result.journalCount,
    });
    sendJson(200, { ok: true, ...result });
  }

  async handleReset({ sendJson }) {
    if (this.disposed) {
      sendJson(503, { ok: false, error: "identity-store is disabled" });
      return;
    }
    const traceId = generateTraceId();
    const result = await this.store.reset();
    this.log.info("identity", "reset ok", { traceId });
    sendJson(200, { ok: true, ...result, traceId });
  }

  async handleRollback({ sendJson }) {
    if (this.disposed) {
      sendJson(503, { ok: false, error: "identity-store is disabled" });
      return;
    }
    const traceId = generateTraceId();
    const snapshot = await this.store.rollback();
    this.log.info("identity", "rollback ok", {
      traceId,
      snapshotVersion: snapshot.version,
    });
    sendJson(200, { ok: true, snapshot, traceId });
  }

  async invoke(params = {}, callContext = {}) {
    if (this.disposed) {
      throw this.error(503, "identity-store is disabled");
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
        case "context":
          data = await this.buildContext({
            groupId: requestParams.groupId,
            userId: requestParams.userId,
            query: requestParams.query,
            mode: requestParams.mode,
            context,
            traceId,
          });
          break;
        case "journal":
          data = await this.store.appendJournal({
            traceId,
            scene: requestParams.scene || context.scene || null,
            userId: requestParams.userId || context.actor?.id || null,
            role: requestParams.role || context.actor?.roles?.[0] || null,
            type: requestParams.type || "message",
            summary: requestParams.summary || "",
            tags: requestParams.tags || [],
          });
          break;
        case "get_card":
          data = await this.store.getCard();
          break;
        case "get_self":
          data = await this.store.getSelf();
          break;
        case "update_card":
          data = await this.store.updateCard(
            requestParams.patch || requestParams,
            actor,
            traceId,
          );
          break;
        case "reflect":
          data = await this.store.reflect({
            groupId: requestParams.groupId || null,
            config: this.config,
            traceId,
          });
          break;
        case "reset":
          data = await this.store.reset();
          break;
        case "rollback":
          {
            const snapshot = await this.store.rollback();
            data = { snapshotVersion: snapshot.version, snapshot };
          }
          break;
        case "stats":
          data = await this.store.stats();
          break;
      }
      this.log.info("identity", `${action} ok`, {
        traceId,
        action,
        groupId: requestParams.groupId || null,
      });
      return { ok: true, action, data, traceId };
    } catch (error) {
      this.log.warn("identity", `${action} failed: ${error.message}`, {
        traceId,
        action,
      });
      throw error;
    }
  }

  async buildContext({ groupId, userId, query, mode, context, traceId }) {
    const [card, self] = await Promise.all([
      this.store.getCard(),
      this.store.getSelf(),
    ]);
    let memory = null;
    if (this.hasPlugin("memory-store")) {
      try {
        const result = await this.ctx.registry.invoke("memory-store", {
          action: "recall",
          params: {
            groupId,
            userId,
            query,
            limit: 10,
          },
          context: {
            actor: this.trustedActor(),
            scene: context.scene || {
              type: groupId ? "group" : "private",
              id: groupId || userId || "",
            },
            traceId,
          },
        });
        const data = result?.data;
        memory = Array.isArray(data)
          ? data
          : Array.isArray(data?.entries)
            ? data.entries
            : null;
      } catch (error) {
        this.log.warn("identity", `memory recall failed: ${error.message}`, {
          traceId,
        });
      }
    }
    const built = this.store.buildContext({
      card,
      self,
      memory,
      query,
      mode,
      config: this.config,
    });
    this.log.info("identity", "context retrieved", {
      traceId,
      groupId: groupId || null,
      userId: userId || null,
      sourceIds: built.sourceIds,
      score: built.score,
    });
    return {
      identityContext: built.identityContext,
      sourceIds: built.sourceIds,
      score: built.score,
      traceId,
    };
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
    if (action === "context" || action === "journal") {
      if (!isTrusted) {
        throw this.error(403, "context/journal requires trusted caller");
      }
      return;
    }
    if (!isAdmin) {
      throw this.error(403, `${action} requires admin`);
    }
  }

  hasPlugin(id) {
    const plugin = this.ctx.registry.get(id);
    return Boolean(plugin && plugin.enabled !== false && plugin.status === "ready");
  }

  trustedActor() {
    return {
      origin: "system",
      id: "identity-store",
      admin: true,
      roles: ["admin"],
    };
  }

  startAutoReflect() {
    if (!this.config.consolidationEnabled || this.disposed) return;
    const interval = Math.max(
      60000,
      Number(this.config.consolidationIntervalMs) || 3600000,
    );
    this.reflectTimer = setInterval(async () => {
      try {
        const stats = await this.store.stats();
        if (stats.journalCount >= (this.config.minJournalEntries || 20)) {
          await this.store.reflect({
            config: this.config,
            traceId: generateTraceId(),
          });
        }
      } catch (error) {
        this.log.warn("identity", `auto reflect failed: ${error.message}`);
      }
    }, interval);
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
    if (this.reflectTimer) {
      clearInterval(this.reflectTimer);
      this.reflectTimer = null;
    }
    this.cleanupRoutes(this.ctx?.api);
    this.log.info("index", "disposed");
    await this.log.flush();
    await this.log.unregister();
  }
}
