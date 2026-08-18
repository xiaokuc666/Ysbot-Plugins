import fs from "node:fs/promises";
import path from "node:path";
import {
  collectAdminMetadata,
} from "./lib/admin-metadata.js";
import {
  getConfigSnapshot,
  resetConfig,
  saveConfig,
  validateConfig,
} from "./lib/config.js";
import { getLogs, clearLogs, logFilePath } from "./lib/logs.js";
import { httpError } from "./lib/plg.js";
import {
  installPlg,
  reconcilePlgFiles,
  uninstallPlugin,
  updatePlugin,
} from "./lib/plugin-ops.js";
import { createStateStore } from "./lib/state.js";
import {
  loadTheme,
  saveTheme,
  themeCss,
  THEME_PRESETS,
} from "./lib/theme.js";

export default class AdminConsolePlugin {
  async init(ctx) {
    this.ctx = ctx;
    this.disposed = false;
    await fs.mkdir(ctx.dataDir, { recursive: true });
    this.state = await createStateStore(ctx.dataDir);
    this.adminMetadata = new Map();
    this.locks = new Set();
    this.reconcilePending = true;
    this.reconcileRunning = false;
    this.reconcilePromise = null;
    await this.refreshAdminMetadata();
    this.reconcileTimer = setTimeout(() => {
      this.runReconcile().catch(() => {});
    }, 0);
    this.setupRouter(ctx.api);
    const host = ctx.config?.managementHost || "127.0.0.1";
    const port = ctx.config?.managementPort || 5178;
    ctx.logger?.info(
      `[AdminConsole] Admin Console: http://${host}:${port}/api/admin-console/ui`,
    );
  }

  async dispose() {
    this.disposed = true;
    if (this.reconcileTimer) {
      clearTimeout(this.reconcileTimer);
      this.reconcileTimer = null;
    }
    if (this.reconcilePromise) {
      await this.reconcilePromise.catch(() => {});
    }
    if (this.ctx?.api?.routes) {
      this.ctx.api.routes = this.ctx.api.routes.filter(
        (route) => route._adminConsole !== true,
      );
    }
    this.adminMetadata.clear();
  }

  async refreshAdminMetadata() {
    if (this.disposed) return this.adminMetadata;
    this.adminMetadata = await collectAdminMetadata(
      this.ctx,
      async (pluginId, error) => {
        if (error) await this.state.recordError(pluginId, error);
      },
    );
  }

  async reconcilePlgFiles() {
    await reconcilePlgFiles(this.ctx);
  }

  async runReconcile() {
    if (this.disposed) return null;
    if (this.reconcileRunning) return this.reconcilePromise;
    this.reconcileRunning = true;
    this.reconcilePromise = (async () => {
      try {
        await this.reconcilePlgFiles();
        await this.refreshAdminMetadata();
        await this.applyEnabledOverrides();
        this.reconcilePending = false;
      } catch (error) {
        await this.state.recordError("admin-console", error);
      } finally {
        this.reconcileRunning = false;
        this.reconcilePromise = null;
      }
    })();
    return this.reconcilePromise;
  }

  async runReconcileIfNeeded() {
    if (this.disposed) return;
    await this.refreshAdminMetadata();
    await this.applyEnabledOverrides();
    if (this.reconcilePending) await this.runReconcile();
  }

  async applyEnabledOverrides() {
    if (this.disposed) return;
    const overrides = this.state.getEnabledOverrides();
    for (const [id, enabled] of Object.entries(overrides)) {
      const plugin = this.ctx.registry.get(id);
      if (!plugin) continue;
      if (enabled === false && plugin.enabled !== false) {
        await plugin.dispose?.().catch(() => {});
        this.ctx.registry.setEnabled(id, false);
      } else if (enabled === true && plugin.enabled === false) {
        try {
          await this.ctx.pluginManager.reloadPlugin(id);
          this.ctx.registry.setEnabled(id, true);
          await this.state.clearEnabledOverride(id);
        } catch (error) {
          await this.state.recordError(id, error);
        }
      }
    }
  }

  assertNotAdminConsole(id) {
    if (id === "admin-console") {
      throw httpError(400, "admin-console is protected from self management");
    }
  }

  assertPluginEnabled(id) {
    const plugin = this.ctx.registry.get(id);
    if (!plugin) throw httpError(404, `Plugin not found: ${id}`);
    if (plugin.enabled === false) {
      throw httpError(409, `Plugin disabled: ${id}`);
    }
  }

