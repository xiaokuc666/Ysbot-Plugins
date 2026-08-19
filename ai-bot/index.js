import {
  groupEnabled,
  loadPluginConfig,
  savePluginConfig,
} from "./lib/config.js";
import { createPluginLogger } from "./lib/logger.js";

function generateTraceId() {
  return `trace-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

export default class AiBotPlugin {
  async init(ctx) {
    this.ctx = ctx;
    this.disposed = false;
    this.config = await loadPluginConfig(ctx);
    this.log = await createPluginLogger(ctx);
    this.cooldowns = new Map();
    this.seenGroups = new Set();
    this.periodicTimer = null;
    this.unsubscribe = ctx.eventBus.on("onebot.message", (event) => {
      this.handleMessage(event).catch((error) => {
        this.log.warn("ai", `event handling failed: ${error.message}`, {
          traceId: event?.traceId || null,
        });
      });
    });
    this.unsubscribeMotivation = ctx.eventBus.on(
      "curiosity.motivation",
      (motivation) => {
        this.handleCuriosityMotivation(motivation).catch((error) => {
          this.log.warn("ai", `curiosity motivation failed: ${error.message}`, {
            traceId: motivation?.payload?.traceId || null,
          });
        });
      },
    );
    this.unsubscribeDecision = ctx.eventBus.on(
      "curiosity.decision",
      (decision) => {
        this.handleCuriosityDecision(decision).catch((error) => {
          this.log.warn("ai", `curiosity decision failed: ${error.message}`, {
            traceId: decision?.motivation?.payload?.traceId || null,
          });
        });
      },
    );
    this.schedulePeriodicProbe();
  }

  async handleMessage(event) {
    if (this.disposed || !event) return;
    if (event.message_type !== "group" && event.message_type !== "private") {
      return;
    }
    const traceId = event.traceId || generateTraceId();
    const config = await loadPluginConfig(this.ctx);

    if (event.message_type === "private") {
      const handled = await this.tryHandlePrivateCommand(
        event,
        config,
        traceId,
      );
      if (handled) return;
      if (!config.privateEnabled) return;
      await this.replyToMessage(event, config, traceId);
      return;
    }

    const groupId = String(event.group_id || "");
    if (!groupId) return;
    this.seenGroups.add(groupId);
    if (!groupEnabled(config, groupId)) {
      this.log.debug("ai", "group disabled", { traceId, groupId });
      return;
    }
    if (config.curiosityEnabled && this.ctx.curiosity) {
      await this.submitCuriosity(event, config, traceId);
      return;
    }
    if (
      config.defaultReplyMode === "mention" &&
      !this.isMentioned(event)
    ) {
      return;
    }
    await this.replyToMessage(event, config, traceId);
  }

  isMentioned(event) {
    const segments = Array.isArray(event.message) ? event.message : [];
    return segments.some((segment) => {
      if (!segment || typeof segment !== "object") return false;
      if (segment.type === "at") return true;
      if (segment.type === "reply") return true;
      return false;
    });
  }

  extractText(event) {
    if (typeof event.text === "string" && event.text.trim()) {
      return event.text.trim();
    }
    if (Array.isArray(event.message)) {
      const text = event.message
        .filter((segment) => segment?.type === "text")
        .map((segment) => segment.data?.text || "")
        .join("");
      if (text.trim()) return text.trim();
    }
    return String(event.raw_message || "").trim();
  }

  eventActor(event) {
    if (event.actor) return event.actor;
    return {
      id: String(event.user_id ?? ""),
      origin: "qq",
      roles: event.sender?.role ? [event.sender.role] : [],
    };
  }

  eventScene(event) {
    if (event.scene) return event.scene;
    return {
      type: event.message_type,
      id: String(event.group_id ?? event.user_id ?? ""),
    };
  }

  actionContext(sceneType, sceneId, traceId) {
    return {
      actor: {
        origin: "system",
        id: "ai-bot",
        admin: true,
        roles: ["admin"],
      },
      scene: {
        type: sceneType,
        id: String(sceneId),
      },
      traceId,
    };
  }

  async submitCuriosity(event, config, traceId) {
    const isDirect = this.isMentioned(event);
    const type = isDirect ? "direct_interaction" : "group_active";
    const cooldownMs = isDirect
      ? config.curiosityDirectCooldownMs
      : config.curiosityGroupActiveCooldownMs;
    const shouldAct =
      isDirect ||
      Math.random() < Number(config.curiosityRandomReplyProbability || 0);
    const motivation = {
      type,
      groupId: String(event.group_id),
      cooldownMs,
      shouldAct,
      payload: { event, traceId },
    };
    this.log.debug("ai", "curiosity submit", {
      traceId,
      groupId: motivation.groupId,
      type,
      shouldAct,
      cooldownMs,
    });
    const decision = await this.ctx.curiosity.submit(motivation);
    if (!decision) {
      this.log.debug("ai", "curiosity cooldown hit", {
        traceId,
        groupId: motivation.groupId,
        type,
      });
    }
    return decision;
  }

  async handleCuriosityMotivation(motivation) {
    if (!motivation) return;
    this.log.debug("ai", "curiosity motivation", {
      traceId: motivation.payload?.traceId || null,
      groupId: motivation.groupId || null,
      type: motivation.type || null,
      shouldAct: motivation.shouldAct,
    });
  }

  async handleCuriosityDecision(decision) {
    if (!decision?.motivation) return;
    const config = await loadPluginConfig(this.ctx);
    if (!config.curiosityEnabled) return;
    const motivation = decision.motivation;
    const traceId = motivation.payload?.traceId || generateTraceId();
    this.log.info("ai", "curiosity decision", {
      traceId,
      groupId: motivation.groupId || null,
      type: motivation.type || null,
      shouldAct: decision.shouldAct,
    });
    if (!decision.shouldAct) {
      await this.observeMemory(motivation, traceId);
      return;
    }
    const memory = await this.recallMemory(motivation, traceId);
    await this.replyFromMotivation(motivation, config, traceId, memory);
  }

  async observeMemory(motivation, traceId) {
    const config = await loadPluginConfig(this.ctx);
    if (!config.curiosityMemoryEnabled) return;
    if (!this.hasPlugin("memory-store")) {
      this.log.debug("ai", "memory-store not installed; observe skipped", {
        traceId,
      });
      return;
    }
    try {
      await this.ctx.registry.invoke("memory-store", {
        action: "observe",
        params: { event: motivation.payload?.event || null },
        context: {
          actor: this.botActor(),
          scene: {
            type: "group",
            id: String(motivation.groupId || ""),
          },
          traceId,
        },
      });
      this.log.info("ai", "memory observe written", { traceId });
    } catch (error) {
      this.log.warn("ai", `memory observe failed: ${error.message}`, {
        traceId,
      });
    }
  }

  async recallMemory(motivation, traceId) {
    const config = await loadPluginConfig(this.ctx);
    if (!config.curiosityMemoryEnabled || !this.hasPlugin("memory-store")) {
      return null;
    }
    try {
      const result = await this.ctx.registry.invoke("memory-store", {
        action: "recall",
        params: {
          sceneType: "group",
          sceneId: motivation.groupId || "",
          groupId: motivation.groupId || "",
          limit: config.memoryRecallLimit || 10,
        },
        context: {
          actor: this.botActor(),
          scene: {
            type: "group",
            id: String(motivation.groupId || ""),
          },
          traceId,
        },
      });
      return (
        result?.data?.entries ||
        result?.data?.memory ||
        result?.data ||
        null
      );
    } catch (error) {
      this.log.warn("ai", `memory recall failed: ${error.message}`, {
        traceId,
      });
      return null;
    }
  }

  formatMemory(memory) {
    if (typeof memory === "string") return memory;
    if (Array.isArray(memory)) {
      return memory
        .map((entry) => {
          if (!entry) return "";
          return entry.text || entry.content || JSON.stringify(entry);
        })
        .filter(Boolean)
        .join("\n");
    }
    return JSON.stringify(memory);
  }

  hasPlugin(id) {
    const plugin = this.ctx.registry.get(id);
    return Boolean(plugin && plugin.enabled !== false && plugin.status === "ready");
  }

  botActor() {
    return {
      origin: "system",
      id: "ai-bot",
      admin: true,
      roles: ["admin"],
    };
  }

  managementActor() {
    return {
      origin: "management",
      id: "management",
      admin: true,
      roles: ["admin"],
    };
  }

  async replyFromMotivation(motivation, config, traceId, memory) {
    const event = motivation.payload?.event || {};
    const text = this.extractText(event);
    const messages = [{ role: "system", content: config.systemPrompt || "" }];
    if (memory) {
      messages.push({
        role: "system",
        content: `近期记忆：\n${this.formatMemory(memory).slice(
          0,
          config.memoryMaxInjection || 2000,
        )}`,
      });
    }
    messages.push({
      role: "user",
      content: text || "请根据当前群聊动态给出一个简短自然的回应。",
    });
    const llmResult = await this.ctx.registry.invoke("llm-bridge", {
      action: "chat",
      params: {
        messages,
        temperature: 0.8,
        max_tokens: 512,
        ...(config.llmProvider ? { provider: config.llmProvider } : {}),
        ...(config.llmModel ? { model: config.llmModel } : {}),
      },
      context: {
        actor: { origin: "system", id: "ai-bot", admin: true, roles: ["admin"] },
        scene: { type: "group", id: String(motivation.groupId || "") },
        traceId,
      },
    });
    const rawReply =
      llmResult?.data?.choices?.[0]?.message?.content ||
      llmResult?.data?.choices?.[0]?.text ||
      "";
    const reply = String(rawReply || "").trim();
    if (!reply) {
      this.log.info("ai", "empty curiosity reply", { traceId });
      return;
    }
    const limited = reply.slice(0, config.maxReplyLength || 2000);
    await this.ctx.registry.invoke("action-qq", {
      action: "send_group_msg",
      params: {
        group_id: String(motivation.groupId || ""),
        message: [{ type: "text", data: { text: limited } }],
      },
      context: this.actionContext("group", motivation.groupId || "", traceId),
    });
    this.log.info("ai", "curiosity reply sent", {
      traceId,
      groupId: motivation.groupId || null,
      type: motivation.type || null,
      length: limited.length,
    });
  }

  async schedulePeriodicProbe() {
    if (this.disposed) return;
    const config = await loadPluginConfig(this.ctx);
    const enabled =
      config.curiosityEnabled &&
      config.curiosityPeriodicProbeEnabled &&
      Boolean(this.ctx.curiosity);
    const interval = enabled
      ? Math.max(
          10000,
          Number(config.curiosityPeriodicProbeIntervalMs) || 300000,
        )
      : 60000;
    this.periodicTimer = setTimeout(async () => {
      try {
        if (enabled) await this.runPeriodicProbe();
      } catch (error) {
        this.log.warn("ai", `periodic probe failed: ${error.message}`);
      } finally {
        this.schedulePeriodicProbe();
      }
    }, interval);
  }

  async runPeriodicProbe() {
    if (this.disposed) return;
    const config = await loadPluginConfig(this.ctx);
    if (
      !config.curiosityEnabled ||
      !config.curiosityPeriodicProbeEnabled ||
      !this.ctx.curiosity
    ) {
      return;
    }
    const groups = new Set([
      ...(config.enabledGroups || []).map(String),
      ...this.seenGroups,
    ]);
    const interval =
      config.curiosityPeriodicProbeIntervalMs || 300000;
    for (const groupId of groups) {
      if (!groupEnabled(config, groupId)) continue;
      const shouldAct =
        Math.random() <
        Number(config.curiosityPeriodicProbeProbability || 0);
      await this.ctx.curiosity.submit({
        type: "periodic_probe",
        groupId,
        cooldownMs: interval,
        shouldAct,
        payload: { traceId: generateTraceId(), source: "periodic" },
      });
    }
  }

  async replyToMessage(event, config, traceId) {
    const sceneKey =
      event.message_type === "group"
        ? `group:${event.group_id}`
        : `private:${event.user_id}`;
    const now = Date.now();
    const cooldownMs = (config.cooldownSeconds || 0) * 1000;
    const nextAllowedAt = this.cooldowns.get(sceneKey) || 0;
    if (cooldownMs > 0 && now < nextAllowedAt) return;

    const text = this.extractText(event);
    if (!text) return;
    const llmResult = await this.ctx.registry.invoke("llm-bridge", {
      action: "chat",
      params: {
        messages: [
          { role: "system", content: config.systemPrompt || "" },
          { role: "user", content: text },
        ],
        temperature: 0.8,
        max_tokens: 512,
        ...(config.llmProvider ? { provider: config.llmProvider } : {}),
        ...(config.llmModel ? { model: config.llmModel } : {}),
      },
      context: {
        actor: this.eventActor(event),
        scene: this.eventScene(event),
        traceId,
      },
    });
    const rawReply =
      llmResult?.data?.choices?.[0]?.message?.content ||
      llmResult?.data?.choices?.[0]?.text ||
      "";
    const reply = String(rawReply || "").trim();
    if (!reply) {
      this.log.info("ai", "empty llm reply", { traceId });
      return;
    }
    const limited = reply.slice(0, config.maxReplyLength || 2000);
    const action =
      event.message_type === "group" ? "send_group_msg" : "send_private_msg";
    const params =
      event.message_type === "group"
        ? {
            group_id: String(event.group_id),
            message: [{ type: "text", data: { text: limited } }],
          }
        : {
            user_id: String(event.user_id),
            message: [{ type: "text", data: { text: limited } }],
          };
    const sceneId =
      event.message_type === "group" ? event.group_id : event.user_id;
    await this.ctx.registry.invoke("action-qq", {
      action,
      params,
      context: this.actionContext(event.message_type, sceneId, traceId),
    });
    this.cooldowns.set(sceneKey, now + cooldownMs);
    this.log.info("ai", "reply sent", {
      traceId,
      sceneType: event.message_type,
      sceneId: String(sceneId),
      length: limited.length,
    });
  }

  async tryHandlePrivateCommand(event, config, traceId) {
    const text = this.extractText(event);
    if (!/^\/ai(?:\s|$)/i.test(text)) return false;
    const userId = String(event.user_id || "");
    const adminIds = (config.adminUserIds || []).map(String);
    if (!adminIds.includes(userId)) {
      await this.sendPrivateText(userId, "你没有权限执行 AI Bot 管理指令", traceId);
      return true;
    }

    const parts = text.split(/\s+/);
    const command = (parts[1] || "help").toLowerCase();
    const arg = parts.slice(2).join(" ").trim();

    if (command === "help") {
      await this.sendPrivateText(
        userId,
        [
          "/ai status",
          "/ai on <groupId>",
          "/ai off <groupId>",
          "/ai mode mention|all",
          "/ai default on|off",
          "/ai prompt <text>",
          "/ai memory <groupId>",
          "/ai memory clear <groupId>",
          "/ai note <groupId> <text>",
        ].join("\n"),
        traceId,
      );
      return true;
    }
    if (command === "status") {
      await this.sendPrivateText(
        userId,
        [
          `默认启用: ${config.defaultEnabled}`,
          `私聊回复: ${config.privateEnabled}`,
          `回复模式: ${config.defaultReplyMode}`,
          `启用群: ${(config.enabledGroups || []).join(", ") || "无"}`,
          `禁用群: ${(config.disabledGroups || []).join(", ") || "无"}`,
          `管理员: ${(config.adminUserIds || []).join(", ") || "无"}`,
        ].join("\n"),
        traceId,
      );
      return true;
    }
    if (command === "on" || command === "off") {
      if (!arg) {
        await this.sendPrivateText(userId, "用法: /ai on|off <groupId>", traceId);
        return true;
      }
      const groupId = arg;
      const enabledGroups = (config.enabledGroups || []).map(String);
      const disabledGroups = (config.disabledGroups || []).map(String);
      if (command === "on") {
        if (!enabledGroups.includes(groupId)) enabledGroups.push(groupId);
        const nextDisabled = disabledGroups.filter((id) => id !== groupId);
        await savePluginConfig(this.ctx, {
          enabledGroups,
          disabledGroups: nextDisabled,
        });
      } else {
        if (!disabledGroups.includes(groupId)) disabledGroups.push(groupId);
        const nextEnabled = enabledGroups.filter((id) => id !== groupId);
        await savePluginConfig(this.ctx, {
          enabledGroups: nextEnabled,
          disabledGroups,
        });
      }
      await this.sendPrivateText(
        userId,
        `群 ${groupId} 已${command === "on" ? "启用" : "禁用"}`,
        traceId,
      );
      return true;
    }
    if (command === "mode") {
      if (!["mention", "all"].includes(arg)) {
        await this.sendPrivateText(userId, "用法: /ai mode mention|all", traceId);
        return true;
      }
      await savePluginConfig(this.ctx, { defaultReplyMode: arg });
      await this.sendPrivateText(userId, `回复模式已设为 ${arg}`, traceId);
      return true;
    }
    if (command === "default") {
      if (arg !== "on" && arg !== "off") {
        await this.sendPrivateText(userId, "用法: /ai default on|off", traceId);
        return true;
      }
      await savePluginConfig(this.ctx, { defaultEnabled: arg === "on" });
      await this.sendPrivateText(userId, `默认启用已设为 ${arg}`, traceId);
      return true;
    }
    if (command === "prompt") {
      if (!arg) {
        await this.sendPrivateText(userId, "用法: /ai prompt <text>", traceId);
        return true;
      }
      await savePluginConfig(this.ctx, { systemPrompt: arg });
      await this.sendPrivateText(userId, "系统提示词已更新", traceId);
      return true;
    }
    if (command === "memory" || command === "note") {
      await this.handleMemoryAdminCommand(command, arg, userId, traceId);
      return true;
    }

    await this.sendPrivateText(userId, "未知指令，输入 /ai help 查看帮助", traceId);
    return true;
  }

  async handleMemoryAdminCommand(command, arg, userId, traceId) {
    if (!this.hasPlugin("memory-store")) {
      await this.sendPrivateText(
        userId,
        "memory-store 未安装，无法执行记忆指令。",
        traceId,
      );
      return;
    }
    const context = {
      actor: this.managementActor(),
      scene: { type: "private", id: String(userId) },
      traceId,
    };
    if (command === "memory" && arg.startsWith("clear ")) {
      const groupId = arg.slice("clear ".length).trim();
      if (!groupId) {
        await this.sendPrivateText(userId, "用法: /ai memory clear <groupId>", traceId);
        return;
      }
      const result = await this.ctx.registry.invoke("memory-store", {
        action: "clear",
        params: { groupId },
        context,
      });
      await this.sendPrivateText(
        userId,
        `已清空群 ${groupId} 的记忆，删除 ${result.data?.removed || 0} 条。`,
        traceId,
      );
      return;
    }
    if (command === "memory") {
      const groupId = arg.trim();
      if (!groupId) {
        await this.sendPrivateText(userId, "用法: /ai memory <groupId>", traceId);
        return;
      }
      const result = await this.ctx.registry.invoke("memory-store", {
        action: "list",
        params: { groupId, limit: 20 },
        context,
      });
      const entries = result.data?.entries || [];
      if (!entries.length) {
        await this.sendPrivateText(userId, `群 ${groupId} 暂无记忆。`, traceId);
        return;
      }
      const text = entries
        .slice(0, 10)
        .map((entry) => `${entry.ts} [${entry.type}] ${entry.content}`)
        .join("\n");
      await this.sendPrivateText(
        userId,
        `群 ${groupId} 共有 ${result.data?.total || 0} 条，最近：\n${text}`,
        traceId,
      );
      return;
    }
    if (command === "note") {
      const space = arg.indexOf(" ");
      if (space <= 0) {
        await this.sendPrivateText(userId, "用法: /ai note <groupId> <text>", traceId);
        return;
      }
      const groupId = arg.slice(0, space).trim();
      const content = arg.slice(space + 1).trim();
      await this.ctx.registry.invoke("memory-store", {
        action: "note",
        params: { groupId, content },
        context,
      });
      await this.sendPrivateText(userId, `已写入群 ${groupId} 的笔记。`, traceId);
    }
  }

  async sendPrivateText(userId, text, traceId) {
    await this.ctx.registry.invoke("action-qq", {
      action: "send_private_msg",
      params: {
        user_id: String(userId),
        message: [{ type: "text", data: { text } }],
      },
      context: this.actionContext("private", userId, traceId),
    });
  }

  async dispose() {
    this.disposed = true;
    if (this.periodicTimer) {
      clearTimeout(this.periodicTimer);
      this.periodicTimer = null;
    }
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    if (this.unsubscribeMotivation) {
      this.unsubscribeMotivation();
      this.unsubscribeMotivation = null;
    }
    if (this.unsubscribeDecision) {
      this.unsubscribeDecision();
      this.unsubscribeDecision = null;
    }
    this.log.info("index", "disposed");
    await this.log.flush();
    await this.log.unregister();
  }
}
