import fs from "node:fs/promises";
import path from "node:path";
import { ActionDispatcher } from "./lib/action-dispatcher.js";
import { assertActionAllowed } from "./lib/action-policy.js";
import { loadPluginConfig } from "./lib/config.js";
import { normalizeOneBotEvent } from "./lib/event-normalizer.js";
import { OneBotActionError } from "./lib/errors.js";
import { OneBotHttpClient } from "./lib/http-client.js";
import { createPluginLogger } from "./lib/plugin-logger.js";
import { ReconnectManager } from "./lib/reconnect.js";
import { StatusStore } from "./lib/status.js";
import { OneBotWsClient } from "./lib/ws-client.js";

export default class ProtocolOnebotPlugin {
  async init(ctx) {
    this.ctx = ctx;
    this.config = await loadPluginConfig(ctx);
    this.log = createPluginLogger(ctx);
    this.statusStore = new StatusStore();
    this.disposed = false;
    this.manualReconnect = false;
    this.client = null;
    this.reconnectManager = new ReconnectManager({
      baseMs: this.config.reconnectBaseMs,
      maxMs: this.config.reconnectMaxMs,
      onReconnect: () => {
        this.statusStore.update({
          reconnects: this.statusStore.snapshot().reconnects + 1,
        });
        return this.reconnectOnce();
      },
    });
    this.httpClient = new OneBotHttpClient({
      url: this.config.httpUrl,
      basePath: this.config.httpBasePath,
      accessToken: this.config.accessToken,
      requestTimeoutMs: this.config.requestTimeoutMs,
    });
    this.dispatcher = new ActionDispatcher({
      wsClient: null,
      httpClient: this.httpClient,
    });
    ctx.protocol.setAdapter(this);
    this.registerRoutes(ctx.api);
    if (this.config.autoConnect) {
      await this.connect();
    }
  }

  assertActive() {
    if (this.disposed) {
      const error = new Error("protocol-onebot is disabled");
      error.statusCode = 503;
      throw error;
    }
  }

  handleOneBotEvent(event) {
    const normalized = normalizeOneBotEvent(event);
    if (normalized.type === "message") {
      this.ctx.protocol.emit(normalized);
      this.ctx.eventBus.emit("onebot.message", normalized);
      return;
    }
    if (normalized.type === "notice") {
      this.ctx.eventBus.emit("onebot.notice", normalized);
      return;
    }
    if (normalized.type === "request") {
      this.ctx.eventBus.emit("onebot.request", normalized);
      return;
    }
    this.ctx.eventBus.emit("onebot.meta", normalized);
  }

  registerRoutes(api) {
    this.cleanupRoutes(api);
    api.get("/api/plugins/protocol-onebot/admin/status", async ({ sendHtml }) => {
      if (this.disposed) {
        sendHtml(
          200,
          '<!doctype html><html><body style="font-family:sans-serif;padding:24px"><h1>插件已禁用</h1><p>protocol-onebot is disabled</p></body></html>',
        );
        return;
      }
      sendHtml(200, await this.readPublic("status-page.html"));
    });
    api.get(
      "/api/plugins/protocol-onebot/admin/status.json",
      async ({ sendJson }) => {
        this.assertActive();
        sendJson(200, { ok: true, status: this.statusStore.snapshot() });
      },
    );
    api.post(
      "/api/plugins/protocol-onebot/admin/reconnect",
      async ({ sendJson }) => {
        this.assertActive();
        await this.reconnectNow();
        sendJson(200, { ok: true, status: this.statusStore.snapshot() });
      },
    );
    this.markOwnRoutes(api);
  }

  cleanupRoutes(api) {
    if (!api?.routes) return;
    api.routes = api.routes.filter((route) => {
      if (route._protocolOnebot) return false;
      return !String(route.path || "").startsWith(
        "/api/plugins/protocol-onebot/admin/",
      );
    });
  }

  markOwnRoutes(api) {
    for (const route of api.routes || []) {
      if (
        String(route.path || "").startsWith(
          "/api/plugins/protocol-onebot/admin/",
        )
      ) {
        route._protocolOnebot = true;
      }
    }
  }

  async readPublic(name) {
    const file = path.join(this.ctx.pluginDir, "public", name);
    try {
      return await fs.readFile(file, "utf8");
    } catch {
      return "<h1>Status page not found</h1>";
    }
  }