  getDependentPlugins(id) {
    return this.ctx.registry.list().filter((plugin) => {
      if (plugin.enabled === false) return false;
      const wrapper = this.ctx.registry.get(plugin.id);
      return (wrapper?.manifest?.dependencies || []).includes(id);
    });
  }

  assertNoDependents(id, operation) {
    const dependents = this.getDependentPlugins(id);
    if (dependents.length) {
      throw httpError(
        409,
        `${operation} blocked because plugins depend on ${id}: ${dependents
          .map((plugin) => plugin.id)
          .join(", ")}`,
      );
    }
  }

  async withLock(key, operation) {
    if (this.locks.has(key)) {
      throw httpError(409, `Operation already in progress for ${key}`);
    }
    this.locks.add(key);
    try {
      return await operation();
    } finally {
      this.locks.delete(key);
    }
  }

  setupRouter(api) {
    if (api.routes) {
      api.routes = api.routes.filter((route) => route._adminConsole !== true);
    }
    if (!api.put) {
      api.put = (path, handler) => {
        api.routes.push({ method: "PUT", path, handler });
      };
    }

    const register = (method, path, handler) => {
      api[method.toLowerCase()](path, (helpers) =>
        handler.call(this, helpers),
      );
      const route = api.routes[api.routes.length - 1];
      if (route) route._adminConsole = true;
    };

    register("GET", "/api/plugins", this.handlePlugins);
    register("GET", "/api/plugins/detail", this.handlePluginDetail);
    register("POST", "/api/plugins/toggle", this.handleToggle);
    register("POST", "/api/plugins/reload", this.handleReload);
    register("POST", "/api/plugins/clear-data", this.handleClearData);
    register("POST", "/api/plugins/install", this.handleInstall);
    register("POST", "/api/plugins/uninstall", this.handleUninstall);
    register("POST", "/api/plugins/update", this.handleUpdate);
    register("GET", "/api/status", this.handleStatus);
    register("GET", "/api/logs", this.handleLogs);
    register("POST", "/api/logs/clear", this.handleClearLogs);
    register("GET", "/api/admin-console/ui", this.handleUi);
    register("GET", "/api/admin-console/app.js", this.handleAppJs);
    register("GET", "/api/admin-console/style.css", this.handleStyleCss);
    register("GET", "/api/admin-console/design-tokens.css", this.handleDesignTokensCss);
    register("GET", "/api/admin-console/theme", this.handleTheme);
    register("PUT", "/api/admin-console/theme", this.handleThemeSave);
    register("GET", "/api/admin-console/config", this.handleConfigList);
    register("GET", "/api/admin-console/config/detail", this.handleConfigDetail);
    register("PUT", "/api/admin-console/config/save", this.handleConfigSave);
    register("POST", "/api/admin-console/config/validate", this.handleConfigValidate);
    register("POST", "/api/admin-console/config/reset", this.handleConfigReset);
    register("GET", "/api/admin-console/pages", this.handlePages);
    register("GET", "/api/admin-console/pages/meta", this.handlePageMeta);
  }

  requireLocal(req) {
    const remote = String(req.socket?.remoteAddress || "");
    const allowed = new Set([
      "127.0.0.1",
      "::1",
      "::ffff:127.0.0.1",
    ]);
    if (!allowed.has(remote)) {
      throw httpError(403, "Local access only");
    }
  }

  async readPublic(name) {
    const file = path.join(this.ctx.pluginDir, "public", name);
    try {
      return await fs.readFile(file, "utf8");
    } catch {
      throw httpError(404, `Public asset not found: ${name}`);
    }
  }

  sendText(res, status, body, contentType) {
    res.writeHead(status, {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
    });
    res.end(body);
  }

  async handlePlugins({ req, sendJson }) {
    this.requireLocal(req);
    await this.runReconcileIfNeeded();
    const plugins = this.ctx.registry.list().map((item) => {
      const wrapper = this.ctx.registry.get(item.id);
      const manifest = wrapper?.manifest || {};
      const enabled = item.enabled !== false;
      return {
        ...item,
        description: manifest.description || "",
        dependencies: manifest.dependencies || [],
        protected: item.id === "admin-console",
        hasConfig: enabled && Boolean(this.adminMetadata.get(item.id)?.config),
        pages: enabled ? this.adminMetadata.get(item.id)?.pages || [] : [],
      };
    });
    sendJson(200, { ok: true, plugins });
  }

