import {
  groupEnabled,
  loadPluginConfig,
  savePluginConfig,
} from "./lib/config.js";
import { createHistoryStore } from "./lib/history.js";
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
    this.history = createHistoryStore({
      dataDir: ctx.dataDir,
      maxEntries: this.config.historyMaxEntries || 20,
      maxAgeMs: this.config.historyMaxAgeMs || 3600000,
    });
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
    await this.replyFromMotivation(motivation, config, traceId);
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
        params: { event: motivation.payload?.event || {} },
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
    const scene = motivation?.payload?.event
      ? this.eventScene(motivation.payload.event)
      : { type: "group", id: String(motivation?.groupId || "") };
    return this.recallMemoryForScene(scene, null, config, traceId);
  }

  async recallMemoryForScene(scene, query, config, traceId) {
    if (
      !config.curiosityMemoryEnabled ||
      !this.hasPlugin("memory-store")
    ) {
      return null;
    }
    try {
      const result = await this.ctx.registry.invoke("memory-store", {
        action: "recall",
        params: {
          sceneType: "group",
          sceneId: scene?.id || "",
          groupId: scene?.id || "",
          query,
          limit: config.memoryRecallLimit || 10,
        },
        context: {
          actor: this.botActor(),
          scene: {
            type: scene?.type || "group",
            id: String(scene?.id || ""),
          },
          traceId,
        },
      });
      const data = result?.data;
      if (Array.isArray(data)) return data;
      if (Array.isArray(data?.entries)) return data.entries;
      if (Array.isArray(data?.memory)) return data.memory;
      return data || null;
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

  async replyFromMotivation(motivation, config, traceId) {
    let event = motivation?.payload?.event || {};
    if (!event.message_type && motivation?.groupId) {
      event = {
        ...event,
        message_type: "group",
        group_id: String(motivation.groupId),
      };
    }
    return this.generateAndSendReply(
      event,
      config,
      traceId,
      motivation?.type || "curiosity",
    );
  }

  buildEventContext(event) {
    const segments = Array.isArray(event.message) ? event.message : [];
    const replySegment = segments.find((segment) => segment?.type === "reply");
    const atSegment = segments.find((segment) => segment?.type === "at");
    return {
      message_type: event.message_type || null,
      group_id: event.group_id ? String(event.group_id) : null,
      group_name:
        event.raw?.group_name || event.group_name || null,
      user_id: event.user_id ? String(event.user_id) : null,
      nickname: event.sender?.nickname || event.sender?.card || "",
      card: event.sender?.card || "",
      role:
        event.sender?.role ||
        event.actor?.roles?.[0] ||
        "member",
      reply_to: replySegment?.data?.id
        ? String(replySegment.data.id)
        : null,
      at_bot: Boolean(atSegment),
      time: event.timestamp
        ? Number(event.timestamp)
        : Math.floor(Date.now() / 1000),
    };
  }

  async buildReplyContext(event, config, traceId) {
    const scene = this.eventScene(event);
    const sceneKey = `${scene.type}:${scene.id}`;
    const query = this.extractText(event);
    const memory = await this.recallMemoryForScene(
      scene,
      query,
      config,
      traceId,
    );
    const history = await this.history.list(sceneKey, {
      maxEntries: config.historyMaxEntries || 20,
      maxAgeMs: config.historyMaxAgeMs || 3600000,
    });
    const messages = [
      {
        role: "system",
        content: `${
          config.systemPrompt || ""
        }\n\n回复时直接输出你要说的话，不要添加“烟散：”“Bot：”之类的说话人前缀。`,
      },
    ];
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
      role: "system",
      content: `当前事件上下文：\n${JSON.stringify(
        this.buildEventContext(event),
      )}`,
    });
    for (const entry of history) {
      const isBot =
        entry.role === "bot" || entry.userId === "bot"
      const role = isBot ? "assistant" : "user";
      const content = isBot
        ? String(entry.text || "")
        : entry.nickname
          ? `${entry.nickname}: ${entry.text}`
          : String(entry.text || "");
      if (content) messages.push({ role, content });
    }
    messages.push({
      role: "user",
      content: query || "请根据当前群聊动态给出一个简短自然的回应。",
    });
    return {
      messages,
      scene,
      sceneKey,
      memoryCount: Array.isArray(memory)
        ? memory.length
        : memory
          ? 1
          : 0,
      historyCount: history.length,
      eventContext: this.buildEventContext(event),
    };
  }

  async appendHistory(scene, entry, config) {
    await this.history.append(
      {
        scene: {
          type: scene.type,
          id: String(scene.id),
        },
        ...entry,
      },
      {
        maxEntries: config.historyMaxEntries || 20,
        maxAgeMs: config.historyMaxAgeMs || 3600000,
      },
    );
  }

  buildReplySegments(event, text, config) {
    const segments = [];
    if (event.message_type === "group") {
      const replySegment = Array.isArray(event.message)
        ? event.message.find((segment) => segment?.type === "reply")
        : null;
      if (
        config.replyWithQuote !== false &&
        replySegment?.data?.id
      ) {
        segments.push({
          type: "reply",
          data: { id: String(replySegment.data.id) },
        });
      }
      if (config.replyWithAt !== false && event.user_id) {
        segments.push({
          type: "at",
          data: { qq: String(event.user_id) },
        });
      }
    }
    segments.push({ type: "text", data: { text } });
    return segments;
  }

  async generateAndSendReply(event, config, traceId, source = "message") {
    const context = await this.buildReplyContext(event, config, traceId);
    if (event.user_id) {
      await this.appendHistory(
        context.scene,
        {
          userId: String(event.user_id),
          nickname: String(
            event.sender?.nickname ||
              event.sender?.card ||
              event.user_id ||
              "用户",
          ),
          role: String(event.sender?.role || "member"),
          text: this.extractText(event),
        },
        config,
      );
    }
    this.log.info("ai", "context assembled", {
      traceId,
      sceneType: context.scene.type,
      sceneId: String(context.scene.id),
      source,
      memoryCount: context.memoryCount,
      historyCount: context.historyCount,
    });
    const llmResult = await this.ctx.registry.invoke("llm-bridge", {
      action: "chat",
      params: {
        messages: context.messages,
        tools: config.llmTools || [],
        executeTools: true,
        maxToolRounds: config.maxToolRounds || 3,
        temperature: 0.8,
        max_tokens: 512,
        ...(config.llmProvider ? { provider: config.llmProvider } : {}),
        ...(config.llmModel ? { model: config.llmModel } : {}),
      },
      context: {
        actor: this.botActor(),
        scene: context.scene,
        traceId,
      },
    });
    const rawReply =
      llmResult?.data?.choices?.[0]?.message?.content ||
      llmResult?.data?.choices?.[0]?.text ||
      llmResult?.data?.content ||
      "";
    const reply = String(rawReply || "")
      .trim()
      .replace(/^(?:烟散|Bot|AI Bot|我)\s*[:：]\s*/i, "")
      .trim();
    if (!reply) {
      this.log.info("ai", "empty llm reply", { traceId, source });
      return null;
    }
    const limited = reply.slice(0, config.maxReplyLength || 2000);
    const message = this.buildReplySegments(event, limited, config);
    const action =
      event.message_type === "group" ? "send_group_msg" : "send_private_msg";
    const sceneId = event.group_id ?? event.user_id ?? context.scene.id;
    const params =
      action === "send_group_msg"
        ? {
            group_id: String(event.group_id ?? context.scene.id),
            message,
          }
        : {
            user_id: String(event.user_id ?? context.scene.id),
            message,
          };
    await this.ctx.registry.invoke("action-qq", {
      action,
      params,
      context: this.actionContext(
        event.message_type || context.scene.type,
        sceneId,
        traceId,
      ),
    });
    await this.appendHistory(
      context.scene,
      {
        userId: "bot",
        nickname: "Bot",
        role: "bot",
        text: limited,
      },
      config,
    );
    const now = Date.now();
    this.cooldowns.set(
      context.sceneKey,
      now + (config.cooldownSeconds || 0) * 1000,
    );
    this.log.info("ai", "reply sent", {
      traceId,
      sceneType: context.scene.type,
      sceneId: String(context.scene.id),
      source,
      length: limited.length,
      toolRounds: Array.isArray(llmResult?.data?.toolTrace)
        ? llmResult.data.toolTrace.length
        : 0,
    });
    return {
      reply: limited,
      message,
      context,
      traceId,
      toolTrace: llmResult?.data?.toolTrace || [],
    };
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
    const scene = this.eventScene(event);
    const sceneKey = `${scene.type}:${scene.id}`;
    const now = Date.now();
    const cooldownMs = (config.cooldownSeconds || 0) * 1000;
    const nextAllowedAt = this.cooldowns.get(sceneKey) || 0;
    if (cooldownMs > 0 && now < nextAllowedAt) return;

    const text = this.extractText(event);
    if (!text) return;
    await this.generateAndSendReply(event, config, traceId, "message");
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