  async connect(force = false) {
    if (this.disposed) return { ok: false, error: "disposed" };
    if (!force && !this.config.autoConnect) {
      this.log.info("index", "skip connect: autoConnect=false");
      return { ok: true, skipped: true };
    }
    if (this.client && !force) {
      return { ok: true, already: true };
    }
    if (this.client) {
      this.client.close();
      this.client = null;
    }
    this.client = new OneBotWsClient({
      url: this.config.wsUrl,
      accessToken: this.config.accessToken,
      requestTimeoutMs: this.config.requestTimeoutMs,
      heartbeatTimeoutMs: this.config.heartbeatTimeoutMs,
      onEvent: (event) => this.handleOneBotEvent(event),
      onStatus: (patch) => {
        if (patch.connected) {
          this.ctx.protocol.setConnected(true);
          this.log.info("ws-client", `connected ${this.config.wsUrl}`);
          this.reconnectManager.reset();
          this.statusStore.update({ ...patch, lastError: null });
        } else {
          this.ctx.protocol.setConnected(false);
          this.log.warn("ws-client", `disconnected ${this.config.wsUrl}`);
          this.statusStore.update(patch);
        }
      },
      onClose: () => this.handleDisconnect(),
      onError: (error) => {
        this.log.warn("ws-client", `error: ${error.message}`);
        this.statusStore.update({ lastError: error.message });
      },
    });
    this.log.info("ws-client", `connecting ${this.config.wsUrl}`);
    this.statusStore.update({
      connected: false,
      wsUrl: this.config.wsUrl,
      httpUrl: this.config.httpUrl,
      lastError: null,
    });
    this.client.connect();
    this.dispatcher.wsClient = this.client;
    return { ok: true };
  }

  async connectNow() {
    return this.connect(true);
  }

  handleDisconnect() {
    if (this.disposed || this.manualReconnect || !this.config.autoConnect) return;
    this.reconnectManager.start();
  }

  async reconnectOnce() {
    if (this.disposed) return { ok: false, error: "disposed" };
    this.log.info("index", "reconnect once");
    this.manualReconnect = true;
    this.disconnect();
    this.manualReconnect = false;
    if (this.disposed) return { ok: false, error: "disposed" };
    this.disposed = false;
    this.config = await loadPluginConfig(this.ctx);
    if (this.disposed) return { ok: false, error: "disposed" };
    this.httpClient.url = this.config.httpUrl;
    this.httpClient.basePath = this.config.httpBasePath;
    this.httpClient.accessToken = this.config.accessToken;
    await this.connectNow();
  }

  async reconnectNow() {
    this.reconnectManager.stop();
    this.reconnectManager.reset();
    await this.reconnectOnce();
    return { ok: true };
  }

  disconnect() {
    this.client?.close();
    this.client = null;
    if (this.dispatcher) this.dispatcher.wsClient = null;
    this.ctx.protocol.setConnected(false);
    this.statusStore.update({ connected: false });
  }

  async invoke(params = {}, callContext = {}) {
    const context = { ...callContext, ...(params.context || {}) };
    return this.send(params.action, params.params || {}, context);
  }

  async send(action, params = {}, context = {}) {
    if (this.disposed) {
      throw new OneBotActionError("CONNECTION_LOST", "Plugin disposed");
    }
    if (!action || typeof action !== "string") {
      throw new OneBotActionError("INVALID_CONTEXT", "action is required");
    }
    assertActionAllowed(action, context, this.config);
    if (this.ctx.permissions && context?.actor && context?.scene) {
      await this.ctx.permissions.assert("protocol-onebot", {
        actor: context.actor,
        scene: context.scene,
        resource: { action },
      });
    }
    try {
      const result = await this.dispatcher.send(action, params);
      this.statusStore.update({
        actionsSent: this.statusStore.snapshot().actionsSent + 1,
      });
      return result;
    } catch (error) {
      this.statusStore.update({
        actionsFailed: this.statusStore.snapshot().actionsFailed + 1,
      });
      throw error;
    }
  }

  status() {
    return this.statusStore.snapshot();
  }

  async dispose() {
    this.disposed = true;
    this.reconnectManager.stop();
    this.disconnect();
    this.cleanupRoutes(this.ctx.api);
    this.log.info("index", "disposed");
    await this.log.unregister();
    this.statusStore.update({ connected: false, lastError: "disposed" });
    this.ctx.protocol.setAdapter(null);
  }
}