  async handlePluginDetail({ req, url, sendJson }) {
    this.requireLocal(req);
    const id = url.searchParams.get("id");
    if (!id) throw httpError(400, "id is required");
    const wrapper = this.ctx.registry.get(id);
    if (!wrapper) throw httpError(404, `Plugin not found: ${id}`);
    sendJson(200, {
      ok: true,
      plugin: {
        id: wrapper.id,
        type: wrapper.type,
        name: wrapper.name,
        version: wrapper.version,
        enabled: wrapper.enabled !== false,
        status: wrapper.status,
        sourceType: wrapper.sourceType || "directory",
        dataDir: wrapper.dataDir || null,
        cacheDir: wrapper.cacheDir || null,
        packageHash: wrapper.packageHash || null,
        role: wrapper.manifest?.role || null,
        dependencies: wrapper.manifest?.dependencies || [],
        protected: id === "admin-console",
        adminMetadata: this.adminMetadata.get(id) || null,
        manifest: wrapper.manifest || {},
        errors: this.state.getErrors(id),
      },
    });
  }

  async managed(id, operation) {
    try {
      const result = (await operation()) || {};
      await this.state.clearError(id);
      return { ok: true, id, ...result };
    } catch (error) {
      await this.state.recordError(id, error);
      throw error;
    }
  }

  async handleToggle({ req, url, sendJson }) {
    this.requireLocal(req);
    const id = url.searchParams.get("id");
    if (!id) throw httpError(400, "id is required");
    this.assertNotAdminConsole(id);
    const plugin = this.ctx.registry.get(id);
    if (!plugin) throw httpError(404, `Plugin not found: ${id}`);
    const enabled = plugin.enabled === false;
    const result = await this.withLock(id, async () => {
      if (enabled) {
        await this.ctx.pluginManager.reloadPlugin(id);
        this.ctx.registry.setEnabled(id, true);
        await this.state.clearEnabledOverride(id);
      } else {
        this.assertNoDependents(id, "Disable");
        await plugin.dispose?.().catch(() => {});
        this.ctx.registry.setEnabled(id, false);
        await this.state.setEnabledOverride(id, false);
      }
      await this.state.clearError(id);
      return { ok: true, id, enabled };
    });
    await this.state.clearError(id);
    sendJson(200, result);
  }

  async handleReload({ req, url, sendJson }) {
    this.requireLocal(req);
    const id = url.searchParams.get("id");
    if (!id) throw httpError(400, "id is required");
    this.assertNotAdminConsole(id);
    this.assertNoDependents(id, "Clear data");
    const result = await this.withLock(id, () =>
      this.managed(id, () => this.ctx.pluginManager.reloadPlugin(id)),
    );
    await this.refreshAdminMetadata();
    await this.applyEnabledOverrides();
    sendJson(200, result);
  }

  async handleClearData({ req, url, sendJson }) {
    this.requireLocal(req);
    const id = url.searchParams.get("id");
    if (!id) throw httpError(400, "id is required");
    this.assertNotAdminConsole(id);
    const result = await this.withLock(id, () =>
      this.managed(id, () => this.ctx.pluginManager.clearPluginData(id)),
    );
    sendJson(200, result);
  }

  async handleInstall({ req, body, sendJson }) {
    this.requireLocal(req);
    await this.runReconcileIfNeeded();
    let result;
    try {
      result = await this.withLock("install", () =>
        installPlg({
          ctx: this.ctx,
          state: this.state,
          fileName: body?.fileName,
          plgBase64: body?.plgBase64,
        }),
      );
    } catch (error) {
      if (error.pluginId) {
        await this.state.recordError(error.pluginId, error);
      }
      throw error;
    }
    await this.state.clearError(result.id);
    await this.refreshAdminMetadata();
    sendJson(200, result);
  }

  async handleUninstall({ req, url, body, sendJson }) {
    this.requireLocal(req);
    const id = url.searchParams.get("id");
    if (!id) throw httpError(400, "id is required");
    this.assertNotAdminConsole(id);
    this.assertNoDependents(id, "Uninstall");
    await this.runReconcileIfNeeded();
    const result = await this.withLock(id, () =>
      this.managed(id, () =>
        uninstallPlugin({
          ctx: this.ctx,
          state: this.state,
          id,
          removeData: body?.removeData === true,
        }),
      ),
    );
    await this.refreshAdminMetadata();
    await this.state.clearEnabledOverride(id);
    sendJson(200, result);
  }

  async handleUpdate({ req, url, body, sendJson }) {
    this.requireLocal(req);
    const id = url.searchParams.get("id");
    if (!id) throw httpError(400, "id is required");
    this.assertNotAdminConsole(id);
    await this.runReconcileIfNeeded();
    const result = await this.withLock(id, () =>
      this.managed(id, () =>
        updatePlugin({
          ctx: this.ctx,
          state: this.state,
          id,
          fileName: body?.fileName,
          plgBase64: body?.plgBase64,
        }),
      ),
    );
    await this.refreshAdminMetadata();
    await this.applyEnabledOverrides();
    sendJson(200, result);
  }

  async handleStatus({ req, sendJson }) {
    this.requireLocal(req);
    await this.runReconcileIfNeeded();
    const protocol = this.ctx.protocol.status();
    sendJson(200, {
      ok: true,
      running: true,
      paused: this.ctx.runtime.paused,
      connected: protocol.connected || this.ctx.runtime.connected,
      protocol,
      scheduler: {
        running: Boolean(this.ctx.scheduler.running),
        ticking: Boolean(this.ctx.scheduler.ticking),
      },
      pluginCount: this.ctx.registry.list().length,
      taskCount: this.ctx.taskStore.list().length,
      stats: this.ctx.runtime.stats,
      startedAt: this.ctx.runtime.startedAt,
    });
  }

  async handleLogs({ req, url, sendJson }) {
    this.requireLocal(req);
    const level = String(url.searchParams.get("level") || "debug");
    const limit = Number(url.searchParams.get("limit")) || 200;
    const q = String(url.searchParams.get("q") || "");
    const logs = await this.collectLogs({ limit, level, q });
    sendJson(200, { ok: true, logs, total: logs.length });
  }

  async handleClearLogs({ req, sendJson }) {
    this.requireLocal(req);
    await this.clearCollectedLogs();
    sendJson(200, { ok: true });
  }

  async collectLogs({ limit = 200, level = "debug", q = "" }) {
    const entries = [];
    const coreLogs = await getLogs({
      logFile: logFilePath(this.ctx),
      limit,
      level,
      q,
    });
    entries.push(...coreLogs.map((entry) => ({ ...entry, source: "core" })));

    if (this.ctx.logging?.list) {
      for (const source of this.ctx.logging.list()) {
        try {
          const rows = await this.ctx.logging.read(source.id, {
            level,
            limit,
            q,
          });
          entries.push(
            ...rows.map((entry) => ({
              ...entry,
              source: entry.source || source.id,
            })),
          );
        } catch {
          // A broken plugin log source must not break the admin logs page.
        }
      }
    }
    return entries
      .sort((a, b) => String(b.ts || "").localeCompare(String(a.ts || "")))
      .slice(0, limit);
  }

  async clearCollectedLogs() {
    await clearLogs(logFilePath(this.ctx));
    if (this.ctx.logging?.list) {
      for (const source of this.ctx.logging.list()) {
        try {
          await this.ctx.logging.clear(source.id);
        } catch {
          // Ignore sources that do not support clearing.
        }
      }
    }
  }

  async handleDesignTokensCss({ req, res }) {
    this.requireLocal(req);
    const theme = await loadTheme(this.ctx);
    this.sendText(
      res,
      200,
      themeCss(theme),
      "text/css; charset=utf-8",
    );
  }

  async handleTheme({ req, sendJson }) {
    this.requireLocal(req);
    sendJson(200, {
      ok: true,
      theme: await loadTheme(this.ctx),
      presets: Object.fromEntries(
        Object.entries(THEME_PRESETS).map(([key, value]) => [key, value]),
      ),
    });
  }

  async handleThemeSave({ req, body, sendJson }) {
    this.requireLocal(req);
    const theme = await saveTheme(this.ctx, body || {});
    sendJson(200, { ok: true, theme });
  }

  async handleConfigList({ req, sendJson }) {
    this.requireLocal(req);
    await this.runReconcileIfNeeded();
    const configs = [];
    for (const [pluginId, metadata] of this.adminMetadata) {
      if (!metadata.config) continue;
      const plugin = this.ctx.registry.get(pluginId);
      if (!plugin || plugin.enabled === false) continue;
      configs.push({
        pluginId,
        title: metadata.config.title,
        groups: metadata.config.groups,
        schema: metadata.config.schema,
        actions: metadata.config.actions || [],
        ...(await getConfigSnapshot(this.ctx, pluginId, metadata)),
      });
    }
    sendJson(200, { ok: true, configs });
  }

  async handleConfigDetail({ req, url, sendJson }) {
    this.requireLocal(req);
    await this.runReconcileIfNeeded();
    const pluginId = url.searchParams.get("pluginId");
    if (!pluginId) throw httpError(400, "pluginId is required");
    const metadata = this.adminMetadata.get(pluginId);
    if (!metadata?.config) {
      throw httpError(404, `No admin config for plugin: ${pluginId}`);
    }
    this.assertPluginEnabled(pluginId);
    sendJson(200, {
      ok: true,
      pluginId,
      title: metadata.config.title,
      groups: metadata.config.groups,
      schema: metadata.config.schema,
      actions: metadata.config.actions || [],
      ...(await getConfigSnapshot(this.ctx, pluginId, metadata)),
    });
  }

  async handleConfigSave({ req, url, body, sendJson }) {
    this.requireLocal(req);
    await this.runReconcileIfNeeded();
    const pluginId = url.searchParams.get("pluginId");
    if (!pluginId) throw httpError(400, "pluginId is required");
    const metadata = this.adminMetadata.get(pluginId);
    if (!metadata?.config) {
      throw httpError(404, `No admin config for plugin: ${pluginId}`);
    }
    this.assertPluginEnabled(pluginId);
    const snapshot = await saveConfig(
      this.ctx,
      pluginId,
      metadata,
      body?.values || {},
      body?.clearSecret || [],
    );
    sendJson(200, { ok: true, pluginId, ...snapshot });
  }

  async handleConfigValidate({ req, url, body, sendJson }) {
    this.requireLocal(req);
    await this.runReconcileIfNeeded();
    const pluginId = url.searchParams.get("pluginId");
    if (!pluginId) throw httpError(400, "pluginId is required");
    const metadata = this.adminMetadata.get(pluginId);
    if (!metadata?.config) {
      throw httpError(404, `No admin config for plugin: ${pluginId}`);
    }
    this.assertPluginEnabled(pluginId);
    const result = await validateConfig(
      this.ctx,
      pluginId,
      metadata,
      body?.values || {},
    );
    sendJson(200, { ok: true, pluginId, ...result });
  }

  async handleConfigReset({ req, url, sendJson }) {
    this.requireLocal(req);
    await this.runReconcileIfNeeded();
    const pluginId = url.searchParams.get("pluginId");
    if (!pluginId) throw httpError(400, "pluginId is required");
    const metadata = this.adminMetadata.get(pluginId);
    if (!metadata?.config) {
      throw httpError(404, `No admin config for plugin: ${pluginId}`);
    }
    this.assertPluginEnabled(pluginId);
    const snapshot = await resetConfig(this.ctx, pluginId, metadata);
    sendJson(200, { ok: true, pluginId, ...snapshot });
  }

  async handlePages({ req, sendJson }) {
    this.requireLocal(req);
    await this.runReconcileIfNeeded();
    const pages = [];
    for (const [pluginId, metadata] of this.adminMetadata) {
      const wrapper = this.ctx.registry.get(pluginId);
      if (!wrapper || wrapper.enabled === false) continue;
      for (const page of metadata.pages || []) {
        pages.push({
          pluginId,
          pluginName: wrapper?.name || pluginId,
          ...page,
        });
      }
    }
    sendJson(200, { ok: true, pages });
  }

  async handlePageMeta({ req, url, sendJson }) {
    this.requireLocal(req);
    await this.runReconcileIfNeeded();
    const pluginId = url.searchParams.get("pluginId");
    const pageId = url.searchParams.get("pageId");
    if (!pluginId || !pageId) {
      throw httpError(400, "pluginId and pageId are required");
    }
    const metadata = this.adminMetadata.get(pluginId);
    this.assertPluginEnabled(pluginId);
    const page = metadata?.pages?.find((item) => item.id === pageId);
    if (!page) {
      throw httpError(404, `Admin page not found: ${pluginId}/${pageId}`);
    }
    sendJson(200, {
      ok: true,
      pluginId,
      ...page,
    });
  }

  async handleUi({ req, res }) {
    this.requireLocal(req);
    this.sendText(
      res,
      200,
      await this.readPublic("index.html"),
      "text/html; charset=utf-8",
    );
  }

  async handleAppJs({ req, res }) {
    this.requireLocal(req);
    this.sendText(
      res,
      200,
      await this.readPublic("app.js"),
      "application/javascript; charset=utf-8",
    );
  }

  async handleStyleCss({ req, res }) {
    this.requireLocal(req);
    this.sendText(
      res,
      200,
      await this.readPublic("style.css"),
      "text/css; charset=utf-8",
    );
  }
}
